import express from "express";
import cors from "cors";
import puppeteer from "puppeteer";
import Database from "better-sqlite3";
import { fileURLToPath } from "url";
import path from "path";
import fs from "fs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const DATA_DIR = path.join(__dirname, "data");
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR);

// ─── SQLite Database ────────────────────────────────────────────
const db = new Database(path.join(DATA_DIR, "pipeline.db"));

db.exec(`
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
    created_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS send_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    business_id TEXT,
    business_name TEXT,
    phone TEXT,
    status TEXT,
    reason TEXT DEFAULT '',
    sent_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS config (
    key TEXT PRIMARY KEY,
    value TEXT
  );

  CREATE TABLE IF NOT EXISTS pipeline_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    business_id TEXT,
    business_name TEXT,
    old_status TEXT,
    new_status TEXT,
    changed_at TEXT DEFAULT (datetime('now'))
  );
`);

for (const [column, definition] of [
  ["website_checked_at", "TEXT DEFAULT ''"],
  ["pipeline_updated_at", "TEXT DEFAULT ''"],
]) {
  const exists = db.prepare("PRAGMA table_info(businesses)").all().some(c => c.name === column);
  if (!exists) db.exec(`ALTER TABLE businesses ADD COLUMN ${column} ${definition}`);
}
db.exec(`
  CREATE UNIQUE INDEX IF NOT EXISTS idx_business_phone_nonempty ON businesses(phone) WHERE phone != '';
  CREATE UNIQUE INDEX IF NOT EXISTS idx_business_name_phone_nonempty ON businesses(LOWER(name), phone) WHERE name != '' AND phone != '';
`);

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

// ─── Config endpoints ────────────────────────────────────────────
app.get("/api/config", (req, res) => {
  const rows = db.prepare("SELECT key, value FROM config").all();
  const cfg = {};
  rows.forEach(r => { try { cfg[r.key] = JSON.parse(r.value); } catch { cfg[r.key] = r.value; } });
  res.json(cfg);
});

app.post("/api/config", (req, res) => {
  const upsert = db.prepare("INSERT OR REPLACE INTO config (key, value) VALUES (?, ?)");
  const insertMany = db.transaction((entries) => {
    for (const [k, v] of entries) upsert.run(k, JSON.stringify(v));
  });
  insertMany(Object.entries(req.body));
  res.json({ ok: true });
});

// ─── Business (spreadsheet) endpoints ─────────────────────────────
app.get("/api/businesses", (req, res) => {
  const { search, website_status, pipeline_status, city, page, pageSize } = req.query;
  let where = "WHERE 1=1";
  const params = [];
  if (search) { where += " AND (name LIKE ? OR category LIKE ? OR phone LIKE ? OR address LIKE ?)"; const s = `%${search}%`; params.push(s, s, s, s); }
  if (website_status) { where += " AND website_status = ?"; params.push(website_status); }
  if (pipeline_status) { where += " AND pipeline_status = ?"; params.push(pipeline_status); }
  if (city) { where += " AND city = ?"; params.push(city); }
  const total = db.prepare(`SELECT COUNT(*) as n FROM businesses ${where}`).get(...params).n;
  let query = `SELECT * FROM businesses ${where} ORDER BY created_at DESC`;
  if (page && pageSize) {
    const p = parseInt(page, 10) || 1;
    const ps = parseInt(pageSize, 10) || 100;
    query += ` LIMIT ${ps} OFFSET ${(p - 1) * ps}`;
  }
  const rows = db.prepare(query).all(...params);
  res.json({ data: rows, total });
});

app.post("/api/businesses", (req, res) => {
  const biz = req.body;
  const items = Array.isArray(biz) ? biz : [biz];
  let inserted = 0;
  let updated = 0;
  for (const b of items) {
    const saved = upsertBusiness(b, b.city || "");
    if (saved.inserted) inserted++; else updated++;
  }
  res.json({ ok: true, count: inserted + updated, inserted, updated });
});

app.patch("/api/businesses/:id", (req, res) => {
  const { id } = req.params;
  const updates = req.body;
  const allowed = ["name","category","address","city","phone","rating","reviews","website_url","website_status","pipeline_status","notes","message_sent","message_sent_at"];
  const keys = Object.keys(updates).filter(k => allowed.includes(k));
  if (!keys.length) return res.json({ ok: true });
  const VALID_PIPELINE_STATUSES = ["not_contacted","contacted","interested","will_talk_later","not_interested","completed"];
  if (keys.includes("pipeline_status") && !VALID_PIPELINE_STATUSES.includes(updates.pipeline_status)) {
    return res.status(400).json({ error: `Invalid pipeline_status. Must be one of: ${VALID_PIPELINE_STATUSES.join(", ")}` });
  }
  const fields = keys.map(k => `${k} = @${k}`).join(", ");
  const payload = { id };
  keys.forEach(k => payload[k] = updates[k]);
  if (keys.includes("pipeline_status")) {
    const current = db.prepare("SELECT name, pipeline_status FROM businesses WHERE id = ?").get(id);
    payload.pipeline_updated_at = new Date().toISOString();
    db.prepare(`UPDATE businesses SET ${fields}, pipeline_updated_at = @pipeline_updated_at WHERE id = @id`).run(payload);
    if (current && current.pipeline_status !== updates.pipeline_status) {
      db.prepare("INSERT INTO pipeline_history (business_id, business_name, old_status, new_status) VALUES (?, ?, ?, ?)")
        .run(id, current.name, current.pipeline_status, updates.pipeline_status);
    }
  } else {
    db.prepare(`UPDATE businesses SET ${fields} WHERE id = @id`).run(payload);
  }
  res.json({ ok: true });
});

app.delete("/api/businesses", (req, res) => {
  const { ids } = req.body;
  if (Array.isArray(ids)) {
    if (ids.length === 0) return res.json({ ok: true });
    const placeholders = ids.map(() => "?").join(",");
    db.prepare(`DELETE FROM businesses WHERE id IN (${placeholders})`).run(...ids);
  } else {
    db.prepare("DELETE FROM businesses").run();
  }
  res.json({ ok: true });
});


// ─── Local competitor website examples ───────────────────────────
// For pitching no-website/broken-site leads: show similar businesses in the
// same city/category that already have working websites.
app.get("/api/businesses/:id/competitor-examples", (req, res) => {
  const { id } = req.params;
  const target = db.prepare("SELECT * FROM businesses WHERE id = ?").get(id);
  if (!target) return res.status(404).json({ error: "Business not found" });

  const category = (target.category || "").trim();
  const city = (target.city || "").trim();
  const params = [id];
  let query = `
    SELECT id, name, category, address, city, phone, rating, reviews, website_url, website_status
    FROM businesses
    WHERE id != ?
      AND website_url != ''
      AND website_status = 'working'
  `;

  // Prefer same city/locality. If city is missing, fall back to category only.
  if (city) {
    query += " AND city = ?";
    params.push(city);
  }

  // Similar category match. LIKE is intentional because Google categories can vary
  // slightly: e.g. "Dental clinic" vs "Dentist".
  if (category) {
    query += " AND (LOWER(category) LIKE LOWER(?) OR LOWER(?) LIKE '%' || LOWER(category) || '%')";
    params.push(`%${category}%`, category);
  }

  query += `
    ORDER BY
      CASE WHEN rating != '' THEN CAST(rating AS REAL) ELSE 0 END DESC,
      CASE WHEN reviews != '' THEN CAST(REPLACE(REPLACE(reviews, ',', ''), '.', '') AS INTEGER) ELSE 0 END DESC,
      name ASC
    LIMIT 8
  `;

  let examples = db.prepare(query).all(...params);

  // Fallback: if exact city+category is too strict, show same city businesses with
  // working sites so the user still has local proof examples.
  if (examples.length === 0 && city) {
    examples = db.prepare(`
      SELECT id, name, category, address, city, phone, rating, reviews, website_url, website_status
      FROM businesses
      WHERE id != ?
        AND city = ?
        AND website_url != ''
        AND website_status = 'working'
      ORDER BY
        CASE WHEN rating != '' THEN CAST(rating AS REAL) ELSE 0 END DESC,
        CASE WHEN reviews != '' THEN CAST(REPLACE(REPLACE(reviews, ',', ''), '.', '') AS INTEGER) ELSE 0 END DESC,
        name ASC
      LIMIT 8
    `).all(id, city);
  }

  res.json({ target, examples });
});

// ─── Stats endpoint ───────────────────────────────────────────────
app.get("/api/stats", (req, res) => {
  const total = db.prepare("SELECT COUNT(*) as n FROM businesses").get().n;
  const noWebsite = db.prepare("SELECT COUNT(*) as n FROM businesses WHERE website_status = 'no_website'").get().n;
  const broken = db.prepare("SELECT COUNT(*) as n FROM businesses WHERE website_status IN ('broken', 'blocked')").get().n;
  const byPipeline = db.prepare("SELECT pipeline_status, COUNT(*) as n FROM businesses GROUP BY pipeline_status").all();
  const byCity = db.prepare("SELECT city, COUNT(*) as n FROM businesses WHERE city != '' GROUP BY city ORDER BY n DESC LIMIT 15").all();
  res.json({ total, noWebsite, broken, byPipeline, byCity });
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

const insertBusinessStmt = db.prepare(`
  INSERT INTO businesses
    (id, name, category, address, city, phone, rating, reviews, website_url, website_status, location_query, source, scraped_on)
  VALUES
    (@id, @name, @category, @address, @city, @phone, @rating, @reviews, @website_url, @website_status, @location_query, @source, @scraped_on)
`);

const updateExistingBusinessStmt = db.prepare(`
  UPDATE businesses SET
    category = COALESCE(NULLIF(@category, ''), category),
    address = COALESCE(NULLIF(@address, ''), address),
    city = COALESCE(NULLIF(@city, ''), city),
    rating = COALESCE(NULLIF(@rating, ''), rating),
    reviews = COALESCE(NULLIF(@reviews, ''), reviews),
    website_url = COALESCE(NULLIF(@website_url, ''), website_url),
    website_status = CASE WHEN @website_status != '' THEN @website_status ELSE website_status END,
    location_query = COALESCE(NULLIF(@location_query, ''), location_query),
    scraped_on = @scraped_on
  WHERE id = @existing_id
`);

function findExistingBusiness(b) {
  const phone = cleanPhone(b.phone || "") || "";
  if (phone) {
    const byPhone = db.prepare("SELECT id FROM businesses WHERE phone = ? LIMIT 1").get(phone);
    if (byPhone) return byPhone.id;
    const byNamePhone = db.prepare("SELECT id FROM businesses WHERE LOWER(name) = LOWER(?) AND phone = ? LIMIT 1").get(b.name || "", phone);
    if (byNamePhone) return byNamePhone.id;
  }
  return null;
}

function upsertBusiness(b, location) {
  const scraped_on = new Date().toISOString().slice(0, 10);
  const row = {
    id: b.id || `scraped-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    name: b.name || "", category: b.category || "", address: b.address || "",
    city: b.city || location || "", phone: cleanPhone(b.phone || "") || "",
    rating: b.rating || "", reviews: b.reviews || "",
    website_url: b.website_url || "", website_status: b.website_status || (b.website_url ? "unchecked" : "no_website"),
    location_query: b.query || b.location_query || "", source: b.source || "Google Maps", scraped_on,
  };
  const existing_id = findExistingBusiness(row);
  if (existing_id) {
    updateExistingBusinessStmt.run({ ...row, existing_id });
    return { ...row, id: existing_id, inserted: false };
  }
  insertBusinessStmt.run(row);
  return { ...row, inserted: true };
}

// Re-check (or first-check) websites for a given set of business ids.
// Runs sequentially with a small stagger to avoid hammering many hosts at once.
app.post("/api/check-websites", async (req, res) => {
  const { ids } = req.body;
  const rows = ids && ids.length
    ? db.prepare(`SELECT id, website_url FROM businesses WHERE id IN (${ids.map(() => "?").join(",")})`).all(...ids)
    : db.prepare("SELECT id, website_url FROM businesses WHERE website_status = 'unchecked'").all();

  const results = await runWithConcurrency(rows, 6, async (row) => {
    const status = await checkWebsite(row.website_url);
    const checkedAt = new Date().toISOString();
    db.prepare("UPDATE businesses SET website_status = ?, website_checked_at = ? WHERE id = ?").run(status, checkedAt, row.id);
    return { id: row.id, website_status: status, website_checked_at: checkedAt };
  });
  res.json({ ok: true, checked: results.length, results });
});

// ─── Google Maps Scraper (captures ALL businesses — with or without a site) ──
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
      console.log(`Scraping: ${query}`);
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

        console.log(`Found ${hrefs.length} listings for "${query}"`);

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
              const saved = upsertBusiness(data, location);
              if (saved.inserted) inserted++; else updated++;
              if (saved.website_url) toCheckById.set(saved.id, { id: saved.id, website_url: saved.website_url });
              console.log(`  ✓ ${name} | phone: ${data.phone || "MISSING"} | site: ${data.website_url || "none"} | ${saved.inserted ? "inserted" : "updated"}`);
            }

            await page.goBack({ waitUntil: "domcontentloaded", timeout: 15000 }).catch(() => {});
            await new Promise(r => setTimeout(r, 1500));
          } catch (err) {
            console.log(`  ⚠ Error on ${name}: ${err.message}`);
          }
        }
      } catch (err) {
        console.error(`Error scraping "${query}":`, err.message);
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
          db.prepare("UPDATE businesses SET website_status = ?, website_checked_at = ? WHERE id = ?").run(status, checkedAt, b.id);
        });
        console.log(`✅ Website checks complete for ${toCheck.length} businesses`);
      })();
    }

    res.json({ ok: true, count: inserted + updated, inserted, updated, skippedInRun, cancelled: job.cancelled, pendingWebsiteChecks: toCheck.length });
  } catch (err) {
    if (browser) await browser.close().catch(() => {});
    console.error("Scrape error:", err);
    res.status(500).json({ error: err.message });
  } finally {
    job.done = true;
    if (activeScrapeJob === job) activeScrapeJob = null;
  }
});

// ─── WhatsApp Session State ───────────────────────────────────────
let waBrowser = null;
let waPage = null;
let waStatus = "disconnected"; // disconnected | connecting | qr_ready | connected
let sendQueue = [];
let sendState = { running: false, paused: false, index: 0, sentCount: 0, failCount: 0, total: 0 };

app.post("/api/wa/connect", async (req, res) => {
  if (waStatus === "connected") return res.json({ ok: true, status: "connected" });

  try {
    if (waBrowser) { await waBrowser.close().catch(() => {}); }

    const WA_SESSION_DIR = path.join(DATA_DIR, "wa_session");
    if (!fs.existsSync(WA_SESSION_DIR)) fs.mkdirSync(WA_SESSION_DIR, { recursive: true });

    waBrowser = await puppeteer.launch({
      headless: false, // must be visible so the user can scan the QR
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
      console.log("✅ WhatsApp already connected via saved session");
      return res.json({ ok: true, status: "connected" });
    }

    waStatus = "qr_ready";
    console.log("📱 QR code ready — scan it in the opened browser window");
    res.json({ ok: true, status: "qr_ready" });

    waPage.waitForSelector('[data-testid="chat-list"]', { timeout: 120000 })
      .then(() => { waStatus = "connected"; console.log("✅ WhatsApp connected after QR scan"); })
      .catch((e) => { waStatus = "disconnected"; console.error("❌ WA connect timeout:", e.message); });

  } catch (err) {
    waStatus = "disconnected";
    console.error("WA connect error:", err);
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
      db.prepare("INSERT INTO send_log (business_id, business_name, phone, status, reason) VALUES (?, ?, ?, ?, ?)")
        .run(biz.id, biz.name, biz.phone || "", "skipped", "Duplicate phone in this send queue");
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
        db.prepare("INSERT INTO send_log (business_id, business_name, phone, status, reason) VALUES (?, ?, ?, ?, ?)")
          .run(biz.id, biz.name, biz.phone || "", "skipped", "No phone number");
        continue;
      }

      try {
        const msg = message.replace(/\{name\}/g, biz.name).replace(/\{category\}/g, biz.category || "your business");
        await sendWhatsAppMessage(biz.phone, msg);
        sendState.sentCount++;
        const now = new Date().toISOString();
        const current = db.prepare("SELECT name, pipeline_status FROM businesses WHERE id = ?").get(biz.id);
        db.prepare("UPDATE businesses SET pipeline_status = 'contacted', pipeline_updated_at = ?, message_sent = ?, message_sent_at = ? WHERE id = ?")
          .run(now, msg, now, biz.id);
        if (current && current.pipeline_status !== "contacted") {
          db.prepare("INSERT INTO pipeline_history (business_id, business_name, old_status, new_status) VALUES (?, ?, ?, ?)")
            .run(biz.id, current.name, current.pipeline_status, "contacted");
        }
        db.prepare("INSERT INTO send_log (business_id, business_name, phone, status) VALUES (?, ?, ?, ?)")
          .run(biz.id, biz.name, biz.phone, "sent");
      } catch (err) {
        sendState.failCount++;
        db.prepare("INSERT INTO send_log (business_id, business_name, phone, status, reason) VALUES (?, ?, ?, ?, ?)")
          .run(biz.id, biz.name, biz.phone, "failed", err.message);
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

app.get("/api/send-log", (req, res) => {
  res.json(db.prepare("SELECT * FROM send_log ORDER BY sent_at DESC LIMIT 200").all());
});

app.get("/api/pipeline-history", (req, res) => {
  res.json(db.prepare("SELECT * FROM pipeline_history ORDER BY changed_at DESC LIMIT 300").all());
});

// ─── Serve frontend (production build) ───────────────────────────
const distPath = path.join(__dirname, "dist");
if (fs.existsSync(distPath)) {
  app.use(express.static(distPath));
  app.get("*", (req, res) => res.sendFile(path.join(distPath, "index.html")));
}

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`\n✅ Lead Pipeline Server running on http://localhost:${PORT}`);
  console.log(`   Database: ${path.join(DATA_DIR, "pipeline.db")}\n`);
});
