import { describe, it } from "node:test";
import assert from "node:assert/strict";

const BASE = "http://localhost:5000";
const API = (path) => `${BASE}/api${path}`;

let TOKEN = "";
const USER = `prod-${Date.now()}`;
const PASS = "prodpass123";

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

describe("Production honest behavior", () => {
  it("scrape rejects invalid input without fabricating results", async () => {
    const r = await json("POST", "/scrape", { location: "", categories: ["x"] });
    assert.equal(r.status, 400);
    assert.ok(!r.body?.demoMode);
  });

  it("check-websites does not report demo mode", async () => {
    const r = await json("POST", "/check-websites", { ids: [] });
    assert.equal(r.status, 200);
    assert.ok(!r.body?.demoMode);
  });

  it("whatsapp status is not falsely connected", async () => {
    const r = await json("GET", "/wa/status");
    assert.equal(r.status, 200);
    assert.notEqual(r.body.status, "connected");
    assert.ok(!r.body?.demoMode);
  });

  it("unknown scrape job returns 404 instead of fake completion", async () => {
    const r = await json("GET", `/scrape/status/does-not-exist-${Date.now()}`);
    assert.equal(r.status, 404);
  });
});
