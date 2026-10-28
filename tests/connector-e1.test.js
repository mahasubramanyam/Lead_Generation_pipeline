import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";

const BASE = "http://localhost:5000";
const API = (path) => `${BASE}/api${path}`;

let TOKEN = "";
const USER = `e1-${Date.now()}`;
const PASS = "e1pass123";

async function json(method, path, body) {
  const headers = { "Content-Type": "application/json" };
  if (TOKEN) headers["Authorization"] = `Bearer ${TOKEN}`;
  const r = await fetch(API(path), { method, headers, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, body: await r.json().catch(() => null) };
}

before(async () => {
  const r = await json("POST", "/auth/register", { username: USER, password: PASS });
  TOKEN = r.body.token;
});

describe("E1 connector unit tests (mocked fetch)", () => {
  it("OSM normalizes a mocked response", async () => {
    const { default: osmConnector } = await import("../server/connectors/osm.js");
    const originalFetch = global.fetch;
    global.fetch = async () => ({
      ok: true,
      status: 200,
      json: async () => ([
        { place_id: 1, display_name: "Acme Bakery, Berlin", type: "bakery", address: { city: "Berlin", country_code: "de" }, extratags: { phone: "+49 30 123", website: "https://acme.de" } },
      ]),
    });
    try {
      const result = await osmConnector.search({ query: "bakery", location: "Berlin", country: "de", limit: 5 });
      assert.equal(result.provider, "openstreetmap");
      assert.equal(result.results.length, 1);
      assert.equal(result.results[0].name, "Acme Bakery");
      assert.equal(result.results[0].city, "Berlin");
      assert.equal(result.results[0].country, "DE");
      assert.equal(result.countryFilter, "de");
    } finally {
      global.fetch = originalFetch;
    }
  });

  it("OSM handles empty results", async () => {
    const { default: osmConnector } = await import("../server/connectors/osm.js");
    const originalFetch = global.fetch;
    global.fetch = async () => ({ ok: true, status: 200, json: async () => ([]) });
    try {
      const result = await osmConnector.search({ query: "nonexistent", location: "Nowhere", limit: 5 });
      assert.equal(result.results.length, 0);
    } finally {
      global.fetch = originalFetch;
    }
  });

  it("OSM handles rate limiting (429)", async () => {
    const { default: osmConnector } = await import("../server/connectors/osm.js");
    const originalFetch = global.fetch;
    global.fetch = async () => ({ ok: false, status: 429 });
    try {
      await osmConnector.search({ query: "test", location: "Berlin", limit: 5 });
      assert.fail("should have thrown");
    } catch (e) {
      assert.equal(e.code, "rate_limited");
    } finally {
      global.fetch = originalFetch;
    }
  });

  it("OSM rejects invalid country code", async () => {
    const { default: osmConnector } = await import("../server/connectors/osm.js");
    try {
      await osmConnector.search({ query: "test", location: "Berlin", country: "zzz", limit: 5 });
      assert.fail("should have thrown");
    } catch (e) {
      assert.equal(e.code, "invalid_country");
    }
  });

  it("web search returns not_configured without credentials", async () => {
    const { default: webSearchConnector } = await import("../server/connectors/webSearch.js");
    try {
      await webSearchConnector.search({ query: "test", location: "Berlin", config: {} });
      assert.fail("should have thrown");
    } catch (e) {
      assert.equal(e.code, "not_configured");
    }
  });

  it("web search validates country code", async () => {
    const { default: webSearchConnector } = await import("../server/connectors/webSearch.js");
    const validation = webSearchConnector.validateConfig({ provider: "brave", apiKey: "key", country: "zzz" });
    assert.equal(validation.ok, false);
    assert.ok(validation.errors.some((e) => e.includes("country")));
  });
});

describe("E1 endpoint validation", () => {
  it("OSM search rejects invalid limit", async () => {
    const r = await json("POST", "/connectors/osm/search", { query: "test", location: "Berlin", limit: 100 });
    assert.equal(r.status, 400);
    assert.ok(r.body.error.includes("limit"));
  });

  it("OSM search rejects invalid country", async () => {
    const r = await json("POST", "/connectors/osm/search", { query: "test", location: "Berlin", country: "zzz" });
    assert.equal(r.status, 400);
    assert.ok(r.body.error.includes("country"));
  });

  it("web search search rejects invalid limit", async () => {
    const r = await json("POST", "/connectors/web-search/search", { query: "test", location: "Berlin", limit: 100, config: { provider: "brave", apiKey: "key" } });
    assert.equal(r.status, 400);
    assert.ok(r.body.error.includes("limit"));
  });

  it("web search search rejects invalid country", async () => {
    const r = await json("POST", "/connectors/web-search/search", { query: "test", location: "Berlin", country: "zzz", config: { provider: "brave", apiKey: "key" } });
    assert.equal(r.status, 400);
    assert.ok(r.body.error.includes("country"));
  });

  it("web search search returns not_configured without credentials", async () => {
    const r = await json("POST", "/connectors/web-search/search", { query: "test", location: "Berlin" });
    assert.equal(r.status, 400);
    assert.equal(r.body.code, "not_configured");
  });
});

describe("E1 deduplication", () => {
  it("repeated ingestion does not create duplicate leads", async () => {
    const first = await json("POST", "/leads/ingest", { source: { type: "e1-test", recordId: "e1-dedup-1" }, lead: { name: "Dedup E1", phone: "+14155559999" } });
    assert.equal(first.status, 200);
    const second = await json("POST", "/leads/ingest", { source: { type: "e1-test", recordId: "e1-dedup-2" }, lead: { name: "Dedup E1", phone: "+14155559999" } });
    assert.equal(second.status, 200);
    assert.equal(second.body.leadId, first.body.leadId);
  });
});