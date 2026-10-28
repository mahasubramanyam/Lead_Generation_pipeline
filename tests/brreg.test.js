import { describe, it, before } from "node:test";
import assert from "node:assert/strict";

const BASE = "http://localhost:5000";
const API = (path) => `${BASE}/api${path}`;

let TOKEN = "";
const USER = `brreg-${Date.now()}`;
const PASS = "brregpass123";

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

describe("Brreg connector (unit, mocked)", () => {
  it("isConfigured returns true (no auth required)", async () => {
    const { default: brregConnector } = await import("../server/connectors/brreg.js");
    assert.equal(brregConnector.isConfigured(), true);
  });

  it("validateConfig accepts empty config", async () => {
    const { default: brregConnector } = await import("../server/connectors/brreg.js");
    const result = brregConnector.validateConfig({});
    assert.equal(result.ok, true);
  });

  it("validateConfig rejects invalid baseUrl", async () => {
    const { default: brregConnector } = await import("../server/connectors/brreg.js");
    const result = brregConnector.validateConfig({ baseUrl: "not-a-url" });
    assert.equal(result.ok, false);
  });

  it("search throws invalid_query without query", async () => {
    const { default: brregConnector } = await import("../server/connectors/brreg.js");
    try {
      await brregConnector.search({ query: "" });
      assert.fail("should have thrown");
    } catch (e) {
      assert.equal(e.code, "invalid_query");
    }
  });

  it("search throws invalid_pagination for excessive page", async () => {
    const { default: brregConnector } = await import("../server/connectors/brreg.js");
    try {
      await brregConnector.search({ query: "test", page: 100, limit: 100 });
      assert.fail("should have thrown");
    } catch (e) {
      assert.equal(e.code, "invalid_pagination");
    }
  });

  it("normalizes a mocked search response", async () => {
    const { default: brregConnector } = await import("../server/connectors/brreg.js");
    const originalFetch = global.fetch;
    global.fetch = async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        _embedded: {
          enheter: [
            {
              organisasjonsnummer: "987654321",
              navn: "Test Bedrift AS",
              organisasjonsform: { kode: "AS", beskrivelse: "Aksjeselskap" },
              forretningsadresse: {
                adresse: ["Testveien 1"],
                postnummer: "0123",
                poststed: "OSLO",
                kommune: "OSLO",
                landkode: "NO",
              },
              naeringskode1: { kode: "47.110", beskrivelse: "Detaljhandel" },
              antallAnsatte: 5,
              hjemmeside: "https://testbedrift.no",
              epostadresse: "post@testbedrift.no",
              telefon: "12345678",
              stiftelsesdato: "2020-01-01",
              registreringsdatoEnhetsregisteret: "2020-01-15",
              konkurs: false,
              underAvvikling: false,
              underTvangsavviklingEllerTvangsopplosning: false,
              erSlettet: false,
            },
          ],
        },
        page: { totalElements: 1, totalPages: 1, number: 0, size: 20 },
      }),
    });
    try {
      const result = await brregConnector.search({ query: "test" });
      assert.equal(result.provider, "brreg");
      assert.equal(result.results.length, 1);
      assert.equal(result.results[0].name, "Test Bedrift AS");
      assert.equal(result.results[0].country, "NO");
      assert.equal(result.results[0].phone, "12345678");
      assert.equal(result.results[0].email, "post@testbedrift.no");
      assert.equal(result.results[0].website_url, "https://testbedrift.no");
      assert.equal(result.results[0].category, "Detaljhandel");
      assert.equal(result.attribution.includes("NLOD 2.0"), true);
    } finally {
      global.fetch = originalFetch;
    }
  });

  it("excludes deleted entities (erSlettet=true)", async () => {
    const { default: brregConnector } = await import("../server/connectors/brreg.js");
    const originalFetch = global.fetch;
    global.fetch = async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        _embedded: {
          enheter: [
            { organisasjonsnummer: "111111111", navn: "Active Corp", erSlettet: false },
            { organisasjonsnummer: "222222222", navn: "Deleted Corp", erSlettet: true },
          ],
        },
        page: { totalElements: 2, totalPages: 1, number: 0, size: 20 },
      }),
    });
    try {
      const result = await brregConnector.search({ query: "test" });
      assert.equal(result.results.length, 1);
      assert.equal(result.results[0].name, "Active Corp");
    } finally {
      global.fetch = originalFetch;
    }
  });

  it("handles empty results", async () => {
    const { default: brregConnector } = await import("../server/connectors/brreg.js");
    const originalFetch = global.fetch;
    global.fetch = async () => ({
      ok: true,
      status: 200,
      json: async () => ({ _embedded: { enheter: [] }, page: { totalElements: 0, totalPages: 0 } }),
    });
    try {
      const result = await brregConnector.search({ query: "nonexistent" });
      assert.equal(result.results.length, 0);
    } finally {
      global.fetch = originalFetch;
    }
  });

  it("handles rate limiting (429)", async () => {
    const { default: brregConnector } = await import("../server/connectors/brreg.js");
    const originalFetch = global.fetch;
    global.fetch = async () => ({ ok: false, status: 429 });
    try {
      await brregConnector.search({ query: "test" });
      assert.fail("should have thrown");
    } catch (e) {
      assert.equal(e.code, "rate_limited");
    } finally {
      global.fetch = originalFetch;
    }
  });

  it("handles server error (500)", async () => {
    const { default: brregConnector } = await import("../server/connectors/brreg.js");
    const originalFetch = global.fetch;
    global.fetch = async () => ({ ok: false, status: 500 });
    try {
      await brregConnector.search({ query: "test" });
      assert.fail("should have thrown");
    } catch (e) {
      assert.equal(e.code, "provider_error");
    } finally {
      global.fetch = originalFetch;
    }
  });

  it("handles malformed response", async () => {
    const { default: brregConnector } = await import("../server/connectors/brreg.js");
    const originalFetch = global.fetch;
    global.fetch = async () => ({ ok: true, status: 200, json: async () => ({ not_enheter: true }) });
    try {
      const result = await brregConnector.search({ query: "test" });
      assert.equal(result.results.length, 0);
    } finally {
      global.fetch = originalFetch;
    }
  });

  it("getEntity throws removed for deleted entity (410)", async () => {
    const { default: brregConnector } = await import("../server/connectors/brreg.js");
    const originalFetch = global.fetch;
    global.fetch = async () => ({ ok: false, status: 410 });
    try {
      await brregConnector.getEntity("123456789");
      assert.fail("should have thrown");
    } catch (e) {
      assert.equal(e.code, "removed");
    } finally {
      global.fetch = originalFetch;
    }
  });

  it("getEntity throws not_found for 404", async () => {
    const { default: brregConnector } = await import("../server/connectors/brreg.js");
    const originalFetch = global.fetch;
    global.fetch = async () => ({ ok: false, status: 404 });
    try {
      await brregConnector.getEntity("999999999");
      assert.fail("should have thrown");
    } catch (e) {
      assert.equal(e.code, "not_found");
    } finally {
      global.fetch = originalFetch;
    }
  });

  it("getEntity returns company data from mocked response", async () => {
    const { default: brregConnector } = await import("../server/connectors/brreg.js");
    const originalFetch = global.fetch;
    global.fetch = async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        organisasjonsnummer: "987654321",
        navn: "Test Bedrift AS",
        organisasjonsform: { kode: "AS", beskrivelse: "Aksjeselskap" },
        forretningsadresse: { adresse: ["Testveien 1"], postnummer: "0123", poststed: "OSLO", kommune: "OSLO", landkode: "NO" },
        naeringskode1: { kode: "47.110", beskrivelse: "Detaljhandel" },
        antallAnsatte: 5,
        hjemmeside: "https://testbedrift.no",
        epostadresse: "post@testbedrift.no",
        telefon: "12345678",
        stiftelsesdato: "2020-01-01",
        registreringsdatoEnhetsregisteret: "2020-01-15",
        konkurs: false,
        underAvvikling: false,
        underTvangsavviklingEllerTvangsopplosning: false,
        erSlettet: false,
      }),
    });
    try {
      const result = await brregConnector.getEntity("987654321");
      assert.equal(result.provider, "brreg");
      assert.equal(result.entity.navn, "Test Bedrift AS");
      assert.equal(result.entity.organisasjonsnummer, "987654321");
      assert.equal(result.entity.telefon, "12345678");
      assert.equal(result.entity.epostadresse, "post@testbedrift.no");
      assert.equal(result.entity.hjemmeside, "https://testbedrift.no");
      assert.equal(result.attribution.includes("NLOD 2.0"), true);
    } finally {
      global.fetch = originalFetch;
    }
  });

  it("getEntity throws removed for deleted entity (erSlettet=true)", async () => {
    const { default: brregConnector } = await import("../server/connectors/brreg.js");
    const originalFetch = global.fetch;
    global.fetch = async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        organisasjonsnummer: "987654321",
        navn: "Deleted Corp",
        erSlettet: true,
      }),
    });
    try {
      await brregConnector.getEntity("987654321");
      assert.fail("should have thrown");
    } catch (e) {
      assert.equal(e.code, "removed");
    } finally {
      global.fetch = originalFetch;
    }
  });

  it("getEntity throws invalid_input without org number", async () => {
    const { default: brregConnector } = await import("../server/connectors/brreg.js");
    try {
      await brregConnector.getEntity("");
      assert.fail("should have thrown");
    } catch (e) {
      assert.equal(e.code, "invalid_input");
    }
  });
});

describe("Brreg connector (API endpoints)", () => {
  it("search rejects empty query", async () => {
    const r = await json("POST", "/connectors/brreg/search", { query: "" });
    assert.equal(r.status, 400);
    assert.ok(r.body.error);
  });

  it("search rejects invalid limit", async () => {
    const r = await json("POST", "/connectors/brreg/search", { query: "test", limit: 200 });
    assert.equal(r.status, 400);
    assert.ok(r.body.error.includes("limit"));
  });

  it("search rejects invalid page", async () => {
    const r = await json("POST", "/connectors/brreg/search", { query: "test", page: -1 });
    assert.equal(r.status, 400);
    assert.ok(r.body.error.includes("page"));
  });

  it("verify rejects missing org number", async () => {
    const r = await json("POST", "/connectors/brreg/verify", { orgNumber: "" });
    assert.equal(r.status, 400);
    assert.ok(r.body.error);
  });

  it("connector listed in /api/connectors", async () => {
    const r = await json("GET", "/connectors");
    const brreg = (r.body.data || []).find((c) => c.id === "brreg");
    assert.ok(brreg);
    assert.equal(brreg.name, "Norway Brønnøysund Register (Brreg)");
  });

  it("connector status is connected or failed (real check)", async () => {
    const r = await json("POST", "/connectors/brreg/status", { config: {} });
    assert.ok(r.status === 200 || r.status === 502);
    if (r.status === 200) {
      assert.ok(["connected", "failed", "unavailable"].includes(r.body.status));
    }
  });
});

describe("Brreg connector (deduplication)", () => {
  it("repeated ingestion does not create duplicate leads", async () => {
    const first = await json("POST", "/leads/ingest", { source: { type: "brreg", recordId: "brreg-dedup-1" }, lead: { name: "Brreg Dedup Test", phone: "+4712345678" } });
    assert.equal(first.status, 200);
    const second = await json("POST", "/leads/ingest", { source: { type: "brreg", recordId: "brreg-dedup-2" }, lead: { name: "Brreg Dedup Test", phone: "+4712345678" } });
    assert.equal(second.status, 200);
    assert.equal(second.body.leadId, first.body.leadId);
  });
});