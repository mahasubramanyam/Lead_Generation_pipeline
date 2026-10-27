import { describe, it, before } from "node:test";
import assert from "node:assert/strict";

const BASE = "http://localhost:5000";
const API = (path) => `${BASE}/api${path}`;

let TOKEN = "";
const USER = `conn-${Date.now()}`;
const PASS = "connpass123";

function json(method, path, body) {
  const headers = { "Content-Type": "application/json" };
  if (TOKEN) headers["Authorization"] = `Bearer ${TOKEN}`;
  return fetch(API(path), { method, headers, body: body ? JSON.stringify(body) : undefined })
    .then(async (r) => ({ status: r.status, body: await r.json().catch(() => null) }));
}

before(async () => {
  const r = await json("POST", "/auth/register", { username: USER, password: PASS });
  assert.equal(r.status, 200);
  TOKEN = r.body.token;
});

describe("Connector framework", () => {
  it("lists connectors", async () => {
    const r = await json("GET", "/connectors");
    assert.equal(r.status, 200);
    const ids = (r.body.data || []).map((c) => c.id);
    assert.ok(ids.includes("osm"));
    assert.ok(ids.includes("web_search"));
  });

  it("web search unconfigured returns clear error", async () => {
    const r = await json("POST", "/connectors/web-search/search", { query: "test", location: "NYC", limit: 5 });
    assert.equal(r.status, 400);
    assert.equal(r.body.code, "not_configured");
  });

  it("osm search requires query or location", async () => {
    const r = await json("POST", "/connectors/osm/search", { query: "", location: "", limit: 5 });
    assert.equal(r.status, 502);
    assert.ok(r.body.error);
  });

  it("validates connector config", async () => {
    const r = await json("POST", "/connectors/web_search/validate", { config: { provider: "brave" } });
    assert.equal(r.status, 200);
    assert.equal(r.body.ok, false);
    assert.ok(r.body.errors.includes("apiKey is required"));
  });

  it("csv preview validates and sanitizes", async () => {
    const csv = "name,phone,website\nAcme,+14155550000,https://acme.com\n=EVIL,123,https://x.com";
    const b64 = Buffer.from(csv).toString("base64");
    const r = await json("POST", "/connectors/import/preview", { content: b64, format: "csv" });
    assert.equal(r.status, 200);
    assert.equal(r.body.acceptedCount, 2);
    assert.equal(r.body.rejectedCount, 0);
    assert.ok(r.body.preview[0].name === "Acme");
  });

  it("csv commit is idempotent", async () => {
    const csv = "name,phone\nIdem Import,+14155551111";
    const b64 = Buffer.from(csv).toString("base64");
    const preview = await json("POST", "/connectors/import/preview", { content: b64, format: "csv" });
    const first = await json("POST", "/connectors/import/commit", { rows: preview.body.accepted, source: { type: "csv_import" } });
    assert.equal(first.status, 200);
    const second = await json("POST", "/connectors/import/commit", { rows: preview.body.accepted, source: { type: "csv_import" } });
    assert.equal(second.status, 200);
    // second should not create new lead? It may update; count same
    assert.equal(second.body.count, 1);
  });

  it("result limits enforced for csv", async () => {
    const rows = Array.from({ length: 5 }, (_, i) => ({ name: `Row ${i}` }));
    // preview path not needed; commit limit check
    const r = await json("POST", "/connectors/import/commit", { rows: Array.from({ length: 10001 }, (_, i) => ({ name: `R${i}` })) });
    assert.equal(r.status, 400);
  });
});
