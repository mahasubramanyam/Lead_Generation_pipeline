import { describe, it } from "node:test";
import assert from "node:assert/strict";

const BASE = "http://localhost:5000";
const API = (path) => `${BASE}/api${path}`;

let TOKEN = "";
const USER = `status-${Date.now()}`;
const PASS = "statuspass123";

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

describe("Connector status endpoints", () => {
  it("lists connectors with status field", async () => {
    const r = await json("GET", "/connectors");
    assert.equal(r.status, 200);
    const connectors = r.body.data || [];
    assert.ok(connectors.length >= 2);
    for (const c of connectors) {
      assert.ok(c.id);
      assert.ok(c.name);
      assert.ok(c.status);
      assert.ok(["unconfigured", "configured", "connected", "running", "failed", "unavailable", "legacy"].includes(c.status));
    }
  });

  it("osm connector status is not unconfigured", async () => {
    const r = await json("GET", "/connectors");
    const osm = (r.body.data || []).find((c) => c.id === "osm");
    assert.ok(osm);
    assert.notEqual(osm.status, "unconfigured");
    assert.ok(["configured", "connected", "failed", "unavailable"].includes(osm.status));
  });

  it("web_search connector status reflects missing config", async () => {
    const r = await json("GET", "/connectors");
    const ws = (r.body.data || []).find((c) => c.id === "web_search");
    assert.ok(ws);
    assert.equal(ws.status, "unconfigured");
  });

  it("google_maps_legacy is marked legacy", async () => {
    const r = await json("GET", "/connectors");
    const g = (r.body.data || []).find((c) => c.id === "google_maps_legacy");
    assert.ok(g);
    assert.equal(g.status, "legacy");
    assert.equal(g.legacy, true);
  });

  it("whatsapp_web_legacy is marked legacy", async () => {
    const r = await json("GET", "/connectors");
    const w = (r.body.data || []).find((c) => c.id === "whatsapp_web_legacy");
    assert.ok(w);
    assert.equal(w.status, "legacy");
    assert.equal(w.legacy, true);
  });

  it("osm status endpoint returns real check result", async () => {
    const r = await json("POST", "/connectors/osm/status", { config: {} });
    assert.ok(r.status === 200 || r.status === 502);
    if (r.status === 200) {
      assert.ok(["connected", "failed", "unavailable"].includes(r.body.status));
      assert.ok(r.body.message);
    }
  });

  it("web_search status endpoint requires provider config", async () => {
    const r = await json("POST", "/connectors/web_search/status", { config: {} });
    assert.equal(r.status, 200);
    assert.equal(r.body.status, "unconfigured");
    assert.ok(r.body.errors?.length > 0);
  });

  it("web_search status with invalid provider fails appropriately", async () => {
    const r = await json("POST", "/connectors/web_search/status", { config: { provider: "unknown", apiKey: "x" } });
    assert.equal(r.status, 200);
    assert.ok(["unavailable", "failed", "unconfigured"].includes(r.body.status));
  });
});