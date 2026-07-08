import express from "express";
import cors from "cors";
import rateLimit from "express-rate-limit";
import pino from "pino";
import puppeteer from "puppeteer";
import pg from "pg";
import { fileURLToPath } from "url";
import path from "path";
import fs from "fs";
import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";

const { Pool } = pg;
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const DATA_DIR = path.join(__dirname, "data");
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR);

const logger = pino({ level: process.env.LOG_LEVEL || "info" });

const DATABASE_URL = process.env.DATABASE_URL || "postgresql://user:pass@localhost:5432/lead_pipeline";
const pool = new Pool({ connectionString: DATABASE_URL, max: 10 });

// ─── PostgreSQL Database ──────────────────────────────────────────
async function initDb() {
  // Auto-create database if it doesn't exist
  const dbUrl = new URL(DATABASE_URL);
  const dbName = dbUrl.pathname.replace(/^\//, "");
  try {
    await pool.query("SELECT 1");
  } catch (err) {
    if (err.code === "3D000") {
      dbUrl.pathname = "/postgres";
      const adminPool = new Pool({ connectionString: dbUrl.toString() });
      try {
        await adminPool.query(`CREATE DATABASE "${dbName}"`);
        logger.info({ database: dbName }, "created database");
      } finally {
        await adminPool.end();
      }
    } else {
      throw err;
    }
  }

  await pool.query(`
    CREATE TABLE IF NOT EXISTS businesses (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      category TEXT DEFAULT '',
      address TEXT DEFAULT '',
      city TEXT DEFAULT '',
      phone TEXT DEFAULT '',
      rating TEXT DEFAULT '',
      reviews TEXT DEFAULT '',
      website_url TEXT DEFAULT '',
      website_status TEXT DEFAULT 'unchecked',
      website_checked_at TEXT DEFAULT '',
      location_query TEXT DEFAULT '',
      source TEXT DEFAULT 'Google Maps',
      scraped_on TEXT DEFAULT '',
      pipeline_status TEXT DEFAULT 'not_contacted',
      pipeline_updated_at TEXT DEFAULT '',
      notes TEXT DEFAULT '',
      message_sent TEXT DEFAULT '',
      message_sent_at TEXT DEFAULT '',
      created_at TEXT DEFAULT (NOW())
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS send_log (
      id SERIAL PRIMARY KEY,
      business_id TEXT,
      business_name TEXT,
      phone TEXT,
      status TEXT,
      reason TEXT DEFAULT '',
      sent_at TEXT DEFAULT (NOW())
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS config (
      key TEXT PRIMARY KEY,
      value TEXT
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS pipeline_history (
      id SERIAL PRIMARY KEY,
      business_id TEXT,
      business_name TEXT,
      old_status TEXT,
      new_status TEXT,
      changed_at TEXT DEFAULT (NOW())
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      username TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      created_at TEXT DEFAULT (NOW())
    )
  `);

  // Column migrations
  for (const [column, definition] of [
    ["website_checked_at", "TEXT DEFAULT ''"],
    ["pipeline_updated_at", "TEXT DEFAULT ''"],
  ]) {
    const { rows } = await pool.query(
      "SELECT column_name FROM information_schema.columns WHERE table_name = 'businesses' AND column_name = $1",
      [column]
    );
    if (rows.length === 0) {
      await pool.query(`ALTER TABLE businesses ADD COLUMN ${column} ${definition}`);
    }
  }

  await pool.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_business_phone_nonempty ON businesses(phone) WHERE phone != ''
  `);
  await pool.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_business_name_phone_nonempty ON businesses(LOWER(name), phone) WHERE name != '' AND phone != ''
  `);
}

const JWT_SECRET = process.env.JWT_SECRET || "lp-secret-change-in-production";

app.use(cors());
app.use(express.json());

// Safety rail: default to localhost-only access. Set ALLOW_NETWORK=true only after adding proper auth/reverse-proxy protection.
app.use((req, res, next) => {
  if (process.env.ALLOW_NETWORK === "true") return next();
  const ip = (req.ip || req.socket.remoteAddress || "").replace("::ffff:", "");
  const localIps = new Set(["127.0.0.1", "::1", "localhost"]);
  if (localIps.has(ip) || ip === "") return next();
  return res.status(403).json({ error: "Blocked non-local request. Run behind authentication before exposing this app on a network." });
});

// Request logging
app.use((req, res, next) => {
  const start = Date.now();
  res.on("finish", () => {
    logger.info({ method: req.method, path: req.path, status: res.statusCode, duration: Date.now() - start }, "request");
  });
  next();
});

// ─── Rate limiting ────────────────────────────────────────────────
const strictLimiter = rateLimit({
  windowMs: 60 * 1000, max: 5, standardHeaders: true, legacyHeaders: false,
  message: { error: "Too many requests. Slow down." },
});
const scrapeLimiter = rateLimit({
  windowMs: 60 * 1000, max: 3, standardHeaders: true, legacyHeaders: false,
  message: { error: "Too many scrape requests. Wait before starting another scrape." },
});
const generalLimiter = rateLimit({
  windowMs: 60 * 1000, max: 200, standardHeaders: true, legacyHeaders: false,
  message: { error: "Too many requests. Slow down." },
});

app.post("/api/scrape", scrapeLimiter);
app.post("/api/wa/send", strictLimiter);
app.post("/api/wa/connect", strictLimiter);
app.use("/api/", generalLimiter);

// ─── JWT auth middleware ───────────────────────────────────────────
function requireAuth(req, res, next) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith("Bearer ")) {
    return res.status(401).json({ error: "Authentication required" });
  }
  try {
    req.user = jwt.verify(header.slice(7), JWT_SECRET);
    next();
  } catch {
    return res.status(401).json({ error: "Invalid or expired token" });
  }
}

// ─── Auth routes (no auth required) ────────────────────────────────
app.post("/api/auth/register", async (req, res) => {
  try {
    const { username, password } = req.body;
    if (!username || !password) return res.status(400).json({ error: "Username and password are required" });
    if (typeof username !== "string" || typeof password !== "string") return res.status(400).json({ error: "Username and password must be strings" });
    if (password.length < 6) return res.status(400).json({ error: "Password must be at least 6 characters" });
    const normalized = username.toLowerCase().trim();
    const { rows: existing } = await pool.query("SELECT id FROM users WHERE username = $1", [normalized]);
    if (existing.length > 0) return res.status(409).json({ error: "Username already taken" });
    const password_hash = await bcrypt.hash(password, 10);
    await pool.query("INSERT INTO users (username, password_hash) VALUES ($1, $2)", [normalized, password_hash]);
    const token = jwt.sign({ username: normalized }, JWT_SECRET, { expiresIn: "7d" });
    logger.info({ username: normalized }, "user registered");
    res.json({ token, user: { username: normalized } });
  } catch (err) {
    logger.error({ error: err.message }, "register error");
    res.status(500).json({ error: "Registration failed" });
  }
});

app.post("/api/auth/login", async (req, res) => {
  try {
    const { username, password } = req.body;
    if (!username || !password) return res.status(400).json({ error: "Username and password are required" });
    if (typeof username !== "string" || typeof password !== "string") return res.status(400).json({ error: "Username and password must be strings" });
    const normalized = username.toLowerCase().trim();
    const { rows } = await pool.query("SELECT * FROM users WHERE username = $1", [normalized]);
    const user = rows[0];
    if (!user) return res.status(401).json({ error: "Invalid username or password" });
    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) return res.status(401).json({ error: "Invalid username or password" });
    const token = jwt.sign({ username: user.username }, JWT_SECRET, { expiresIn: "7d" });
    logger.info({ username: user.username }, "user logged in");
    res.json({ token, user: { username: user.username } });
  } catch (err) {
    logger.error({ error: err.message }, "login error");
    res.status(500).json({ error: "Login failed" });
  }
});

app.get("/api/auth/check", requireAuth, (req, res) => {
  res.json({ valid: true, user: { username: req.user.username } });
});

app.post("/api/auth/change-password", requireAuth, async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;
    if (!currentPassword || !newPassword) return res.status(400).json({ error: "Current password and new password are required" });
    if (newPassword.length < 6) return res.status(400).json({ error: "New password must be at least 6 characters" });
    const { rows } = await pool.query("SELECT * FROM users WHERE username = $1", [req.user.username]);
    const user = rows[0];
    const valid = await bcrypt.compare(currentPassword, user.password_hash);
    if (!valid) return res.status(401).json({ error: "Current password is incorrect" });
    const password_hash = await bcrypt.hash(newPassword, 10);
    await pool.query("UPDATE users SET password_hash = $1 WHERE username = $2", [password_hash, req.user.username]);
    logger.info({ username: user.username }, "password changed");
    res.json({ ok: true });
  } catch (err) {
    logger.error({ error: err.message }, "change-password error");
    res.status(500).json({ error: "Password change failed" });
  }
});

// Protect all /api/* routes after this point
app.use("/api", requireAuth);

// ─── Config endpoints ────────────────────────────────────────────
app.get("/api/config", async (req, res) => {
  const { rows } = await pool.query("SELECT key, value FROM config");
  const cfg = {};
  rows.forEach(r => { try { cfg[r.key] = JSON.parse(r.value); } catch { cfg[r.key] = r.value; } });
  res.json(cfg);
});

app.post("/api/config", async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    for (const [k, v] of Object.entries(req.body)) {
      await client.query(
        "INSERT INTO config (key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value",
        [k, JSON.stringify(v)]
      );
    }
    await client.query("COMMIT");
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
  res.json({ ok: true });
});

// ─── Business (spreadsheet) endpoints ─────────────────────────────
app.get("/api/businesses", async (req, res) => {
  const { search, website_status, pipeline_status, city, page, pageSize } = req.query;
  let where = "WHERE 1=1";
  const params = [];
  let idx = 1;
  if (search) { where += ` AND (name LIKE $${idx} OR category LIKE $${idx+1} OR phone LIKE $${idx+2} OR address LIKE $${idx+3})`; const s = `%${search}%`; params.push(s, s, s, s); idx += 4; }
  if (website_status) { where += ` AND website_status = $${idx}`; params.push(website_status); idx++; }
  if (pipeline_status) { where += ` AND pipeline_status = $${idx}`; params.push(pipeline_status); idx++; }
  if (city) { where += ` AND city = $${idx}`; params.push(city); idx++; }
  const { rows: countRows } = await pool.query(`SELECT COUNT(*)::int as n FROM businesses ${where}`, params);
  const total = countRows[0].n;
  let query = `SELECT * FROM businesses ${where} ORDER BY created_at DESC`;
  if (page && pageSize) {
    const p = parseInt(page, 10) || 1;
    const ps = parseInt(pageSize, 10) || 100;
    query += ` LIMIT ${ps} OFFSET ${(p - 1) * ps}`;
  }
  const { rows } = await pool.query(query, params);
  res.json({ data: rows, total });
});

app.post("/api/businesses", async (req, res) => {
  const biz = req.body;
  const items = Array.isArray(biz) ? biz : [biz];
  let inserted = 0;
  let updated = 0;
  for (const b of items) {
    const saved = await upsertBusiness(b, b.city || "");
    if (saved.inserted) inserted++; else updated++;
  }
  res.json({ ok: true, count: inserted + updated, inserted, updated });
});

app.patch("/api/businesses/:id", async (req, res) => {
  const { id } = req.params;
  const updates = req.body;
  const allowed = ["name","category","address","city","phone","rating","reviews","website_url","website_status","pipeline_status","notes","message_sent","message_sent_at"];
  const keys = Object.keys(updates).filter(k => allowed.includes(k));
  if (!keys.length) return res.json({ ok: true });
  const VALID_PIPELINE_STATUSES = ["not_contacted","contacted","interested","will_talk_later","not_interested","completed"];
  if (keys.includes("pipeline_status") && !VALID_PIPELINE_STATUSES.includes(updates.pipeline_status)) {
    return res.status(400).json({ error: `Invalid pipeline_status. Must be one of: ${VALID_PIPELINE_STATUSES.join(", ")}` });
  }
  const setClauses = keys.map((k, i) => `${k} = $${i + 1}`);
  const vals = keys.map(k => updates[k]);
  if (keys.includes("pipeline_status")) {
    const { rows } = await pool.query("SELECT name, pipeline_status FROM businesses WHERE id = $1", [id]);
    const current = rows[0];
    const now = new Date().toISOString();
    vals.push(now, id);
    await pool.query(
      `UPDATE businesses SET ${setClauses.join(", ")}, pipeline_updated_at = $${vals.length - 1} WHERE id = $${vals.length}`,
      vals
    );
    if (current && current.pipeline_status !== updates.pipeline_status) {
      await pool.query(
        "INSERT INTO pipeline_history (business_id, business_name, old_status, new_status) VALUES ($1, $2, $3, $4)",
        [id, current.name, current.pipeline_status, updates.pipeline_status]
      );
    }
  } else {
    vals.push(id);
    await pool.query(
      `UPDATE businesses SET ${setClauses.join(", ")} WHERE id = $${vals.length}`,
      vals
    );
  }
  res.json({ ok: true });
});

app.delete("/api/businesses", async (req, res) => {
  const { ids } = req.body;
  if (Array.isArray(ids)) {
    if (ids.length === 0) return res.json({ ok: true });
    const placeholders = ids.map((_, i) => `$${i + 1}`).join(",");
    await pool.query(`DELETE FROM businesses WHERE id IN (${placeholders})`, ids);
  } else {
    await pool.query("DELETE FROM businesses");
  }
  res.json({ ok: true });
});

// ─── Local competitor website examples ───────────────────────────
app.get("/api/businesses/:id/competitor-examples", async (req, res) => {
  const { id } = req.params;
  const { rows: targetRows } = await pool.query("SELECT * FROM businesses WHERE id = $1", [id]);
  const target = targetRows[0];
  if (!target) return res.status(404).json({ error: "Business not found" });

  const category = (target.category || "").trim();
  const city = (target.city || "").trim();
  const params = [id];
  let paramIdx = 2;
  let query = `
    SELECT id, name, category, address, city, phone, rating, reviews, website_url, website_status
    FROM businesses
    WHERE id != $1
      AND website_url != ''
      AND website_status = 'working'
  `;

  if (city) {
    query += ` AND city = $${paramIdx}`;
    params.push(city);
    paramIdx++;
  }

  if (category) {
    query += ` AND (LOWER(category) LIKE LOWER($${paramIdx}) OR LOWER($${paramIdx + 1}) LIKE '%' || LOWER(category) || '%')`;
    params.push(`%${category}%`, category);
    paramIdx += 2;
  }

  query += `
    ORDER BY
      CASE WHEN rating != '' THEN CAST(rating AS REAL) ELSE 0 END DESC,
      CASE WHEN reviews != '' THEN CAST(REPLACE(REPLACE(reviews, ',', ''), '.', '') AS INTEGER) ELSE 0 END DESC,
      name ASC
    LIMIT 8
  `;

  let { rows: examples } = await pool.query(query, params);

  if (examples.length === 0 && city) {
    const { rows: fallback } = await pool.query(`
      SELECT id, name, category, address, city, phone, rating, reviews, website_url, website_status
      FROM businesses
      WHERE id != $1
        AND city = $2
        AND website_url != ''
        AND website_status = 'working'
      ORDER BY
        CASE WHEN rating != '' THEN CAST(rating AS REAL) ELSE 0 END DESC,
        CASE WHEN reviews != '' THEN CAST(REPLACE(REPLACE(reviews, ',', ''), '.', '') AS INTEGER) ELSE 0 END DESC,
        name ASC
      LIMIT 8
    `, [id, city]);
    examples = fallback;
  }

  res.json({ target, examples });
});

// ─── Stats endpoint ───────────────────────────────────────────────
app.get("/api/stats", async (req, res) => {
  const { rows: [tot] } = await pool.query("SELECT COUNT(*)::int as n FROM businesses");
  const { rows: [now] } = await pool.query("SELECT COUNT(*)::int as n FROM businesses WHERE website_status = 'no_website'");
  const { rows: [brk] } = await pool.query("SELECT COUNT(*)::int as n FROM businesses WHERE website_status IN ('broken', 'blocked')");
  const { rows: byPipeline } = await pool.query("SELECT pipeline_status, COUNT(*)::int as n FROM businesses GROUP BY pipeline_status");
  const { rows: byCity } = await pool.query("SELECT city, COUNT(*)::int as n FROM businesses WHERE city != '' GROUP BY city ORDER BY n DESC LIMIT 15");
  res.json({ total: tot.n, noWebsite: now.n, broken: brk.n, byPipeline, byCity });
});

// ─── Website reachability checker ─────────────────────────────────
function normalizeUrl(url) {
  if (!url) return null;
  let u = url.trim();
  if (!/^https?:\/\//i.test(u)) u = `https://${u}`;
  return u;
}

async function fetchWithTimeout(url, method, timeoutMs = 8000) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { method, redirect: "follow", signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

function looksLikeBotChallenge(body, finalUrl = "") {
  const text = (body || "").toLowerCase();
  const url = (finalUrl || "").toLowerCase();
  return url.includes("/cdn-cgi/") ||
    url.includes("_challenge") ||
    text.includes("cloudflare") ||
    text.includes("checking your browser") ||
    text.includes("verify you are human") ||
    text.includes("unusual traffic") ||
    text.includes("captcha") ||
    text.includes("just a moment") ||
    text.includes("enable javascript") ||
    text.includes("browser integrity check") ||
    text.includes("ddos protection") ||
    text.includes("attention required") ||
    text.includes("access denied");
}

async function checkWebsiteOnce(url) {
  const target = normalizeUrl(url);
  if (!target) return "no_website";
  let resp;
  try { resp = await fetchWithTimeout(target, "HEAD"); }
  catch { resp = await fetchWithTimeout(target, "GET"); }
  if (!resp || resp.status >= 400) return "broken";
  const contentType = resp.headers.get("content-type") || "";
  if (resp.status === 200 && contentType.includes("text/html")) {
    try {
      const body = await resp.clone().text();
      if (looksLikeBotChallenge(body, resp.url)) return "blocked";
    } catch {}
  }
  return "working";
}

async function checkWebsite(url) {
  const target = normalizeUrl(url);
  if (!target) return "no_website";
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const status = await checkWebsiteOnce(target);
      if (status !== "broken" || attempt === 2) return status;
    } catch {
      if (attempt === 2) return "broken";
      await new Promise(r => setTimeout(r, 1000));
    }
  }
  return "broken";
}

async function runWithConcurrency(items, limit, worker) {
  const results = [];
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const idx = next++;
      results[idx] = await worker(items[idx], idx);
    }
  });
  await Promise.all(workers);
  return results;
}

function cleanPhone(raw) {
  if (!raw) return null;
  let digits = raw.replace(/[^\d]/g, "");
  if (!digits) return null;
  digits = digits.replace(/^0+/, "");
  if (digits.length === 12 && digits.startsWith("91")) return `+${digits}`;
  if (digits.length === 10) return `+91${digits}`;
  if (digits.length >= 7) return `+${digits}`;
  return null;
}

// ─── Business upsert helpers ────────────────────────────────────────
const INSERT_BUSINESS_SQL = `
  INSERT INTO businesses
    (id, name, category, address, city, phone, rating, reviews, website_url, website_status, location_query, source, scraped_on)
  VALUES
    ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
`;

const UPDATE_BUSINESS_SQL = `
  UPDATE businesses SET
    category = COALESCE(NULLIF($2, ''), category),
    address = COALESCE(NULLIF($3, ''), address),
    city = COALESCE(NULLIF($4, ''), city),
    rating = COALESCE(NULLIF($5, ''), rating),
    reviews = COALESCE(NULLIF($6, ''), reviews),
    website_url = COALESCE(NULLIF($7, ''), website_url),
    website_status = CASE WHEN $8 != '' THEN $8 ELSE website_status END,
    location_query = COALESCE(NULLIF($9, ''), location_query),
    scraped_on = $10
  WHERE id = $1
`;

async function findExistingBusiness(b) {
  const phone = cleanPhone(b.phone || "") || "";
  if (phone) {
    const { rows } = await pool.query("SELECT id FROM businesses WHERE phone = $1 LIMIT 1", [phone]);
    if (rows.length > 0) return rows[0].id;
    const { rows: rows2 } = await pool.query("SELECT id FROM businesses WHERE LOWER(name) = LOWER($1) AND phone = $2 LIMIT 1", [b.name || "", phone]);
    if (rows2.length > 0) return rows2[0].id;
  }
  return null;
}

async function upsertBusiness(b, location) {
  const scraped_on = new Date().toISOString().slice(0, 10);
  const row = {
    id: b.id || `scraped-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    name: b.name || "", category: b.category || "", address: b.address || "",
    city: b.city || location || "", phone: cleanPhone(b.phone || "") || "",
    rating: b.rating || "", reviews: b.reviews || "",
    website_url: b.website_url || "", website_status: b.website_status || (b.website_url ? "unchecked" : "no_website"),
    location_query: b.query || b.location_query || "", source: b.source || "Google Maps", scraped_on,
  };
  const existing_id = await findExistingBusiness(row);
  if (existing_id) {
    await pool.query(UPDATE_BUSINESS_SQL, [
      existing_id, row.category, row.address, row.city, row.rating, row.reviews,
      row.website_url, row.website_status, row.location_query, row.scraped_on,
    ]);
    return { ...row, id: existing_id, inserted: false };
  }
  await pool.query(INSERT_BUSINESS_SQL, [
    row.id, row.name, row.category, row.address, row.city, row.phone,
    row.rating, row.reviews, row.website_url, row.website_status,
    row.location_query, row.source, row.scraped_on,
  ]);
  return { ...row, inserted: true };
}

// Re-check (or first-check) websites for a given set of business ids.
app.post("/api/check-websites", async (req, res) => {
  const { ids } = req.body;
  const rows = ids && ids.length
    ? (await pool.query(`SELECT id, website_url FROM businesses WHERE id IN (${ids.map((_, i) => `$${i + 1}`).join(",")})`, ids)).rows
    : (await pool.query("SELECT id, website_url FROM businesses WHERE website_status = 'unchecked'")).rows;

  const results = await runWithConcurrency(rows, 6, async (row) => {
    const status = await checkWebsite(row.website_url);
    const checkedAt = new Date().toISOString();
    await pool.query("UPDATE businesses SET website_status = $1, website_checked_at = $2 WHERE id = $3", [status, checkedAt, row.id]);
    return { id: row.id, website_status: status, website_checked_at: checkedAt };
  });
  res.json({ ok: true, checked: results.length, results });
});

// ─── Google Maps Scraper ──
let activeScrapeJob = null;

app.post("/api/scrape/cancel", (req, res) => {
  if (activeScrapeJob) {
    activeScrapeJob.cancelled = true;
    return res.json({ ok: true, cancelled: true });
  }
  res.json({ ok: true, cancelled: false });
});

app.post("/api/scrape", async (req, res) => {
  const { location, categories, maxPerQuery = 20, headless = true } = req.body;
  if (!location || !categories || !categories.length) {
    return res.status(400).json({ error: "location and at least one category are required" });
  }
  if (activeScrapeJob && !activeScrapeJob.done) {
    return res.status(409).json({ error: "A scrape is already running. Cancel it or wait for it to finish." });
  }

  const job = { cancelled: false, done: false };
  activeScrapeJob = job;
  const queries = categories.map(c => `${c} in ${location}`);
  let browser;
  let inserted = 0;
  let updated = 0;
  let skippedInRun = 0;
  const seenThisRun = new Set();
  const toCheckById = new Map();

  try {
    browser = await puppeteer.launch({
      headless: headless ? true : false,
      args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage"],
      defaultViewport: null,
    });

    const page = await browser.newPage();
    await page.setUserAgent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36");

    for (const query of queries) {
      if (job.cancelled) break;
      logger.info({ query }, "scraping query");
      try {
        await page.goto(`https://www.google.com/maps/search/${encodeURIComponent(query)}`, { waitUntil: "domcontentloaded", timeout: 45000 });
        await new Promise(r => setTimeout(r, 4000));

        const challenge = await page.evaluate(() => {
          const t = document.body.innerText.toLowerCase();
          return t.includes("unusual traffic") || t.includes("captcha") || t.includes("verify you are human");
        }).catch(() => false);
        if (challenge) throw new Error("Google served a CAPTCHA/unusual-traffic challenge. Slow down and try again later.");

        try {
          const buttons = await page.$$("button");
          for (const btn of buttons) {
            const text = await page.evaluate(el => el.innerText, btn);
            if (text.includes("Accept") || text.includes("I agree")) {
              await btn.click();
              await new Promise(r => setTimeout(r, 2000));
              break;
            }
          }
        } catch {}

        try { await page.waitForSelector('a[href*="/place/"]', { timeout: 15000 }); }
        catch { continue; }

        for (let i = 0; i < 8 && !job.cancelled; i++) {
          await page.mouse.wheel({ deltaY: 2500 });
          await new Promise(r => setTimeout(r, 1800));
        }

        const hrefs = await page.evaluate(() => {
          const results = [];
          const seen = new Set();
          document.querySelectorAll('a[href*="/place/"]').forEach(link => {
            const name = link.getAttribute("aria-label") || "";
            const href = link.getAttribute("href") || "";
            if (name && href && !seen.has(name)) {
              seen.add(name);
              results.push({ name, href });
            }
          });
          return results;
        });

        logger.info({ count: hrefs.length, query }, "listings found");

        for (const { name, href } of hrefs.slice(0, maxPerQuery)) {
          if (job.cancelled) break;
          const runKey = `${name.toLowerCase().trim()}|${query.toLowerCase().trim()}`;
          if (seenThisRun.has(runKey)) { skippedInRun++; continue; }
          seenThisRun.add(runKey);

          try {
            const fullUrl = href.startsWith("http") ? href : `https://www.google.com${href}`;
            await page.goto(fullUrl, { waitUntil: "domcontentloaded", timeout: 20000 });
            await new Promise(r => setTimeout(r, 3000));

            const listingChallenge = await page.evaluate(() => {
              const t = document.body.innerText.toLowerCase();
              return t.includes("unusual traffic") || t.includes("captcha") || t.includes("verify you are human");
            }).catch(() => false);
            if (listingChallenge) throw new Error("Google served a CAPTCHA/unusual-traffic challenge.");

            try {
              const phoneBtn = await page.$('button[data-item-id^="phone"]');
              if (phoneBtn) { await phoneBtn.click(); await new Promise(r => setTimeout(r, 1000)); }
            } catch {}

            const data = await page.evaluate((bizName, q) => {
              const text = document.body.innerText;
              const websiteEl = document.querySelector('a[data-item-id="authority"]');
              const websiteUrl = websiteEl ? websiteEl.href : "";

              let phone = "";
              const phoneBtn = document.querySelector('button[data-item-id^="phone"]');
              if (phoneBtn) {
                const label = phoneBtn.getAttribute("aria-label") || "";
                const digits = label.replace(/[^\d]/g, "").replace(/^0+/, "");
                if (digits.length === 10) phone = `+91${digits}`;
                else if (digits.length === 12 && digits.startsWith("91")) phone = `+${digits}`;
                else if (digits.length > 6) phone = `+${digits}`;
              }
              if (!phone) {
                document.querySelectorAll('[data-item-id^="phone"] span').forEach(el => {
                  const t = el.innerText.trim();
                  const digits = t.replace(/[^\d]/g, "").replace(/^0+/, "");
                  if (digits.length === 10 && !phone) phone = `+91${digits}`;
                });
              }
              if (!phone) {
                const patterns = [/(?:\+91[\s\-]?)?[6-9]\d{9}/, /\+91[\s\-]?\d{5}[\s\-]?\d{5}/, /[6-9]\d{4}[\s\-]\d{5}/];
                for (const pat of patterns) {
                  const m = text.match(pat);
                  if (m) {
                    phone = m[0].replace(/[\s\-]/g, "");
                    if (!phone.startsWith("+")) {
                      const digits = phone.replace(/\D/g, "").replace(/^0+/, "");
                      phone = digits.length === 10 ? `+91${digits}` : `+${digits}`;
                    }
                    break;
                  }
                }
              }

              const ratingEl = document.querySelector('[role="img"][aria-label*="stars"]') || document.querySelector('[aria-label*="star"]') || document.querySelector('.F7nice span[aria-hidden="true"]');
              const ratingText = ratingEl ? (ratingEl.getAttribute("aria-label") || ratingEl.innerText || "") : "";
              const ratingMatch = ratingText.match(/(\d(?:\.\d)?)/);
              const reviewsEl = document.querySelector('.F7nice span[aria-label*="review"]') || document.querySelector('[aria-label*="review"]');
              const reviewsText = reviewsEl ? (reviewsEl.getAttribute("aria-label") || reviewsEl.innerText || "") : "";
              const reviewMatch = reviewsText.match(/(\d[\d,]*)/);
              const addrEl = document.querySelector('button[data-item-id="address"]') || document.querySelector('[data-item-id="address"]');
              const address = addrEl ? addrEl.innerText.trim() : "";
              const catEl = document.querySelector('button[jsaction*="category"]') || document.querySelector('.DkEaL') || document.querySelector('[jsaction*="pane.rating.category"]');
              const category = catEl ? catEl.innerText.trim() : "Business";

              return { name: bizName, category, address, phone, rating: ratingMatch ? ratingMatch[1] : "", reviews: reviewMatch ? reviewMatch[1] : "", website_url: websiteUrl, website_status: websiteUrl ? "unchecked" : "no_website", query: q };
            }, name, query);

            if (data) {
              const saved = await upsertBusiness(data, location);
              if (saved.inserted) inserted++; else updated++;
              if (saved.website_url) toCheckById.set(saved.id, { id: saved.id, website_url: saved.website_url });
              logger.info({ name, phone: data.phone || "MISSING", site: data.website_url || "none", action: saved.inserted ? "inserted" : "updated" }, "business scraped");
            }

            await page.goBack({ waitUntil: "domcontentloaded", timeout: 15000 }).catch(() => {});
            await new Promise(r => setTimeout(r, 1500));
          } catch (err) {
            logger.warn({ name, error: err.message }, "scrape listing error");
          }
        }
      } catch (err) {
        logger.error({ query, error: err.message }, "scrape query error");
      }
      await new Promise(r => setTimeout(r, 2000 + Math.random() * 2000));
    }

    if (browser) await browser.close().catch(() => {});

    const toCheck = [...toCheckById.values()];
    if (toCheck.length) {
      (async () => {
        await runWithConcurrency(toCheck, 6, async (b) => {
          const status = await checkWebsite(b.website_url);
          const checkedAt = new Date().toISOString();
          await pool.query("UPDATE businesses SET website_status = $1, website_checked_at = $2 WHERE id = $3", [status, checkedAt, b.id]);
        });
        logger.info({ count: toCheck.length }, "website checks complete");
      })();
    }

    res.json({ ok: true, count: inserted + updated, inserted, updated, skippedInRun, cancelled: job.cancelled, pendingWebsiteChecks: toCheck.length });
  } catch (err) {
    if (browser) await browser.close().catch(() => {});
    logger.error({ error: err.message }, "scrape fatal error");
    res.status(500).json({ error: err.message });
  } finally {
    job.done = true;
    if (activeScrapeJob === job) activeScrapeJob = null;
  }
});

// ─── WhatsApp Session State ───────────────────────────────────────
let waBrowser = null;
let waPage = null;
let waStatus = "disconnected";
let sendQueue = [];
let sendState = { running: false, paused: false, index: 0, sentCount: 0, failCount: 0, total: 0 };

app.post("/api/wa/connect", async (req, res) => {
  if (waStatus === "connected") return res.json({ ok: true, status: "connected" });

  try {
    if (waBrowser) { await waBrowser.close().catch(() => {}); }

    const WA_SESSION_DIR = path.join(DATA_DIR, "wa_session");
    if (!fs.existsSync(WA_SESSION_DIR)) fs.mkdirSync(WA_SESSION_DIR, { recursive: true });

    waBrowser = await puppeteer.launch({
      headless: false,
      userDataDir: WA_SESSION_DIR,
      args: ["--no-sandbox", "--disable-setuid-sandbox", "--start-maximized"],
      defaultViewport: null,
    });

    waPage = await waBrowser.newPage();
    await waPage.setUserAgent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36");

    waStatus = "connecting";
    await waPage.goto("https://web.whatsapp.com", { waitUntil: "domcontentloaded", timeout: 30000 });

    const result = await Promise.race([
      waPage.waitForSelector('canvas[aria-label="Scan this QR code to link a device"]', { timeout: 20000 }).then(() => "qr"),
      waPage.waitForSelector('[data-testid="chat-list"]', { timeout: 20000 }).then(() => "ready"),
      waPage.waitForSelector('div[role="textbox"]', { timeout: 20000 }).then(() => "ready"),
    ]).catch(() => "qr");

    if (result === "ready") {
      waStatus = "connected";
      logger.info("whatsapp already connected via saved session");
      return res.json({ ok: true, status: "connected" });
    }

    waStatus = "qr_ready";
    logger.info("whatsapp qr code ready");
    res.json({ ok: true, status: "qr_ready" });

    waPage.waitForSelector('[data-testid="chat-list"]', { timeout: 120000 })
      .then(() => { waStatus = "connected"; logger.info("whatsapp connected after qr scan"); })
      .catch((e) => { waStatus = "disconnected"; logger.error({ error: e.message }, "whatsapp connect timeout"); });

  } catch (err) {
    waStatus = "disconnected";
    logger.error({ error: err.message }, "whatsapp connect error");
    res.status(500).json({ error: err.message });
  }
});

app.get("/api/wa/status", async (req, res) => {
  if (waStatus === "connected" && waPage) {
    try {
      const stillConnected = await waPage.evaluate(() => {
        return !!document.querySelector('[data-testid="chat-list"]') ||
               !!document.querySelector('div[role="textbox"]') ||
               !!document.querySelector('#app .two');
      }).catch(() => false);
      if (!stillConnected) { waStatus = "disconnected"; waPage = null; waBrowser = null; }
    } catch { waStatus = "disconnected"; }
  }
  res.json({ status: waStatus, sendState });
});

app.post("/api/wa/disconnect", async (req, res) => {
  sendState.running = false;
  if (waBrowser) { await waBrowser.close().catch(() => {}); }
  waBrowser = null; waPage = null; waStatus = "disconnected";
  res.json({ ok: true });
});

async function sendWhatsAppMessage(phone, message) {
  if (!waPage || waStatus !== "connected") throw new Error("WhatsApp not connected");

  const cleanedPhone = cleanPhone(phone);
  if (!cleanedPhone) throw new Error(`Invalid phone: ${phone}`);

  const phoneDigits = cleanedPhone.replace("+", "");
  const url = `https://web.whatsapp.com/send?phone=${phoneDigits}`;

  await waPage.goto(url, { waitUntil: "networkidle2", timeout: 45000 });
  await new Promise(r => setTimeout(r, 6000));

  const notFound = await waPage.evaluate(() => {
    const body = document.body.innerText;
    return body.includes("Phone number shared via url is invalid") || body.includes("not registered");
  });
  if (notFound) throw new Error("Phone not on WhatsApp");

  const dismissBtn = await waPage.$('div[data-animate-modal-popup="true"] button');
  if (dismissBtn) { await dismissBtn.click(); throw new Error("Phone not on WhatsApp (modal)"); }

  const selectors = [
    'div[contenteditable="true"][data-tab="10"]',
    'div[contenteditable="true"][data-tab="6"]',
    'div[contenteditable="true"][aria-placeholder]',
    'footer div[contenteditable="true"]',
    'div[role="textbox"][contenteditable="true"]',
    'div[contenteditable="true"]',
  ];

  let inputBox = null;
  for (const sel of selectors) {
    try {
      const el = await waPage.$(sel);
      if (el) { inputBox = el; break; }
    } catch {}
  }
  if (!inputBox) throw new Error("Could not find message input box");

  await inputBox.click();
  await new Promise(r => setTimeout(r, 800));
  await waPage.keyboard.down("Control");
  await waPage.keyboard.press("a");
  await waPage.keyboard.up("Control");
  await waPage.keyboard.press("Backspace");
  await new Promise(r => setTimeout(r, 300));

  const lines = message.split("\n");
  for (let i = 0; i < lines.length; i++) {
    if (lines[i]) await waPage.keyboard.type(lines[i], { delay: 20 });
    if (i < lines.length - 1) {
      await waPage.keyboard.down("Shift");
      await waPage.keyboard.press("Enter");
      await waPage.keyboard.up("Shift");
    }
  }
  await new Promise(r => setTimeout(r, 1000));

  const sendBtn = await waPage.$('span[data-icon="send"]');
  if (sendBtn) await sendBtn.click();
  else await waPage.keyboard.press("Enter");

  await new Promise(r => setTimeout(r, 3000));
  return true;
}

app.post("/api/wa/send", async (req, res) => {
  if (waStatus !== "connected") return res.status(400).json({ error: "WhatsApp not connected. Connect first." });
  if (sendState.running) return res.status(400).json({ error: "Send already in progress" });

  const { businesses: bizList, message, delaySeconds = 60 } = req.body;
  if (!bizList || !bizList.length) return res.status(400).json({ error: "No businesses provided" });

  const seenPhones = new Set();
  sendQueue = [];
  for (const biz of bizList) {
    const phone = cleanPhone(biz.phone || "");
    if (!phone) {
      sendQueue.push(biz);
      continue;
    }
    if (seenPhones.has(phone)) {
      await pool.query("INSERT INTO send_log (business_id, business_name, phone, status, reason) VALUES ($1, $2, $3, $4, $5)",
        [biz.id, biz.name, biz.phone || "", "skipped", "Duplicate phone in this send queue"]);
      continue;
    }
    seenPhones.add(phone);
    sendQueue.push({ ...biz, phone });
  }
  sendState = { running: true, paused: false, index: 0, sentCount: 0, failCount: 0, total: sendQueue.length };
  res.json({ ok: true, total: sendQueue.length, skippedDuplicates: bizList.length - sendQueue.length });

  (async () => {
    for (let i = 0; i < sendQueue.length; i++) {
      if (!sendState.running) break;
      while (sendState.paused && sendState.running) await new Promise(r => setTimeout(r, 1000));
      if (!sendState.running) break;

      const biz = sendQueue[i];
      sendState.index = i + 1;

      if (!biz.phone) {
        await pool.query("INSERT INTO send_log (business_id, business_name, phone, status, reason) VALUES ($1, $2, $3, $4, $5)",
          [biz.id, biz.name, biz.phone || "", "skipped", "No phone number"]);
        continue;
      }

      try {
        const msg = message.replace(/\{name\}/g, biz.name).replace(/\{category\}/g, biz.category || "your business");
        await sendWhatsAppMessage(biz.phone, msg);
        sendState.sentCount++;
        const now = new Date().toISOString();
        const { rows } = await pool.query("SELECT name, pipeline_status FROM businesses WHERE id = $1", [biz.id]);
        const current = rows[0];
        await pool.query("UPDATE businesses SET pipeline_status = 'contacted', pipeline_updated_at = $1, message_sent = $2, message_sent_at = $3 WHERE id = $4",
          [now, msg, now, biz.id]);
        if (current && current.pipeline_status !== "contacted") {
          await pool.query("INSERT INTO pipeline_history (business_id, business_name, old_status, new_status) VALUES ($1, $2, $3, $4)",
            [biz.id, current.name, current.pipeline_status, "contacted"]);
        }
        await pool.query("INSERT INTO send_log (business_id, business_name, phone, status) VALUES ($1, $2, $3, $4)",
          [biz.id, biz.name, biz.phone, "sent"]);
      } catch (err) {
        sendState.failCount++;
        await pool.query("INSERT INTO send_log (business_id, business_name, phone, status, reason) VALUES ($1, $2, $3, $4, $5)",
          [biz.id, biz.name, biz.phone, "failed", err.message]);
      }

      if (i < sendQueue.length - 1 && sendState.running && !sendState.paused) {
        const jitter = Math.floor(delaySeconds * 1000 + (Math.random() - 0.5) * 10000);
        await new Promise(r => setTimeout(r, Math.max(5000, jitter)));
      }
    }
    sendState.running = false;
  })();
});

app.post("/api/wa/pause", (req, res) => { sendState.paused = !sendState.paused; res.json({ ok: true, paused: sendState.paused }); });
app.post("/api/wa/stop", (req, res) => { sendState.running = false; sendState.paused = false; res.json({ ok: true }); });

app.get("/api/send-log", async (req, res) => {
  const { rows } = await pool.query("SELECT * FROM send_log ORDER BY sent_at DESC LIMIT 200");
  res.json(rows);
});

app.get("/api/pipeline-history", async (req, res) => {
  const { rows } = await pool.query("SELECT * FROM pipeline_history ORDER BY changed_at DESC LIMIT 300");
  res.json(rows);
});

// ─── Centralized error handler ────────────────────────────────────
app.use((err, req, res, next) => {
  logger.error({ error: err.message, stack: err.stack }, "unhandled error");
  res.status(err.status || 500).json({ error: err.message || "Internal server error" });
});

// ─── Serve frontend (production build) ───────────────────────────
const distPath = path.join(__dirname, "dist");
if (fs.existsSync(distPath)) {
  app.use(express.static(distPath));
  app.get("*", (req, res) => res.sendFile(path.join(distPath, "index.html")));
}

const PORT = process.env.PORT || 5000;
let server;
if (process.env.NODE_ENV !== "test") {
  const start = async () => {
    try {
      await initDb();
      server = app.listen(PORT, () => {
        logger.info({ port: PORT, database: DATABASE_URL }, "server started");
      });
    } catch (err) {
      logger.error({ error: err.message }, "failed to start server");
      process.exit(1);
    }
  };
  start();
}

export { app, server, pool, normalizeUrl, looksLikeBotChallenge, cleanPhone, findExistingBusiness, upsertBusiness, checkWebsite, checkWebsiteOnce, runWithConcurrency, sendWhatsAppMessage, requireAuth, JWT_SECRET, DATA_DIR, initDb };
