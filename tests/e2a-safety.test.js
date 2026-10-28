import { describe, it } from "node:test";
import assert from "node:assert/strict";

const BASE = "http://localhost:5000";
const API = (path) => `${BASE}/api${path}`;

let TOKEN = "";
const USER = `e2a-${Date.now()}`;
const PASS = "e2apass123";

async function json(method, path, body) {
  const headers = { "Content-Type": "application/json" };
  if (TOKEN) headers["Authorization"] = `Bearer ${TOKEN}`;
  const r = await fetch(API(path), { method, headers, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, body: await r.json().catch(() => null) };
}

import { before } from "node:test";
before(async () => {
  const r = await json("POST", "/auth/register", { username: USER, password: PASS });
  TOKEN = r.body.token;
});

describe("E2a OSM compliance safety (production)", () => {
  it("OSM search endpoint returns 503 compliance_restricted in production", async () => {
    const r = await json("POST", "/connectors/osm/search", { query: "bakery", location: "Berlin", limit: 5 });
    assert.equal(r.status, 503);
    assert.equal(r.body.code, "compliance_restricted");
    assert.ok(r.body.error.includes("disabled") || r.body.error.includes("forbids"));
  });

  it("OSM connector status reports unavailable in production", async () => {
    const r = await json("POST", "/connectors/osm/status", { config: {} });
    assert.equal(r.status, 200);
    assert.equal(r.body.status, "unavailable");
    assert.equal(r.body.error, "compliance_restricted");
    assert.ok(r.body.message.includes("disabled") || r.body.message.includes("forbids"));
  });

  it("OSM connector listed as unavailable in production", async () => {
    const r = await json("GET", "/connectors");
    const osm = (r.body.data || []).find((c) => c.id === "osm");
    assert.ok(osm);
    assert.equal(osm.configured, false);
    assert.equal(osm.status, "unavailable");
  });

  it("OSM search does not create leads in production", async () => {
    const before = await json("GET", "/businesses?page=1&pageSize=1");
    const totalBefore = before.body.total;
    await json("POST", "/connectors/osm/search", { query: "bakery", location: "Berlin", limit: 5 });
    const after = await json("GET", "/businesses?page=1&pageSize=1");
    assert.equal(after.body.total, totalBefore);
  });
});

describe("E2a fail-closed configuration (unit)", () => {
  it("OSM isConfigured returns false when OSM_PUBLIC_DISCOVERY_ENABLED is unset", async () => {
    const origEnabled = process.env.OSM_PUBLIC_DISCOVERY_ENABLED;
    const origNodeEnv = process.env.NODE_ENV;
    delete process.env.OSM_PUBLIC_DISCOVERY_ENABLED;
    process.env.NODE_ENV = "development";
    try {
      const mod = await import("../server/connectors/osm.js?unset=" + Date.now());
      const connector = mod.default;
      assert.equal(connector.isConfigured(), false);
    } finally {
      if (origEnabled !== undefined) process.env.OSM_PUBLIC_DISCOVERY_ENABLED = origEnabled;
      else delete process.env.OSM_PUBLIC_DISCOVERY_ENABLED;
      if (origNodeEnv !== undefined) process.env.NODE_ENV = origNodeEnv;
      else delete process.env.NODE_ENV;
    }
  });

  it("OSM isConfigured returns false when NODE_ENV is missing (fail-closed)", async () => {
    const origEnabled = process.env.OSM_PUBLIC_DISCOVERY_ENABLED;
    const origNodeEnv = process.env.NODE_ENV;
    process.env.OSM_PUBLIC_DISCOVERY_ENABLED = "true";
    delete process.env.NODE_ENV;
    try {
      const mod = await import("../server/connectors/osm.js?missing=" + Date.now());
      const connector = mod.default;
      // Missing NODE_ENV must fail closed - discovery disabled.
      assert.equal(connector.isConfigured(), false);
    } finally {
      if (origEnabled !== undefined) process.env.OSM_PUBLIC_DISCOVERY_ENABLED = origEnabled;
      else delete process.env.OSM_PUBLIC_DISCOVERY_ENABLED;
      if (origNodeEnv !== undefined) process.env.NODE_ENV = origNodeEnv;
      else delete process.env.NODE_ENV;
    }
  });

  it("OSM isConfigured returns false in production even with flag enabled", async () => {
    const origEnabled = process.env.OSM_PUBLIC_DISCOVERY_ENABLED;
    const origNodeEnv = process.env.NODE_ENV;
    process.env.OSM_PUBLIC_DISCOVERY_ENABLED = "true";
    process.env.NODE_ENV = "production";
    try {
      const mod = await import("../server/connectors/osm.js?prod=" + Date.now());
      const connector = mod.default;
      assert.equal(connector.isConfigured(), false);
    } finally {
      if (origEnabled !== undefined) process.env.OSM_PUBLIC_DISCOVERY_ENABLED = origEnabled;
      else delete process.env.OSM_PUBLIC_DISCOVERY_ENABLED;
      if (origNodeEnv !== undefined) process.env.NODE_ENV = origNodeEnv;
      else delete process.env.NODE_ENV;
    }
  });

  it("OSM isConfigured returns true only with explicit flag in non-production", async () => {
    const origEnabled = process.env.OSM_PUBLIC_DISCOVERY_ENABLED;
    const origNodeEnv = process.env.NODE_ENV;
    process.env.OSM_PUBLIC_DISCOVERY_ENABLED = "true";
    process.env.NODE_ENV = "development";
    try {
      const mod = await import("../server/connectors/osm.js?dev=" + Date.now());
      const connector = mod.default;
      assert.equal(connector.isConfigured(), true);
    } finally {
      if (origEnabled !== undefined) process.env.OSM_PUBLIC_DISCOVERY_ENABLED = origEnabled;
      else delete process.env.OSM_PUBLIC_DISCOVERY_ENABLED;
      if (origNodeEnv !== undefined) process.env.NODE_ENV = origNodeEnv;
      else delete process.env.NODE_ENV;
    }
  });

  it("OSM search throws compliance_restricted when disabled", async () => {
    const origEnabled = process.env.OSM_PUBLIC_DISCOVERY_ENABLED;
    const origNodeEnv = process.env.NODE_ENV;
    delete process.env.OSM_PUBLIC_DISCOVERY_ENABLED;
    process.env.NODE_ENV = "development";
    try {
      const mod = await import("../server/connectors/osm.js?disabled=" + Date.now());
      const connector = mod.default;
      try {
        await connector.search({ query: "test", location: "Berlin", limit: 5 });
        assert.fail("should have thrown");
      } catch (e) {
        assert.equal(e.code, "compliance_restricted");
      }
    } finally {
      if (origEnabled !== undefined) process.env.OSM_PUBLIC_DISCOVERY_ENABLED = origEnabled;
      else delete process.env.OSM_PUBLIC_DISCOVERY_ENABLED;
      if (origNodeEnv !== undefined) process.env.NODE_ENV = origNodeEnv;
      else delete process.env.NODE_ENV;
    }
  });
});

describe("E2a web-search still works", () => {
  it("web search returns not_configured without credentials", async () => {
    const r = await json("POST", "/connectors/web-search/search", { query: "test", location: "Berlin" });
    assert.equal(r.status, 400);
    assert.equal(r.body.code, "not_configured");
  });
});