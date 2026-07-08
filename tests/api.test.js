import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

const BASE = "http://localhost:5000";
const API = (path) => `${BASE}/api${path}`;

function json(method, path, body) {
  return fetch(API(path), {
    method,
    headers: { "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  }).then(async (r) => ({ status: r.status, body: await r.json().catch(() => null) }));
}

describe("Scraper API safeguards", () => {
  it("rejects scrape without location", async () => {
    const { status, body } = await json("POST", "/scrape", { categories: ["test"] });
    if (status === 429) return; // rate limited
    assert.equal(status, 400);
    assert.equal(body.error, "location and at least one category are required");
  });
  it("rejects scrape without categories", async () => {
    const { status, body } = await json("POST", "/scrape", { location: "Test" });
    if (status === 429) return;
    assert.equal(status, 400);
    assert.equal(body.error, "location and at least one category are required");
  });
  it("rejects scrape with empty categories", async () => {
    const { status, body } = await json("POST", "/scrape", { location: "Test", categories: [] });
    if (status === 429) return;
    assert.equal(status, 400);
    assert.equal(body.error, "location and at least one category are required");
  });
  it("cancel returns ok even when no job running", async () => {
    const { status, body } = await json("POST", "/scrape/cancel");
    assert.equal(status, 200);
    assert.equal(body.ok, true);
    assert.equal(body.cancelled, false);
  });
});

describe("Website checker safeguards", () => {
  it("accepts check-websites with ids array", async () => {
    const { status, body } = await json("POST", "/check-websites", { ids: [] });
    assert.equal(status, 200);
    assert.equal(body.ok, true);
  });
  it("accepts check-websites without ids (checks all unchecked)", async () => {
    const { status, body } = await json("POST", "/check-websites", {});
    assert.equal(status, 200);
    assert.equal(body.ok, true);
  });
});

describe("Business CRUD", () => {
  const testId = `crud-test-${Date.now()}`;

  after(async () => {
    await json("DELETE", "/businesses", { ids: [testId] });
  });

  it("creates a business", async () => {
    const { status, body } = await json("POST", "/businesses", [{
      id: testId, name: "CRUD Test", category: "Testing",
      address: "123 Test", city: "TestCity",
      phone: "+919000000001", rating: "4.0", reviews: "10",
      website_url: "", website_status: "no_website",
    }]);
    assert.equal(status, 200);
    assert.equal(body.ok, true);
    assert.equal(body.inserted, 1);
  });

  it("reads the created business", async () => {
    const { status, body } = await json("GET", `/businesses`);
    assert.equal(status, 200);
    const found = (body.data || body).find((b) => b.id === testId);
    assert.ok(found, "created business should be in list");
    assert.equal(found.name, "CRUD Test");
  });

  it("searches for the business", async () => {
    const { status, body } = await json("GET", `/businesses?search=CRUD%20Test`);
    assert.equal(status, 200);
    const items = body.data || body;
    assert.ok(items.some((b) => b.id === testId));
  });

  it("updates pipeline status", async () => {
    const { status } = await json("PATCH", `/businesses/${testId}`, { pipeline_status: "interested" });
    assert.equal(status, 200);
  });

  it("rejects invalid pipeline status", async () => {
    const { status, body } = await json("PATCH", `/businesses/${testId}`, { pipeline_status: "invalid_status" });
    assert.equal(status, 400);
    assert.ok(body.error.includes("Invalid pipeline_status"));
  });

  it("updates notes", async () => {
    const { status } = await json("PATCH", `/businesses/${testId}`, { notes: "Test note" });
    assert.equal(status, 200);
  });

  it("deletes the business", async () => {
    const { status, body } = await json("DELETE", "/businesses", { ids: [testId] });
    assert.equal(status, 200);
    assert.equal(body.ok, true);
  });

  it("confirms deletion", async () => {
    const { status, body } = await json("GET", `/businesses`);
    assert.equal(status, 200);
    const items = body.data || body;
    assert.ok(!items.some((b) => b.id === testId));
  });
});

describe("Duplicate detection", () => {
  const baseId = `dup-test-${Date.now()}`;
  const sharedPhone = "+919000000002";

  after(async () => {
    await json("DELETE", "/businesses", { ids: [baseId, `${baseId}-second`] });
  });

  it("inserts first business", async () => {
    const { body } = await json("POST", "/businesses", [{
      id: baseId, name: "Dup Original", category: "Test",
      address: "First", city: "City", phone: sharedPhone,
      rating: "4.0", reviews: "5", website_url: "",
    }]);
    assert.equal(body.inserted, 1);
    assert.equal(body.updated, 0);
  });

  it("updates (not inserts) same phone", async () => {
    const { body } = await json("POST", "/businesses", [{
      id: `${baseId}-second`, name: "Dup Original", category: "Test",
      address: "Second", city: "City", phone: sharedPhone,
      rating: "4.5", reviews: "10", website_url: "",
    }]);
    assert.equal(body.inserted, 0);
    assert.equal(body.updated, 1);
  });

  it("preserves only one row for that phone", async () => {
    const { status, body } = await json("GET", `/businesses?search=${encodeURIComponent(sharedPhone)}`);
    assert.equal(status, 200);
    const items = body.data || body;
    const matching = items.filter((b) => b.phone === sharedPhone);
    assert.equal(matching.length, 1, "should have exactly one row for this phone");
  });
});

describe("WhatsApp send safeguards", () => {
  it("rejects send when not connected", async () => {
    const { status, body } = await json("POST", "/wa/send", {
      businesses: [{ id: "x", name: "Test", phone: "+919000000003" }],
      message: "Hello {name}",
    });
    if (status === 429) return; // rate limited
    assert.equal(status, 400);
    assert.ok(body.error.includes("WhatsApp not connected"));
  });

  it("rejects send: empty businesses list (hits connection check first)", async () => {
    const { status, body } = await json("POST", "/wa/send", {
      businesses: [], message: "Hello",
    });
    if (status === 429) return; // rate limited
    // Connection check runs before empty-businesses check when disconnected
    assert.equal(status, 400);
    assert.ok(body.error);
  });

  it("pause toggles paused state", async () => {
    const r1 = await json("POST", "/wa/pause");
    assert.equal(r1.body.paused, true);
    const r2 = await json("POST", "/wa/pause");
    assert.equal(r2.body.paused, false);
  });

  it("stop clears running state", async () => {
    const { status, body } = await json("POST", "/wa/stop");
    assert.equal(status, 200);
    assert.equal(body.ok, true);
  });

  it("returns status without crashing", async () => {
    const { status, body } = await json("GET", "/wa/status");
    assert.equal(status, 200);
    assert.ok("status" in body);
    assert.ok("sendState" in body);
  });
});

describe("Config endpoints", () => {
  it("reads config", async () => {
    const { status } = await json("GET", "/config");
    assert.equal(status, 200);
  });
  it("writes config", async () => {
    const { status, body } = await json("POST", "/config", { test_key: "test_value" });
    assert.equal(status, 200);
    assert.equal(body.ok, true);
  });
});

describe("Stats & history endpoints", () => {
  it("returns stats", async () => {
    const { status, body } = await json("GET", "/stats");
    assert.equal(status, 200);
    assert.ok("total" in body);
    assert.ok("noWebsite" in body);
    assert.ok("broken" in body);
    assert.ok("byPipeline" in body);
    assert.ok("byCity" in body);
  });
  it("returns pipeline history", async () => {
    const { status } = await json("GET", "/pipeline-history");
    assert.equal(status, 200);
  });
  it("returns send log", async () => {
    const { status } = await json("GET", "/send-log");
    assert.equal(status, 200);
  });
});
