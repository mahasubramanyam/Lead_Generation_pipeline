import express from "express";
import cors from "cors";
import rateLimit from "express-rate-limit";
import pino from "pino";
import puppeteer from "puppeteer";
import pg from "pg";
import { fileURLToPath } from "url";
import path from "path";
import dns from "node:dns/promises";
import fs from "fs";
import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";
import { Queue, Worker } from "bullmq";
import Redis from "ioredis";
import swaggerUi from "swagger-ui-express";
import swaggerSpec from "./swagger.js";

const { Pool } = pg;
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const DATA_DIR = path.join(__dirname, "data");
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR);

const DEMO_MODE = process.env.DEMO_MODE === "true";

const logger = pino({ level: process.env.LOG_LEVEL || "info" });

const DATABASE_URL = process.env.DATABASE_URL || "postgresql://user:pass@localhost:5432/lead_pipeline";
const pool = new Pool({ connectionString: DATABASE_URL, max: 10 });

// ─── PostgreSQL Database ──────────────────────────────────────────
async function initDb() {
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
    CREATE TABLE IF NOT EXISTS tenants (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      slug TEXT UNIQUE NOT NULL,
      plan TEXT DEFAULT 'free',
      created_at TEXT DEFAULT (NOW())
    )
  `);

  await pool.query(`
    INSERT INTO tenants (id, name, slug, plan)
    VALUES (1, 'Legacy Workspace', 'legacy', 'free')
    ON CONFLICT (id) DO NOTHING
  `);
  await pool.query(`SELECT setval(pg_get_serial_sequence('tenants','id'), GREATEST(1, (SELECT COALESCE(MAX(id), 1) FROM tenants)))`);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      tenant_id INTEGER NOT NULL DEFAULT 1 REFERENCES tenants(id),
      username TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'owner',
      created_at TEXT DEFAULT (NOW())
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS businesses (
      id TEXT NOT NULL,
      tenant_id INTEGER NOT NULL DEFAULT 1 REFERENCES tenants(id),
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
      created_at TEXT DEFAULT (NOW()),
      PRIMARY KEY (tenant_id, id)
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS send_log (
      id SERIAL PRIMARY KEY,
      tenant_id INTEGER NOT NULL DEFAULT 1 REFERENCES tenants(id),
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
      tenant_id INTEGER NOT NULL DEFAULT 1 REFERENCES tenants(id),
      key TEXT NOT NULL,
      value TEXT,
      PRIMARY KEY (tenant_id, key)
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS pipeline_history (
      id SERIAL PRIMARY KEY,
      tenant_id INTEGER NOT NULL DEFAULT 1 REFERENCES tenants(id),
      business_id TEXT,
      business_name TEXT,
      old_status TEXT,
      new_status TEXT,
      changed_at TEXT DEFAULT (NOW())
    )
  `);

  for (const [table, column, definition] of [
    ["users", "tenant_id", "INTEGER NOT NULL DEFAULT 1"],
    ["users", "role", "TEXT NOT NULL DEFAULT 'owner'"],
    ["businesses", "tenant_id", "INTEGER NOT NULL DEFAULT 1"],
    ["send_log", "tenant_id", "INTEGER NOT NULL DEFAULT 1"],
    ["config", "tenant_id", "INTEGER NOT NULL DEFAULT 1"],
    ["pipeline_history", "tenant_id", "INTEGER NOT NULL DEFAULT 1"],
    ["businesses", "website_checked_at", "TEXT DEFAULT ''"],
    ["businesses", "pipeline_updated_at", "TEXT DEFAULT ''"],
  ]) {
    const { rows } = await pool.query(
      "SELECT column_name FROM information_schema.columns WHERE table_name = $1 AND column_name = $2",
      [table, column]
    );
    if (rows.length === 0) {
      await pool.query(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
    }
  }

  try { await pool.query("ALTER TABLE config DROP CONSTRAINT IF EXISTS config_pkey"); } catch (e) { logger.warn({ error: e.message }, "config drop pkey skipped"); }
  try { await pool.query("ALTER TABLE config ADD PRIMARY KEY (tenant_id, key)"); } catch (e) { logger.debug({ error: e.message }, "config composite pkey already present"); }

  try { await pool.query("ALTER TABLE businesses DROP CONSTRAINT IF EXISTS businesses_pkey"); } catch (e) { logger.warn({ error: e.message }, "businesses drop pkey skipped"); }
  try { await pool.query("ALTER TABLE businesses ADD PRIMARY KEY (tenant_id, id)"); } catch (e) { logger.debug({ error: e.message }, "businesses composite pkey already present"); }

  await pool.query("UPDATE users SET tenant_id = 1 WHERE tenant_id IS NULL");
  await pool.query("UPDATE businesses SET tenant_id = 1 WHERE tenant_id IS NULL");
  await pool.query("UPDATE send_log SET tenant_id = 1 WHERE tenant_id IS NULL");
  await pool.query("UPDATE config SET tenant_id = 1 WHERE tenant_id IS NULL");
  await pool.query("UPDATE pipeline_history SET tenant_id = 1 WHERE tenant_id IS NULL");

  await pool.query("DROP INDEX IF EXISTS idx_business_phone_nonempty");
  await pool.query("DROP INDEX IF EXISTS idx_business_name_phone_nonempty");
  await pool.query("CREATE INDEX IF NOT EXISTS idx_businesses_tenant ON businesses(tenant_id)");
  await pool.query("CREATE UNIQUE INDEX IF NOT EXISTS idx_businesses_tenant_phone ON businesses(tenant_id, phone) WHERE phone != ''");
  await pool.query("CREATE UNIQUE INDEX IF NOT EXISTS idx_businesses_tenant_name_phone ON businesses(tenant_id, LOWER(name), phone) WHERE name != '' AND phone != ''");
  await pool.query("CREATE INDEX IF NOT EXISTS idx_send_log_tenant ON send_log(tenant_id)");
  await pool.query("CREATE INDEX IF NOT EXISTS idx_pipeline_history_tenant ON pipeline_history(tenant_id)");
  await pool.query("CREATE INDEX IF NOT EXISTS idx_config_tenant ON config(tenant_id)");
  await pool.query("CREATE INDEX IF NOT EXISTS idx_users_tenant ON users(tenant_id)");
}

const JWT_SECRET = process.env.JWT_SECRET || "lp-dev-secret-change-in-production";
const IS_PRODUCTION = process.env.NODE_ENV === "production";
const WEAK_JWT_SECRETS = new Set([
  "lp-secret-change-in-production",
  "lp-dev-secret-change-in-production",
  "lp-ci-secret",
  "secret",
  "changeme",
]);
if (IS_PRODUCTION) {
  if (!process.env.JWT_SECRET || WEAK_JWT_SECRETS.has(process.env.JWT_SECRET) || process.env.JWT_SECRET.length < 32) {
    throw new Error("JWT_SECRET must be set to a strong value (at least 32 characters) in production");
  }
} else if (!process.env.JWT_SECRET || WEAK_JWT_SECRETS.has(process.env.JWT_SECRET) || process.env.JWT_SECRET.length < 16) {
  logger.warn("JWT_SECRET is weak or missing; using development-only secret. Set JWT_SECRET before deploying.");
}

// ─── Redis / BullMQ ──────────────────────────────────────────────────
const REDIS_URL = process.env.REDIS_URL || "redis://localhost:6379";
let redisConnection = null;
let scrapeQueue = null;
const cancelledJobs = new Map();

if (!DEMO_MODE) {
  redisConnection = new Redis(REDIS_URL, { maxRetriesPerRequest: null, enableReadyCheck: false });
  scrapeQueue = new Queue("scrape", { connection: redisConnection });
}

const ALLOWED_ORIGINS = (process.env.CORS_ORIGINS || "http://localhost:5173,http://127.0.0.1:5173,http://localhost:5000,http://127.0.0.1:5000")
  .split(",")
  .map(s => s.trim())
  .filter(Boolean);

app.use((req, res, next) => {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  if (process.env.NODE_ENV === "production") {
    res.setHeader("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
  }
  res.setHeader("Content-Security-Policy", "default-src 'self'; img-src 'self' data: https:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'");
  next();
});

app.use(cors({
  origin(origin, cb) {
    if (!origin || ALLOWED_ORIGINS.includes(origin)) return cb(null, true);
    return cb(null, false);
  },
  credentials: false,
  methods: ["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"],
}));
app.use(express.json({ limit: "1mb" }));

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
    const payload = jwt.verify(header.slice(7), JWT_SECRET);
    if (!payload || !payload.user_id || !payload.tenant_id || !payload.username) {
      return res.status(401).json({ error: "Invalid or expired token" });
    }
    req.user = payload;
    req.tenantId = payload.tenant_id;
    next();
  } catch {
    return res.status(401).json({ error: "Invalid or expired token" });
  }
}

function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user || !roles.includes(req.user.role)) {
      return res.status(403).json({ error: "Insufficient permissions" });
    }
    next();
  };
}

// ─── Auth routes (no auth required) ────────────────────────────────
app.post("/api/auth/register", async (req, res) => {
  try {
    const { username, password } = req.body || {};
    if (!username || !password) return res.status(400).json({ error: "Username and password are required" });
    if (typeof username !== "string" || typeof password !== "string") return res.status(400).json({ error: "Username and password must be strings" });
    if (username.trim().length < 3 || username.trim().length > 64) return res.status(400).json({ error: "Username must be between 3 and 64 characters" });
    if (password.length < 6) return res.status(400).json({ error: "Password must be at least 6 characters" });
    const normalized = username.toLowerCase().trim();
    const { rows: existing } = await pool.query("SELECT id FROM users WHERE username = $1", [normalized]);
    if (existing.length > 0) return res.status(409).json({ error: "Username already taken" });

    const client = await pool.connect();
    let tenantId;
    try {
      await client.query("BEGIN");
      if (DEMO_MODE) {
        tenantId = 1;
      } else {
        const tenantName = `${normalized}'s workspace`;
        const tenantSlug = `${normalized.replace(/[^a-z0-9]+/g, "-")}-${Date.now().toString(36)}`;
        const { rows: tenantRows } = await client.query(
          "INSERT INTO tenants (name, slug, plan) VALUES ($1, $2, 'free') RETURNING id",
          [tenantName, tenantSlug]
        );
        tenantId = tenantRows[0].id;
      }
      const password_hash = await bcrypt.hash(password, 10);
      const role = DEMO_MODE ? "owner" : "owner";
      const { rows: userRows } = await client.query(
        "INSERT INTO users (tenant_id, username, password_hash, role) VALUES ($1, $2, $3, $4) RETURNING id, role",
        [tenantId, normalized, password_hash, role]
      );
      await client.query("COMMIT");
      const user = userRows[0];
      const token = jwt.sign({ user_id: user.id, username: normalized, tenant_id: tenantId, role: user.role }, JWT_SECRET, { expiresIn: "7d" });
      logger.info({ username: normalized, tenantId }, "user registered");
      res.json({ token, user: { username: normalized, tenant_id: tenantId, role: user.role } });
    } catch (e) {
      await client.query("ROLLBACK");
      throw e;
    } finally {
      client.release();
    }
  } catch (err) {
    logger.error({ error: err.message }, "register error");
    res.status(500).json({ error: "Registration failed" });
  }
});

app.post("/api/auth/login", async (req, res) => {
  try {
    const { username, password } = req.body || {};
    if (!username || !password) return res.status(400).json({ error: "Username and password are required" });
    if (typeof username !== "string" || typeof password !== "string") return res.status(400).json({ error: "Username and password must be strings" });
    const normalized = username.toLowerCase().trim();
    const { rows } = await pool.query("SELECT id, tenant_id, username, password_hash, role FROM users WHERE username = $1", [normalized]);
    const user = rows[0];
    if (!user) return res.status(401).json({ error: "Invalid username or password" });
    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) return res.status(401).json({ error: "Invalid username or password" });
    const token = jwt.sign({ user_id: user.id, username: user.username, tenant_id: user.tenant_id, role: user.role }, JWT_SECRET, { expiresIn: "7d" });
    logger.info({ username: user.username, tenantId: user.tenant_id }, "user logged in");
    res.json({ token, user: { username: user.username, tenant_id: user.tenant_id, role: user.role } });
  } catch (err) {
    logger.error({ error: err.message }, "login error");
    res.status(500).json({ error: "Login failed" });
  }
});

app.get("/api/auth/check", requireAuth, (req, res) => {
  res.json({ valid: true, user: { username: req.user.username, tenant_id: req.user.tenant_id, role: req.user.role }, demoMode: DEMO_MODE });
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

// ─── Swagger / OpenAPI docs ──────────────────────────────────────────
app.use("/api-docs", swaggerUi.serve, swaggerUi.setup(swaggerSpec, {
  swaggerOptions: { persistAuthorization: true },
}));

// Protect all /api/* routes after this point
app.use("/api", requireAuth);

// ─── Config endpoints ────────────────────────────────────────────
app.get("/api/config", async (req, res) => {
  const { rows } = await pool.query("SELECT key, value FROM config WHERE tenant_id = $1", [req.user.tenant_id]);
  const cfg = {};
  rows.forEach(r => { try { cfg[r.key] = JSON.parse(r.value); } catch { cfg[r.key] = r.value; } });
  res.json(cfg);
});

app.post("/api/config", async (req, res) => {
  if (!req.body || typeof req.body !== "object" || Array.isArray(req.body)) {
    return res.status(400).json({ error: "Config body must be an object" });
  }
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    for (const [k, v] of Object.entries(req.body)) {
      if (typeof k !== "string" || k.length === 0 || k.length > 128) {
        throw new Error("Invalid config key");
      }
      await client.query(
        "INSERT INTO config (tenant_id, key, value) VALUES ($1, $2, $3) ON CONFLICT (tenant_id, key) DO UPDATE SET value = EXCLUDED.value",
        [req.user.tenant_id, k, JSON.stringify(v)]
      );
    }
    await client.query("COMMIT");
  } catch (e) {
    await client.query("ROLLBACK");
    return res.status(400).json({ error: e.message || "Invalid config" });
  } finally {
    client.release();
  }
  res.json({ ok: true });
});

// ─── Business (spreadsheet) endpoints ─────────────────────────────
app.get("/api/businesses", async (req, res) => {
  const { search, website_status, pipeline_status, city, page, pageSize } = req.query;
  let where = "WHERE tenant_id = $1";
  const params = [req.user.tenant_id];
  let idx = 2;
  if (search) { where += ` AND (name LIKE $${idx} OR category LIKE $${idx+1} OR phone LIKE $${idx+2} OR address LIKE $${idx+3})`; const s = `%${search}%`; params.push(s, s, s, s); idx += 4; }
  if (website_status) { where += ` AND website_status = $${idx}`; params.push(website_status); idx++; }
  if (pipeline_status) { where += ` AND pipeline_status = $${idx}`; params.push(pipeline_status); idx++; }
  if (city) { where += ` AND city = $${idx}`; params.push(city); idx++; }
  const { rows: countRows } = await pool.query(`SELECT COUNT(*)::int as n FROM businesses ${where}`, params);
  const total = countRows[0].n;
  const p = Math.max(1, parseInt(page, 10) || 1);
  const ps = Math.min(10000, Math.max(1, parseInt(pageSize, 10) || 100));
  const totalPages = Math.max(1, Math.ceil(total / ps));
  params.push(ps, (p - 1) * ps);
  const { rows } = await pool.query(
    `SELECT * FROM businesses ${where} ORDER BY created_at DESC LIMIT $${idx} OFFSET $${idx + 1}`,
    params
  );
  res.json({ data: rows, total, totalPages, page: p, pageSize: ps });
});

app.post("/api/businesses", async (req, res) => {
  const biz = req.body;
  const items = Array.isArray(biz) ? biz : [biz];
  let inserted = 0;
  let updated = 0;
  for (const b of items) {
    const saved = await upsertBusiness(b, b.city || "", req.user.tenant_id);
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
  const { rows: existingRows } = await pool.query("SELECT id FROM businesses WHERE id = $1 AND tenant_id = $2", [id, req.user.tenant_id]);
  if (existingRows.length === 0) return res.status(404).json({ error: "Business not found" });
  const VALID_PIPELINE_STATUSES = ["not_contacted","contacted","interested","will_talk_later","not_interested","completed"];
  if (keys.includes("pipeline_status") && !VALID_PIPELINE_STATUSES.includes(updates.pipeline_status)) {
    return res.status(400).json({ error: `Invalid pipeline_status. Must be one of: ${VALID_PIPELINE_STATUSES.join(", ")}` });
  }
  const setClauses = keys.map((k, i) => `${k} = $${i + 1}`);
  const vals = keys.map(k => updates[k]);
  if (keys.includes("pipeline_status")) {
    const { rows } = await pool.query("SELECT name, pipeline_status FROM businesses WHERE id = $1 AND tenant_id = $2", [id, req.user.tenant_id]);
    const current = rows[0];
    if (!current) return res.status(404).json({ error: "Business not found" });
    const now = new Date().toISOString();
    vals.push(now, id, req.user.tenant_id);
    await pool.query(
      `UPDATE businesses SET ${setClauses.join(", ")}, pipeline_updated_at = $${vals.length - 2} WHERE id = $${vals.length - 1} AND tenant_id = $${vals.length}`,
      vals
    );
    if (current.pipeline_status !== updates.pipeline_status) {
      await pool.query(
        "INSERT INTO pipeline_history (tenant_id, business_id, business_name, old_status, new_status) VALUES ($1, $2, $3, $4, $5)",
        [req.user.tenant_id, id, current.name, current.pipeline_status, updates.pipeline_status]
      );
    }
  } else {
    vals.push(id, req.user.tenant_id);
    await pool.query(
      `UPDATE businesses SET ${setClauses.join(", ")} WHERE id = $${vals.length - 1} AND tenant_id = $${vals.length}`,
      vals
    );
  }
  res.json({ ok: true });
});

app.delete("/api/businesses", async (req, res) => {
  const { ids } = req.body || {};
  if (Array.isArray(ids)) {
    if (ids.length === 0) return res.json({ ok: true });
    const placeholders = ids.map((_, i) => `$${i + 2}`).join(",");
    await pool.query(`DELETE FROM businesses WHERE tenant_id = $1 AND id IN (${placeholders})`, [req.user.tenant_id, ...ids]);
  } else {
    await pool.query("DELETE FROM businesses WHERE tenant_id = $1", [req.user.tenant_id]);
  }
  res.json({ ok: true });
});

// ─── Local competitor website examples ───────────────────────────
app.get("/api/businesses/:id/competitor-examples", async (req, res) => {
  const { id } = req.params;
  const { rows: targetRows } = await pool.query("SELECT * FROM businesses WHERE id = $1 AND tenant_id = $2", [id, req.user.tenant_id]);
  const target = targetRows[0];
  if (!target) return res.status(404).json({ error: "Business not found" });

  const category = (target.category || "").trim();
  const city = (target.city || "").trim();
  const params = [id, req.user.tenant_id];
  let paramIdx = 3;
  let query = `
    SELECT id, name, category, address, city, phone, rating, reviews, website_url, website_status
    FROM businesses
    WHERE id != $1
      AND tenant_id = $2
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
        AND tenant_id = $2
        AND city = $3
        AND website_url != ''
        AND website_status = 'working'
      ORDER BY
        CASE WHEN rating != '' THEN CAST(rating AS REAL) ELSE 0 END DESC,
        CASE WHEN reviews != '' THEN CAST(REPLACE(REPLACE(reviews, ',', ''), '.', '') AS INTEGER) ELSE 0 END DESC,
        name ASC
      LIMIT 8
    `, [id, req.user.tenant_id, city]);
    examples = fallback;
  }

  res.json({ target, examples });
});

// ─── Stats endpoint ───────────────────────────────────────────────
app.get("/api/stats", async (req, res) => {
  const tid = req.user.tenant_id;
  const { rows: [tot] } = await pool.query("SELECT COUNT(*)::int as n FROM businesses WHERE tenant_id = $1", [tid]);
  const { rows: [now] } = await pool.query("SELECT COUNT(*)::int as n FROM businesses WHERE tenant_id = $1 AND website_status = 'no_website'", [tid]);
  const { rows: [brk] } = await pool.query("SELECT COUNT(*)::int as n FROM businesses WHERE tenant_id = $1 AND website_status IN ('broken', 'blocked')", [tid]);
  const { rows: byPipeline } = await pool.query("SELECT pipeline_status, COUNT(*)::int as n FROM businesses WHERE tenant_id = $1 GROUP BY pipeline_status", [tid]);
  const { rows: byCity } = await pool.query("SELECT city, COUNT(*)::int as n FROM businesses WHERE tenant_id = $1 AND city != '' GROUP BY city ORDER BY n DESC LIMIT 15", [tid]);
  res.json({ total: tot.n, noWebsite: now.n, broken: brk.n, byPipeline, byCity });
});

// ─── Website reachability checker ─────────────────────────────────
function normalizeUrl(url) {
  if (!url) return null;
  let u = url.trim();
  if (!/^https?:\/\//i.test(u)) u = `https://${u}`;
  return u;
}

function isPrivateIp(ip) {
  const v = String(ip || "").toLowerCase();
  if (v === "localhost") return true;
  if (v === "::1" || v === "::" || v === "0:0:0:0:0:0:0:1") return true;
  if (v.startsWith("fe80:") || v.startsWith("fc") || v.startsWith("fd")) return true; // IPv6 link-local/ULA
  if (v.startsWith("::ffff:")) {
    const mapped = v.slice(7);
    return isPrivateIp(mapped);
  }
  const parts = v.split(".").map(Number);
  if (parts.length === 4 && parts.every(n => Number.isInteger(n) && n >= 0 && n <= 255)) {
    const [a, b] = parts;
    if (a === 0 || a === 10 || a === 127) return true;
    if (a === 169 && b === 254) return true; // link-local + metadata
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT
    if (a === 198 && (b === 18 || b === 19)) return true; // benchmarking
    if (a >= 224) return true; // multicast/reserved
  }
  // Block common metadata hostnames handled by caller; IP checks cover numeric forms.
  return false;
}

const BLOCKED_HOSTNAMES = new Set([
  "localhost",
  "metadata.google.internal",
  "metadata.goog",
  "instance-data",
  "169.254.169.254",
]);

async function validateSafeUrl(target) {
  let parsed;
  try { parsed = new URL(target); } catch { throw new Error("Invalid URL"); }
  if (!["http:", "https:"].includes(parsed.protocol)) throw new Error("Unsupported protocol");
  const host = parsed.hostname.toLowerCase();
  if (BLOCKED_HOSTNAMES.has(host)) throw new Error("Blocked host");
  if (isPrivateIp(host)) throw new Error("Blocked private address");
  let addresses;
  try {
    addresses = await dns.lookup(host, { all: true, verbatim: true });
  } catch {
    throw new Error("DNS resolution failed");
  }
  if (!addresses || addresses.length === 0) throw new Error("DNS resolution failed");
  for (const addr of addresses) {
    if (isPrivateIp(addr.address)) throw new Error("Blocked private address");
  }
  return parsed.href;
}

async function safeFetch(url, method, timeoutMs = 8000, maxRedirects = 5) {
  let current = await validateSafeUrl(url);
  for (let i = 0; i <= maxRedirects; i++) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    let resp;
    try {
      resp = await fetch(current, { method, redirect: "manual", signal: controller.signal });
    } finally {
      clearTimeout(timeout);
    }
    if (resp.status >= 300 && resp.status < 400) {
      const loc = resp.headers.get("location");
      if (!loc) return resp;
      const nextUrl = new URL(loc, current).href;
      current = await validateSafeUrl(nextUrl);
      continue;
    }
    return resp;
  }
  throw new Error("Too many redirects");
}

async function fetchWithTimeout(url, method, timeoutMs = 8000) {
  return await safeFetch(url, method, timeoutMs);
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
    (tenant_id, id, name, category, address, city, phone, rating, reviews, website_url, website_status, location_query, source, scraped_on)
  VALUES
    ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
`;

const UPDATE_BUSINESS_SQL = `
  UPDATE businesses SET
    category = COALESCE(NULLIF($3, ''), category),
    address = COALESCE(NULLIF($4, ''), address),
    city = COALESCE(NULLIF($5, ''), city),
    rating = COALESCE(NULLIF($6, ''), rating),
    reviews = COALESCE(NULLIF($7, ''), reviews),
    website_url = COALESCE(NULLIF($8, ''), website_url),
    website_status = CASE WHEN $9 != '' THEN $9 ELSE website_status END,
    location_query = COALESCE(NULLIF($10, ''), location_query),
    scraped_on = $11
  WHERE tenant_id = $1 AND id = $2
`;

async function findExistingBusiness(b, tenantId) {
  const phone = cleanPhone(b.phone || "") || "";
  if (phone) {
    const { rows } = await pool.query("SELECT id FROM businesses WHERE tenant_id = $1 AND phone = $2 LIMIT 1", [tenantId, phone]);
    if (rows.length > 0) return rows[0].id;
    const { rows: rows2 } = await pool.query("SELECT id FROM businesses WHERE tenant_id = $1 AND LOWER(name) = LOWER($2) AND phone = $3 LIMIT 1", [tenantId, b.name || "", phone]);
    if (rows2.length > 0) return rows2[0].id;
  }
  return null;
}

async function upsertBusiness(b, location, tenantId = 1) {
  const scraped_on = new Date().toISOString().slice(0, 10);
  const row = {
    tenant_id: tenantId,
    id: b.id || `scraped-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    name: b.name || "", category: b.category || "", address: b.address || "",
    city: b.city || location || "", phone: cleanPhone(b.phone || "") || "",
    rating: b.rating || "", reviews: b.reviews || "",
    website_url: b.website_url || "", website_status: b.website_status || (b.website_url ? "unchecked" : "no_website"),
    location_query: b.query || b.location_query || "", source: b.source || "Google Maps", scraped_on,
  };
  const existing_id = await findExistingBusiness(row, tenantId);
  if (existing_id) {
    await pool.query(UPDATE_BUSINESS_SQL, [
      tenantId, existing_id, row.category, row.address, row.city, row.rating, row.reviews,
      row.website_url, row.website_status, row.location_query, row.scraped_on,
    ]);
    return { ...row, id: existing_id, inserted: false };
  }
  try {
    await pool.query(INSERT_BUSINESS_SQL, [
      tenantId, row.id, row.name, row.category, row.address, row.city, row.phone,
      row.rating, row.reviews, row.website_url, row.website_status,
      row.location_query, row.source, row.scraped_on,
    ]);
    return { ...row, inserted: true };
  } catch (err) {
    if (err.code !== "23505") throw err;
    let conflictId = await findExistingBusiness(row, tenantId);
    if (!conflictId) {
      const { rows } = await pool.query("SELECT id FROM businesses WHERE tenant_id = $1 AND id = $2", [tenantId, row.id]);
      if (rows.length > 0) conflictId = rows[0].id;
    }
    if (conflictId) {
      await pool.query(UPDATE_BUSINESS_SQL, [
        tenantId, conflictId, row.category, row.address, row.city, row.rating, row.reviews,
        row.website_url, row.website_status, row.location_query, row.scraped_on,
      ]);
      return { ...row, id: conflictId, inserted: false };
    }
    throw err;
  }
}

// Re-check (or first-check) websites for a given set of business ids.
app.post("/api/check-websites", async (req, res) => {
  const { ids } = req.body || {};
  const tid = req.user.tenant_id;
  if (DEMO_MODE) {
    const statuses = ["working", "broken", "blocked"];
    const rowsToCheck = ids && ids.length
      ? (await pool.query(`SELECT id FROM businesses WHERE tenant_id = $1 AND id IN (${ids.map((_, i) => `$${i + 2}`).join(",")})`, [tid, ...ids])).rows
      : (await pool.query("SELECT id FROM businesses WHERE tenant_id = $1 AND website_status = 'unchecked'", [tid])).rows;
    const results = [];
    for (const row of rowsToCheck) {
      const status = statuses[Math.floor(Math.random() * statuses.length)];
      const checkedAt = new Date().toISOString();
      await pool.query("UPDATE businesses SET website_status = $1, website_checked_at = $2 WHERE tenant_id = $3 AND id = $4", [status, checkedAt, tid, row.id]);
      results.push({ id: row.id, website_status: status, website_checked_at: checkedAt });
    }
    return res.json({ ok: true, checked: results.length, results, demoMode: true });
  }
  const rows = ids && ids.length
    ? (await pool.query(`SELECT id, website_url FROM businesses WHERE tenant_id = $1 AND id IN (${ids.map((_, i) => `$${i + 2}`).join(",")})`, [tid, ...ids])).rows
    : (await pool.query("SELECT id, website_url FROM businesses WHERE tenant_id = $1 AND website_status = 'unchecked'", [tid])).rows;

  const results = await runWithConcurrency(rows, 6, async (row) => {
    const status = await checkWebsite(row.website_url);
    const checkedAt = new Date().toISOString();
    await pool.query("UPDATE businesses SET website_status = $1, website_checked_at = $2 WHERE tenant_id = $3 AND id = $4", [status, checkedAt, tid, row.id]);
    return { id: row.id, website_status: status, website_checked_at: checkedAt };
  });
  res.json({ ok: true, checked: results.length, results });
});

// ─── Google Maps Scraper (BullMQ background job) ─────────────────────

async function runScrapeJob(params) {
  const { location, categories, maxPerQuery = 20, headless = true, jobId, tenantId = 1 } = params;
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
      if (cancelledJobs.has(jobId)) break;
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

        for (let i = 0; i < 8 && !cancelledJobs.has(jobId); i++) {
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
          if (cancelledJobs.has(jobId)) break;
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
              const saved = await upsertBusiness(data, location, tenantId);
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
      await runWithConcurrency(toCheck, 6, async (b) => {
        const status = await checkWebsite(b.website_url);
        const checkedAt = new Date().toISOString();
        await pool.query("UPDATE businesses SET website_status = $1, website_checked_at = $2 WHERE tenant_id = $3 AND id = $4", [status, checkedAt, tenantId, b.id]);
      });
      logger.info({ count: toCheck.length }, "website checks complete");
    }

    const wasCancelled = cancelledJobs.has(jobId);
    cancelledJobs.delete(jobId);
    return { ok: true, count: inserted + updated, inserted, updated, skippedInRun, cancelled: wasCancelled, pendingWebsiteChecks: toCheck.length };
  } catch (err) {
    if (browser) await browser.close().catch(() => {});
    cancelledJobs.delete(jobId);
    logger.error({ error: err.message }, "scrape fatal error");
    throw err;
  }
}

if (!DEMO_MODE) {
  const scrapeWorker = new Worker("scrape", async (job) => {
    const { location, categories } = job.data;
    if (!location || !categories || !categories.length) {
      throw new Error("location and at least one category are required");
    }
    return await runScrapeJob({ ...job.data, jobId: job.id, tenantId: job.data.tenantId || 1 });
  }, { connection: redisConnection, concurrency: 1 });

  scrapeWorker.on("failed", (job, err) => {
    logger.error({ error: err.message, jobId: job?.id }, "scrape job failed");
  });

  scrapeWorker.on("completed", (job) => {
    logger.info({ jobId: job.id, result: job.returnvalue }, "scrape job completed");
  });
}

app.post("/api/scrape", async (req, res) => {
  const { location, categories, maxPerQuery = 20, headless = true } = req.body;
  if (!location || !categories || !categories.length) {
    return res.status(400).json({ error: "location and at least one category are required" });
  }

  const tid = req.user.tenant_id;
  if (DEMO_MODE) {
    let inserted = 0;
    let updated = 0;
    for (const cat of categories) {
      const count = Math.min(maxPerQuery, 50);
      for (let i = 0; i < count; i++) {
        const bizId = `demo-scrape-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        try {
          await pool.query(
            `INSERT INTO businesses (tenant_id, id, name, category, address, city, phone, rating, reviews, website_url, website_status, website_checked_at, location_query, source, scraped_on, pipeline_status, pipeline_updated_at)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)`,
            [
              tid, bizId, `${cat} Demo ${i + 1}`, cat,
              `${Math.floor(Math.random() * 999) + 1}, Demo Street`, location,
              `+9199${String(Math.floor(Math.random() * 100000000)).padStart(8, "0")}`,
              (3 + Math.random() * 2).toFixed(1), String(Math.floor(Math.random() * 300)),
              Math.random() < 0.4 ? `https://demo-${cat.toLowerCase().replace(/ /g, "")}.example.com` : "",
              ["no_website", "broken", "blocked", "working"][Math.floor(Math.random() * 4)],
              new Date().toISOString(), `${cat} in ${location}`, "Google Maps",
              new Date().toISOString().slice(0, 10), "not_contacted", "",
            ]
          );
          inserted++;
        } catch (err) {
          if (err.code === "23505") { updated++; continue; }
          throw err;
        }
      }
    }
    return res.json({
      ok: true, jobId: "demo-" + Date.now(),
      count: inserted + updated, inserted, updated, demoMode: true,
    });
  }

  // Check for active jobs in the queue
  const activeJobs = await scrapeQueue.getActive();
  const waitingJobs = await scrapeQueue.getWaiting();
  if (activeJobs.length > 0 || waitingJobs.length > 0) {
    return res.status(409).json({ error: "A scrape is already running. Cancel it or wait for it to finish." });
  }

  const job = await scrapeQueue.add("scrape", { location, categories, maxPerQuery, headless, tenantId: req.user.tenant_id }, {
    removeOnComplete: { age: 3600 },
    removeOnFail: { age: 3600 },
  });
  res.json({ ok: true, jobId: job.id });
});

app.post("/api/scrape/cancel", async (req, res) => {
  if (DEMO_MODE) return res.json({ ok: true, cancelled: false });
  const activeJobs = await scrapeQueue.getActive();
  const waitingJobs = await scrapeQueue.getWaiting();
  const jobs = [...activeJobs, ...waitingJobs];
  if (jobs.length === 0) return res.json({ ok: true, cancelled: false });

  for (const job of jobs) {
    cancelledJobs.set(job.id, true);
  }
  res.json({ ok: true, cancelled: true });
});

app.get("/api/scrape/status/:jobId", async (req, res) => {
  if (DEMO_MODE) return res.json({ jobId: req.params.jobId, state: "completed", result: { count: 0, inserted: 0, updated: 0 }, error: null });
  const { jobId } = req.params;
  const job = await scrapeQueue.getJob(jobId);
  if (!job) return res.status(404).json({ error: "Job not found" });
  const state = await job.getState();
  const result = state === "completed" ? job.returnvalue : null;
  const failedReason = state === "failed" ? job.failedReason : null;
  res.json({ jobId, state, result, error: failedReason });
});

// ─── WhatsApp Session State ───────────────────────────────────────
let waBrowser = null;
let waPage = null;
let waStatus = "disconnected";
let sendQueue = [];
let sendState = { running: false, paused: false, index: 0, sentCount: 0, failCount: 0, total: 0 };

app.post("/api/wa/connect", async (req, res) => {
  if (DEMO_MODE) return res.json({ ok: true, status: "connected", demoMode: true });
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
  if (DEMO_MODE) return res.json({ status: "connected", sendState: { running: false, paused: false, index: 0, sentCount: 0, failCount: 0, total: 0 } });
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
  if (DEMO_MODE) return res.json({ ok: true });
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
  if (DEMO_MODE) {
    const { businesses: bizList, message } = req.body;
    if (!bizList || !bizList.length) return res.status(400).json({ error: "No businesses provided" });
    const tid = req.user.tenant_id;
    for (const biz of bizList) {
      const now = new Date().toISOString();
      const msg = (message || "").replace(/\{name\}/g, biz.name).replace(/\{category\}/g, biz.category || "");
      await pool.query("UPDATE businesses SET pipeline_status = 'contacted', pipeline_updated_at = $1, message_sent = $2, message_sent_at = $3 WHERE tenant_id = $4 AND id = $5",
        [now, msg, now, tid, biz.id]);
      await pool.query("INSERT INTO send_log (tenant_id, business_id, business_name, phone, status) VALUES ($1,$2,$3,$4,$5)",
        [tid, biz.id, biz.name, biz.phone || "", "sent"]);
    }
    return res.json({ ok: true, total: bizList.length, demoMode: true });
  }
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
      await pool.query("INSERT INTO send_log (tenant_id, business_id, business_name, phone, status, reason) VALUES ($1, $2, $3, $4, $5, $6)",
        [req.user.tenant_id, biz.id, biz.name, biz.phone || "", "skipped", "Duplicate phone in this send queue"]);
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
        await pool.query("INSERT INTO send_log (tenant_id, business_id, business_name, phone, status, reason) VALUES ($1, $2, $3, $4, $5, $6)",
          [req.user.tenant_id, biz.id, biz.name, biz.phone || "", "skipped", "No phone number"]);
        continue;
      }

      try {
        const msg = message.replace(/\{name\}/g, biz.name).replace(/\{category\}/g, biz.category || "your business");
        await sendWhatsAppMessage(biz.phone, msg);
        sendState.sentCount++;
        const now = new Date().toISOString();
        const tid = req.user.tenant_id;
        const { rows } = await pool.query("SELECT name, pipeline_status FROM businesses WHERE tenant_id = $1 AND id = $2", [tid, biz.id]);
        const current = rows[0];
        await pool.query("UPDATE businesses SET pipeline_status = 'contacted', pipeline_updated_at = $1, message_sent = $2, message_sent_at = $3 WHERE tenant_id = $4 AND id = $5",
          [now, msg, now, tid, biz.id]);
        if (current && current.pipeline_status !== "contacted") {
          await pool.query("INSERT INTO pipeline_history (tenant_id, business_id, business_name, old_status, new_status) VALUES ($1, $2, $3, $4, $5)",
            [tid, biz.id, current.name, current.pipeline_status, "contacted"]);
        }
        await pool.query("INSERT INTO send_log (tenant_id, business_id, business_name, phone, status) VALUES ($1, $2, $3, $4, $5)",
          [tid, biz.id, biz.name, biz.phone, "sent"]);
      } catch (err) {
        sendState.failCount++;
        await pool.query("INSERT INTO send_log (tenant_id, business_id, business_name, phone, status, reason) VALUES ($1, $2, $3, $4, $5, $6)",
          [req.user.tenant_id, biz.id, biz.name, biz.phone, "failed", err.message]);
      }

      if (i < sendQueue.length - 1 && sendState.running && !sendState.paused) {
        const jitter = Math.floor(delaySeconds * 1000 + (Math.random() - 0.5) * 10000);
        await new Promise(r => setTimeout(r, Math.max(5000, jitter)));
      }
    }
    sendState.running = false;
  })();
});

app.post("/api/wa/pause", (req, res) => { if (DEMO_MODE) return res.json({ ok: true, paused: false }); sendState.paused = !sendState.paused; res.json({ ok: true, paused: sendState.paused }); });
app.post("/api/wa/stop", (req, res) => { if (DEMO_MODE) return res.json({ ok: true }); sendState.running = false; sendState.paused = false; res.json({ ok: true }); });

app.get("/api/send-log", async (req, res) => {
  const { rows } = await pool.query("SELECT * FROM send_log WHERE tenant_id = $1 ORDER BY sent_at DESC LIMIT 200", [req.user.tenant_id]);
  res.json(rows);
});

app.get("/api/pipeline-history", async (req, res) => {
  const { rows } = await pool.query("SELECT * FROM pipeline_history WHERE tenant_id = $1 ORDER BY changed_at DESC LIMIT 300", [req.user.tenant_id]);
  res.json(rows);
});

// ─── Health / readiness ───────────────────────────────────────────
app.get("/health", async (req, res) => {
  res.json({ status: "ok", demoMode: DEMO_MODE, timestamp: new Date().toISOString() });
});

app.get("/ready", async (req, res) => {
  try {
    await pool.query("SELECT 1");
    if (!DEMO_MODE && redisConnection) {
      await redisConnection.ping();
    }
    res.json({ ready: true, demoMode: DEMO_MODE });
  } catch (err) {
    res.status(503).json({ ready: false, error: err.message });
  }
});

app.get("/api/health", async (req, res) => {
  res.json({ status: "ok", demoMode: DEMO_MODE, timestamp: new Date().toISOString() });
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

      if (DEMO_MODE) {
        const { seedDemoData } = await import("./seed-demo.js");
        const result = await seedDemoData(pool);
        logger.info({ seeded: result.seeded, count: result.count }, "demo mode seed");
      }

      server = app.listen(PORT, () => {
        logger.info({ port: PORT, database: DATABASE_URL, demoMode: DEMO_MODE }, "server started");
      });

      const shutdown = async (signal) => {
        logger.info({ signal }, "shutting down");
        try { server.close(); } catch {}
        if (typeof scrapeQueue !== "undefined" && scrapeQueue) await scrapeQueue.close().catch(() => {});
        if (redisConnection) await redisConnection.quit().catch(() => {});
        await pool.end().catch(() => {});
        process.exit(0);
      };
      process.on("SIGTERM", shutdown);
      process.on("SIGINT", shutdown);
    } catch (err) {
      logger.error({ error: err.message }, "failed to start server");
      process.exit(1);
    }
  };
  start();
}

export { app, server, pool, normalizeUrl, looksLikeBotChallenge, cleanPhone, isPrivateIp, findExistingBusiness, upsertBusiness, checkWebsite, checkWebsiteOnce, runWithConcurrency, sendWhatsAppMessage, requireAuth, JWT_SECRET, DATA_DIR, initDb };
