import { describe, it, before } from "node:test";
import assert from "node:assert/strict";

const BASE = "http://localhost:5000";
const API = (path) => `${BASE}/api${path}`;

let TOKEN = "";
const USER = `ch-${Date.now()}`;
const PASS = "chpass123";

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

describe("Companies House connector (unit, mocked)", () => {
  it("returns unconfigured when no API key", async () => {
    const { default: chConnector } = await import("../server/connectors/companiesHouse.js");
    const originalEnv = process.env.COMPANIES_HOUSE_API_KEY;
    delete process.env.COMPANIES_HOUSE_API_KEY;
    try {
      const status = await chConnector.getStatus({});
      assert.equal(status.status, "unconfigured");
      assert.equal(status.error, "missing_api_key");
    } finally {
      if (originalEnv !== undefined) process.env.COMPANIES_HOUSE_API_KEY = originalEnv;
    }
  });

  it("validateConfig requires apiKey", async () => {
    const { default: chConnector } = await import("../server/connectors/companiesHouse.js");
    const result = chConnector.validateConfig({});
    assert.equal(result.ok, false);
    assert.ok(result.errors.some((e) => e.includes("apiKey")));
  });

  it("search throws not_configured without API key", async () => {
    const { default: chConnector } = await import("../server/connectors/companiesHouse.js");
    const originalEnv = process.env.COMPANIES_HOUSE_API_KEY;
    delete process.env.COMPANIES_HOUSE_API_KEY;
    try {
      await chConnector.search({ query: "test" });
      assert.fail("should have thrown");
    } catch (e) {
      assert.equal(e.code, "not_configured");
    } finally {
      if (originalEnv !== undefined) process.env.COMPANIES_HOUSE_API_KEY = originalEnv;
    }
  });

  it("search throws invalid_query without query", async () => {
    const { default: chConnector } = await import("../server/connectors/companiesHouse.js");
    process.env.COMPANIES_HOUSE_API_KEY = "test-key";
    try {
      await chConnector.search({ query: "" });
      assert.fail("should have thrown");
    } catch (e) {
      assert.equal(e.code, "invalid_query");
    } finally {
      delete process.env.COMPANIES_HOUSE_API_KEY;
    }
  });

  it("normalizes a mocked search response", async () => {
    const { default: chConnector } = await import("../server/connectors/companiesHouse.js");
    process.env.COMPANIES_HOUSE_API_KEY = "test-key";
    const originalFetch = global.fetch;
    global.fetch = async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        total_results: 1,
        items: [
          {
            company_number: "12345678",
            title: "Test Company Ltd",
            company_type: "ltd",
            company_status: "active",
            address_snippet: "1 Test St, London",
            date_of_creation: "2020-01-01",
          },
        ],
      }),
    });
    try {
      const result = await chConnector.search({ query: "test" });
      assert.equal(result.provider, "companies_house");
      assert.equal(result.results.length, 1);
      assert.equal(result.results[0].name, "Test Company Ltd");
      assert.equal(result.results[0].country, "GB");
      assert.equal(result.results[0].phone, "");
      assert.equal(result.results[0].email, "");
      assert.equal(result.results[0].website_url, "");
    } finally {
      global.fetch = originalFetch;
      delete process.env.COMPANIES_HOUSE_API_KEY;
    }
  });

  it("handles empty search results", async () => {
    const { default: chConnector } = await import("../server/connectors/companiesHouse.js");
    process.env.COMPANIES_HOUSE_API_KEY = "test-key";
    const originalFetch = global.fetch;
    global.fetch = async () => ({
      ok: true,
      status: 200,
      json: async () => ({ total_results: 0, items: [] }),
    });
    try {
      const result = await chConnector.search({ query: "nonexistent" });
      assert.equal(result.results.length, 0);
    } finally {
      global.fetch = originalFetch;
      delete process.env.COMPANIES_HOUSE_API_KEY;
    }
  });

  it("handles rate limiting (429)", async () => {
    const { default: chConnector } = await import("../server/connectors/companiesHouse.js");
    process.env.COMPANIES_HOUSE_API_KEY = "test-key";
    const originalFetch = global.fetch;
    global.fetch = async () => ({ ok: false, status: 429 });
    try {
      await chConnector.search({ query: "test" });
      assert.fail("should have thrown");
    } catch (e) {
      assert.equal(e.code, "rate_limited");
    } finally {
      global.fetch = originalFetch;
      delete process.env.COMPANIES_HOUSE_API_KEY;
    }
  });

  it("handles auth failure (401)", async () => {
    const { default: chConnector } = await import("../server/connectors/companiesHouse.js");
    process.env.COMPANIES_HOUSE_API_KEY = "bad-key";
    const originalFetch = global.fetch;
    global.fetch = async () => ({ ok: false, status: 401 });
    try {
      await chConnector.search({ query: "test" });
      assert.fail("should have thrown");
    } catch (e) {
      assert.equal(e.code, "auth_failed");
    } finally {
      global.fetch = originalFetch;
      delete process.env.COMPANIES_HOUSE_API_KEY;
    }
  });
});

describe("Companies House connector (API endpoints)", () => {
  it("search returns not_configured without API key", async () => {
    const r = await json("POST", "/connectors/companies-house/search", { query: "test" });
    assert.equal(r.status, 400);
    assert.equal(r.body.code, "not_configured");
  });

  it("verify returns not_configured without API key", async () => {
    const r = await json("POST", "/connectors/companies-house/verify", { companyNumber: "12345678" });
    assert.equal(r.status, 400);
    assert.equal(r.body.code, "not_configured");
  });

  it("search rejects missing query", async () => {
    const r = await json("POST", "/connectors/companies-house/search", { query: "" });
    // Without API key, returns not_configured (400) before checking query
    assert.equal(r.status, 400);
  });

  it("verify rejects missing company number", async () => {
    const r = await json("POST", "/connectors/companies-house/verify", { companyNumber: "" });
    assert.equal(r.status, 400);
  });

  it("connector listed in /api/connectors", async () => {
    const r = await json("GET", "/connectors");
    const ch = (r.body.data || []).find((c) => c.id === "companies_house");
    assert.ok(ch);
    assert.equal(ch.name, "UK Companies House (company verification)");
  });
});

describe("Companies House connector (deduplication)", () => {
  it("repeated ingestion does not create duplicate leads", async () => {
    const first = await json("POST", "/leads/ingest", { source: { type: "companies_house", recordId: "ch-dedup-1" }, lead: { name: "CH Dedup Test", phone: "+441234567890" } });
    assert.equal(first.status, 200);
    const second = await json("POST", "/leads/ingest", { source: { type: "companies_house", recordId: "ch-dedup-2" }, lead: { name: "CH Dedup Test", phone: "+441234567890" } });
    assert.equal(second.status, 200);
    assert.equal(second.body.leadId, first.body.leadId);
  });
});