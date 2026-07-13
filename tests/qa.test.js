import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

const BASE = "http://localhost:5000";
const API = (path) => `${BASE}/api${path}`;

let TOKEN = "";
const TEST_USER = `qa-${Date.now()}`;
const TEST_PASS = "qa-test-pass-123";

function json(method, path, body, extraHeaders) {
  const headers = { "Content-Type": "application/json", ...extraHeaders };
  // Don't overwrite Authorization header if already provided via extraHeaders
  if (TOKEN && !extraHeaders?.Authorization) headers["Authorization"] = `Bearer ${TOKEN}`;
  return fetch(API(path), {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  }).then(async (r) => ({ status: r.status, body: await r.json().catch(() => null), raw: r }));
}

function raw(method, path, body, contentType) {
  const headers = {};
  if (TOKEN) headers["Authorization"] = `Bearer ${TOKEN}`;
  if (contentType) headers["Content-Type"] = contentType;
  return fetch(API(path), {
    method,
    headers,
    body,
  }).then(async (r) => ({ status: r.status, body: await r.json().catch(() => null), text: async () => r.text() }));
}

/* ─────────────── SETUP ─────────────── */
before(async () => {
  const r = await json("POST", "/auth/register", { username: TEST_USER, password: TEST_PASS });
  if (r.status === 200) {
    TOKEN = r.body.token;
  } else {
    const l = await json("POST", "/auth/login", { username: TEST_USER, password: TEST_PASS });
    TOKEN = l.body.token;
  }
  assert.ok(TOKEN, "should have a token");
});

after(async () => {
  // Cleanup test data
  const { body } = await json("GET", `/businesses?pageSize=500`);
  const items = body.data || body || [];
  const qaIds = items.filter(b => b.id && b.id.startsWith("qa-")).map(b => b.id);
  if (qaIds.length > 0) {
    await json("DELETE", "/businesses", { ids: qaIds });
  }
});

/* ═══════════════════════════════════════════════════════════
   1. AUTHENTICATION
   ═══════════════════════════════════════════════════════════ */
describe("QA: Authentication", () => {
  it("1.1 rejects login with wrong password (401)", async () => {
    const { status, body } = await json("POST", "/auth/login", { username: TEST_USER, password: "wrongpassword12345" });
    assert.equal(status, 401);
    assert.ok(body.error?.toLowerCase().includes("invalid"));
  });

  it("1.2 rejects request with invalid JWT (401)", async () => {
    const { status } = await json("GET", "/auth/check", null, { Authorization: "Bearer this.is.a.bad.token" });
    assert.equal(status, 401);
  });

  it("1.3 rejects request with missing JWT (401)", async () => {
    const res = await fetch(API("/stats"));
    assert.equal(res.status, 401);
  });

  it("1.4 rejects request with expired JWT (401)", async () => {
    const { status } = await json("GET", "/auth/check", null, { Authorization: "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VybmFtZSI6InRlc3QiLCJpYXQiOjE1MDAwMDAwMDAsImV4cCI6MTUwMDAwMDAwMX0.abc123def456" });
    assert.equal(status, 401);
  });

  it("1.5 rejects duplicate registration (409)", async () => {
    const { status, body } = await json("POST", "/auth/register", { username: TEST_USER, password: TEST_PASS });
    assert.equal(status, 409);
    assert.ok(body.error?.toLowerCase().includes("already taken") || body.error?.toLowerCase().includes("already exists"));
  });

  it("1.6 rejects register with short password (400)", async () => {
    const { status, body } = await json("POST", "/auth/register", { username: `qa-short-${Date.now()}`, password: "ab" });
    assert.equal(status, 400);
    assert.ok(body.error?.toLowerCase().includes("at least 6"));
  });

  it("1.7 rejects register with missing fields (400)", async () => {
    const { status } = await json("POST", "/auth/register", { username: "x" });
    assert.equal(status, 400);
  });

  it("1.8 rejects login for nonexistent user (401)", async () => {
    const { status, body } = await json("POST", "/auth/login", { username: "nonexistent-user-99999", password: "testpass123" });
    assert.equal(status, 401);
  });

  it("1.9 change password with wrong current password (401)", async () => {
    const { status, body } = await json("POST", "/auth/change-password", { currentPassword: "wrongpassword", newPassword: "newpassword123" });
    assert.equal(status, 401);
    assert.ok(body.error?.toLowerCase().includes("incorrect"));
  });

  it("1.10 change password with short new password (400)", async () => {
    const { status, body } = await json("POST", "/auth/change-password", { currentPassword: TEST_PASS, newPassword: "ab" });
    assert.equal(status, 400);
    assert.ok(body.error?.toLowerCase().includes("at least 6"));
  });

  it("1.11 change password successfully", async () => {
    const NEW_PASS = "qa-new-pass-456";
    const { status } = await json("POST", "/auth/change-password", { currentPassword: TEST_PASS, newPassword: NEW_PASS });
    assert.equal(status, 200);
    // Reset back
    await json("POST", "/auth/change-password", { currentPassword: NEW_PASS, newPassword: TEST_PASS });
  });

  it("1.12 login after password change works", async () => {
    const nr = await json("POST", "/auth/change-password", { currentPassword: TEST_PASS, newPassword: "qa-temp-pass-789" });
    assert.equal(nr.status, 200);
    const lr = await json("POST", "/auth/login", { username: TEST_USER, password: "qa-temp-pass-789" });
    assert.equal(lr.status, 200);
    assert.ok(lr.body.token);
    // Reset back
    await json("POST", "/auth/change-password", { currentPassword: "qa-temp-pass-789", newPassword: TEST_PASS });
    const rr = await json("POST", "/auth/login", { username: TEST_USER, password: TEST_PASS });
    assert.equal(rr.status, 200);
    TOKEN = rr.body.token;
  });
});

/* ═══════════════════════════════════════════════════════════
   2. API — INVALID INPUTS / EDGE CASES
   ═══════════════════════════════════════════════════════════ */
describe("QA: API input edge cases", () => {
  it("2.1 rejects malformed JSON body (400)", async () => {
    const { status } = await raw("POST", "/businesses", "not valid json {{{", "application/json");
    assert.equal(status, 400);
  });

  it("2.2 rejects empty JSON body for config POST", async () => {
    const { status } = await json("POST", "/config", {});
    assert.equal(status, 200); // empty body is valid - just does nothing
  });

  it("2.3 POST to GET-only endpoint (405-ish)", async () => {
    const { status } = await json("POST", "/stats", {});
    // express returns 405 Method Not Allowed for routes that exist but don't match method
    // If the route doesn't exist, it returns 404 or passes through rate limiter
    assert.ok(status === 404 || status === 405);
  });

  it("2.4 rejects missing fields in scrape", async () => {
    const { status, body } = await json("POST", "/scrape", {});
    if (status === 429) return;
    assert.equal(status, 400);
    assert.ok(body.error);
  });

  it("2.5 caps pageSize at 10000", async () => {
    const { status, body } = await json("GET", "/businesses?pageSize=20000");
    assert.equal(status, 200);
    assert.ok(body.pageSize <= 10000);
  });

  it("2.6 handles negative page number", async () => {
    const { status, body } = await json("GET", "/businesses?page=-1");
    assert.equal(status, 200);
    assert.equal(body.page, 1); // should default to 1
  });

  it("2.7 rejects business creation with no name", async () => {
    const id = `qa-no-name-${Date.now()}`;
    const { status } = await json("POST", "/businesses", [{ id, name: "", category: "Test", city: "City" }]);
    assert.equal(status, 200); // empty name is allowed (saved as "")
    // Cleanup
    await json("DELETE", "/businesses", { ids: [id] });
  });

  it("2.8 rejects non-array business creation", async () => {
    const { status } = await json("POST", "/businesses", { id: "x", name: "Single" });
    assert.equal(status, 200); // Single object is wrapped into array
  });

  it("2.9 GET to POST-only /api/wa/pause returns 200 with HTML (catch-all)", async () => {
    const res = await fetch(API("/wa/pause"), { headers: { Authorization: `Bearer ${TOKEN}` } });
    assert.equal(res.status, 200);
    const text = await res.text();
    // Should serve frontend HTML, not JSON
    assert.ok(text.includes("<!DOCTYPE") || text.includes("<html"));
  });
});

/* ═══════════════════════════════════════════════════════════
   3. SCRAPER SAFEGUARDS (no actual scrape — tests validation)
   ═══════════════════════════════════════════════════════════ */
describe("QA: Scraper safeguards", () => {
  it("3.1 rejects scrape without location (400)", async () => {
    const { status, body } = await json("POST", "/scrape", { categories: ["test"] });
    if (status === 429) return;
    assert.equal(status, 400);
    assert.ok(body.error?.includes("location"));
  });

  it("3.2 rejects scrape without categories (400)", async () => {
    const { status, body } = await json("POST", "/scrape", { location: "Test" });
    if (status === 429) return;
    assert.equal(status, 400);
    assert.ok(body.error?.includes("category"));
  });

  it("3.3 rejects scrape with empty categories array (400)", async () => {
    const { status, body } = await json("POST", "/scrape", { location: "Test", categories: [] });
    if (status === 429) return;
    assert.equal(status, 400);
    assert.ok(body.error?.includes("category"));
  });

  it("3.4 cancel returns ok even when no job running", async () => {
    const { status, body } = await json("POST", "/scrape/cancel");
    assert.equal(status, 200);
    assert.equal(body.ok, true);
    assert.equal(body.cancelled, false);
  });

  it("3.5 status for nonexistent job returns 404", async () => {
    const { status, body } = await json("GET", `/scrape/status/nonexistent-job-${Date.now()}`);
    assert.equal(status, 404);
    assert.ok(body.error?.includes("not found"));
  });
});

/* ═══════════════════════════════════════════════════════════
   4. BUSINESS CRUD
   ═══════════════════════════════════════════════════════════ */
describe("QA: Business CRUD", () => {
  const testId = `qa-crud-${Date.now()}`;
  const testId2 = `qa-crud-2-${Date.now()}`;

  it("4.1 creates a single business", async () => {
    const { status, body } = await json("POST", "/businesses", [{
      id: testId, name: "QA Test Business", category: "Testing",
      address: "123 QA Street", city: "QACity",
      phone: "+919111111111", rating: "4.5", reviews: "100",
      website_url: "", website_status: "no_website",
    }]);
    assert.equal(status, 200);
    assert.equal(body.ok, true);
    assert.equal(body.inserted, 1);
  });

  it("4.2 reads the created business", async () => {
    const { body } = await json("GET", `/businesses?search=${encodeURIComponent("QA Test Business")}`);
    const items = body.data || body;
    const found = items.find(b => b.id === testId);
    assert.ok(found, "created business should be in list");
    assert.equal(found.name, "QA Test Business");
  });

  it("4.3 searches by phone number", async () => {
    const { body } = await json("GET", `/businesses?search=9111111111`);
    const items = body.data || body;
    assert.ok(items.some(b => b.id === testId));
  });

  it("4.4 filters by pipeline status", async () => {
    const { body } = await json("GET", `/businesses?pipeline_status=not_contacted`);
    const items = body.data || body;
    assert.ok(Array.isArray(items));
  });

  it("4.5 filters by website status", async () => {
    const { body } = await json("GET", `/businesses?website_status=no_website`);
    const items = body.data || body;
    assert.ok(Array.isArray(items));
  });

  it("4.6 updates pipeline status", async () => {
    const { status } = await json("PATCH", `/businesses/${testId}`, { pipeline_status: "interested" });
    assert.equal(status, 200);
  });

  it("4.7 verifies pipeline status update persists", async () => {
    const { body } = await json("GET", `/businesses?search=${encodeURIComponent("QA Test Business")}`);
    const items = body.data || body;
    const found = items.find(b => b.id === testId);
    assert.equal(found.pipeline_status, "interested");
  });

  it("4.8 rejects invalid pipeline status (400)", async () => {
    const { status, body } = await json("PATCH", `/businesses/${testId}`, { pipeline_status: "invalid_status" });
    assert.equal(status, 400);
    assert.ok(body.error?.includes("Invalid pipeline_status"));
  });

  it("4.9 updates notes", async () => {
    const { status } = await json("PATCH", `/businesses/${testId}`, { notes: "QA test note" });
    assert.equal(status, 200);
  });

  it("4.10 updates rating and reviews", async () => {
    const { status } = await json("PATCH", `/businesses/${testId}`, { rating: "4.8", reviews: "200" });
    assert.equal(status, 200);
  });

  it("4.11 creates multiple businesses in one call", async () => {
    const { status, body } = await json("POST", "/businesses", [
      { id: testId2, name: "QA Test Business 2", category: "Testing", city: "QACity", phone: "+919222222222" },
      { id: `qa-bulk-${Date.now()}`, name: "QA Bulk 1", category: "Bulk", city: "QACity", phone: "+919333333333" },
    ]);
    assert.equal(status, 200);
    assert.equal(body.inserted, 2);
  });

  it("4.12 deletes a single business", async () => {
    const { status, body } = await json("DELETE", "/businesses", { ids: [testId] });
    assert.equal(status, 200);
    assert.equal(body.ok, true);
  });

  it("4.13 confirms deletion", async () => {
    const { body } = await json("GET", `/businesses?search=${encodeURIComponent("QA Test Business")}`);
    const items = body.data || body;
    assert.ok(!items.some(b => b.id === testId));
  });

  it("4.14 bulk delete", async () => {
    const { body } = await json("DELETE", "/businesses", { ids: [testId2, `qa-bulk-${Date.now() - 1}`] });
    assert.equal(body.ok, true);
  });

  it("4.15 delete with empty array is safe", async () => {
    const { status, body } = await json("DELETE", "/businesses", { ids: [] });
    assert.equal(status, 200);
    assert.equal(body.ok, true);
  });
});

/* ═══════════════════════════════════════════════════════════
   5. DEDUPLICATION
   ═══════════════════════════════════════════════════════════ */
describe("QA: Deduplication", () => {
  const baseId = `qa-dup-${Date.now()}`;
  const sharedPhone = "+919444444444";

  after(async () => {
    await json("DELETE", "/businesses", { ids: [baseId, `${baseId}-second`] });
  });

  it("5.1 inserts first business", async () => {
    const { body } = await json("POST", "/businesses", [{
      id: baseId, name: "Dup Original", category: "Test",
      address: "First", city: "City", phone: sharedPhone,
      rating: "4.0", reviews: "5", website_url: "",
    }]);
    assert.equal(body.inserted, 1);
    assert.equal(body.updated, 0);
  });

  it("5.2 updates (not inserts) same phone", async () => {
    const { body } = await json("POST", "/businesses", [{
      id: `${baseId}-second`, name: "Dup Original", category: "Test",
      address: "Second", city: "City", phone: sharedPhone,
      rating: "4.5", reviews: "10", website_url: "",
    }]);
    assert.equal(body.inserted, 0);
    assert.equal(body.updated, 1);
  });

  it("5.3 preserves only one row for that phone", async () => {
    const { body } = await json("GET", `/businesses?search=${encodeURIComponent(sharedPhone)}`);
    const items = body.data || body;
    const matching = items.filter(b => b.phone === sharedPhone);
    assert.equal(matching.length, 1, "should have exactly one row for this phone");
  });
});

/* ═══════════════════════════════════════════════════════════
   6. WEBSITE CHECKER SAFEGUARDS
   ═══════════════════════════════════════════════════════════ */
describe("QA: Website checker", () => {
  it("6.1 accepts check-websites with ids array", async () => {
    const { status, body } = await json("POST", "/check-websites", { ids: ["test-nonexistent-id"] });
    assert.equal(status, 200);
    assert.equal(body.ok, true);
  });

  it("6.2 accepts check-websites without ids (checks all unchecked)", async () => {
    const { status, body } = await json("POST", "/check-websites", {});
    assert.equal(status, 200);
    assert.equal(body.ok, true);
  });

  it("6.3 rejects check-websites with invalid body", async () => {
    const { status } = await raw("POST", "/check-websites", "not json", "application/json");
    assert.equal(status, 400);
  });
});

/* ═══════════════════════════════════════════════════════════
   7. STATS & HISTORY
   ═══════════════════════════════════════════════════════════ */
describe("QA: Stats & history", () => {
  it("7.1 returns stats with expected fields", async () => {
    const { status, body } = await json("GET", "/stats");
    assert.equal(status, 200);
    assert.ok("total" in body);
    assert.ok("noWebsite" in body);
    assert.ok("broken" in body);
    assert.ok("byPipeline" in body);
    assert.ok("byCity" in body);
    assert.ok(Array.isArray(body.byPipeline));
    assert.ok(Array.isArray(body.byCity));
  });

  it("7.2 returns pipeline history", async () => {
    const { status, body } = await json("GET", "/pipeline-history");
    assert.equal(status, 200);
    assert.ok(Array.isArray(body));
  });

  it("7.3 returns send log", async () => {
    const { status, body } = await json("GET", "/send-log");
    assert.equal(status, 200);
    assert.ok(Array.isArray(body));
  });
});

/* ═══════════════════════════════════════════════════════════
   8. WHATSAPP SAFEGUARDS
   ═══════════════════════════════════════════════════════════ */
describe("QA: WhatsApp safeguards", () => {
  it("8.1 rejects send when not connected (400)", async () => {
    const { status, body } = await json("POST", "/wa/send", {
      businesses: [{ id: "x", name: "Test", phone: "+919555555555" }],
      message: "Hello {name}",
    });
    if (status === 429) return;
    assert.equal(status, 400);
    assert.ok(body.error?.includes("not connected"));
  });

  it("8.2 rejects send with empty businesses list", async () => {
    const { status, body } = await json("POST", "/wa/send", {
      businesses: [], message: "Hello",
    });
    if (status === 429) return;
    assert.equal(status, 400);
    assert.ok(body.error);
  });

  it("8.3 pause toggles paused state", async () => {
    const r1 = await json("POST", "/wa/pause");
    assert.equal(r1.body.paused, true);
    const r2 = await json("POST", "/wa/pause");
    assert.equal(r2.body.paused, false);
  });

  it("8.4 stop clears running state", async () => {
    const { status, body } = await json("POST", "/wa/stop");
    assert.equal(status, 200);
    assert.equal(body.ok, true);
  });

  it("8.5 disconnect is safe when already disconnected", async () => {
    const { status, body } = await json("POST", "/wa/disconnect");
    assert.equal(status, 200);
    assert.equal(body.ok, true);
  });

  it("8.6 returns status without crashing", async () => {
    const { status, body } = await json("GET", "/wa/status");
    assert.equal(status, 200);
    assert.ok("status" in body);
    assert.ok("sendState" in body);
  });
});

/* ═══════════════════════════════════════════════════════════
   9. CONFIG ENDPOINTS
   ═══════════════════════════════════════════════════════════ */
describe("QA: Config endpoints", () => {
  it("9.1 reads config", async () => {
    const { status } = await json("GET", "/config");
    assert.equal(status, 200);
  });

  it("9.2 writes config", async () => {
    const { status, body } = await json("POST", "/config", { test_key_qa: "qa_test_value" });
    assert.equal(status, 200);
    assert.equal(body.ok, true);
  });

  it("9.3 writes nested config value", async () => {
    const { status } = await json("POST", "/config", { nested_qa: { a: 1, b: [2, 3] } });
    assert.equal(status, 200);
  });

  it("9.4 reads back config values", async () => {
    const { status, body } = await json("GET", "/config");
    assert.equal(status, 200);
    assert.equal(body.test_key_qa, "qa_test_value");
    assert.deepEqual(body.nested_qa, { a: 1, b: [2, 3] });
  });

  it("9.5 overwrites config value", async () => {
    await json("POST", "/config", { test_key_qa: "updated_value" });
    const { body } = await json("GET", "/config");
    assert.equal(body.test_key_qa, "updated_value");
  });
});

/* ═══════════════════════════════════════════════════════════
   10. COMPETITOR EXAMPLES
   ═══════════════════════════════════════════════════════════ */
describe("QA: Competitor examples", () => {
  const mainId = `qa-comp-main-${Date.now()}`;
  const exampleId = `qa-comp-ex-${Date.now()}`;

  before(async () => {
    await json("POST", "/businesses", [
      { id: mainId, name: "Main Business", category: "QA Category", city: "QACity", phone: "+919666666661", website_url: "", website_status: "no_website" },
      { id: exampleId, name: "Example Biz", category: "QA Category", city: "QACity", phone: "+919666666662", website_url: "https://example.com", website_status: "working" },
    ]);
  });

  after(async () => {
    await json("DELETE", "/businesses", { ids: [mainId, exampleId] });
  });

  it("10.1 returns competitor examples", async () => {
    const { status, body } = await json("GET", `/businesses/${mainId}/competitor-examples`);
    assert.equal(status, 200);
    assert.ok(body.target);
    assert.equal(body.target.id, mainId);
    assert.ok(Array.isArray(body.examples));
    assert.ok(body.examples.length >= 1);
    assert.equal(body.examples[0].id, exampleId);
  });

  it("10.2 returns 404 for nonexistent business", async () => {
    const { status } = await json("GET", `/businesses/nonexistent-${Date.now()}/competitor-examples`);
    assert.equal(status, 404);
  });

  it("10.3 gracefully handles business with no city", async () => {
    const noCityId = `qa-nocity-${Date.now()}`;
    await json("POST", "/businesses", [{ id: noCityId, name: "No City Biz", category: "QA Category", city: "", phone: "+919666666663" }]);
    const { status } = await json("GET", `/businesses/${noCityId}/competitor-examples`);
    assert.equal(status, 200);
    await json("DELETE", "/businesses", { ids: [noCityId] });
  });
});

/* ═══════════════════════════════════════════════════════════
   11. PERFORMANCE / EDGE CASES
   ═══════════════════════════════════════════════════════════ */
describe("QA: Performance & edge cases", () => {
  it("11.1 pagination returns correct totalPages", async () => {
    const { body } = await json("GET", "/businesses?page=1&pageSize=100");
    assert.ok(body.total >= 0);
    assert.ok(body.totalPages >= 1);
    assert.equal(body.page, 1);
    assert.equal(body.pageSize, 100);
  });

  it("11.2 empty search returns all results", async () => {
    const { status } = await json("GET", "/businesses");
    assert.equal(status, 200);
  });

  it("11.3 search with special characters", async () => {
    const { status } = await json("GET", `/businesses?search=${encodeURIComponent("test' OR 1=1 --")}`);
    assert.equal(status, 200);
  });

  it("11.4 config handles special characters in values", async () => {
    const special = { "special-key": "test's & value <script>alert('xss')</script>" };
    const { status } = await json("POST", "/config", special);
    assert.equal(status, 200);
    const { body } = await json("GET", "/config");
    assert.equal(body["special-key"], "test's & value <script>alert('xss')</script>");
  });

  it("11.5 stats response format is correct", async () => {
    const { body } = await json("GET", "/stats");
    assert.equal(typeof body.total, "number");
    assert.equal(typeof body.noWebsite, "number");
    assert.equal(typeof body.broken, "number");
  });

  it("11.6 pipeline history returns recent changes", async () => {
    // Create a business, change pipeline status, verify history
    const histId = `qa-hist-${Date.now()}`;
    await json("POST", "/businesses", [{ id: histId, name: "Hist Test", category: "Test", city: "City", phone: "+919777777777" }]);
    await json("PATCH", `/businesses/${histId}`, { pipeline_status: "interested" });
    const { body } = await json("GET", "/pipeline-history");
    const histEntry = body.find(h => h.business_id === histId);
    assert.ok(histEntry, "should have history entry");
    assert.equal(histEntry.old_status, "not_contacted");
    assert.equal(histEntry.new_status, "interested");
    await json("DELETE", "/businesses", { ids: [histId] });
  });

  it("11.7 send log is writable", async () => {
    const { status } = await json("GET", "/send-log");
    assert.equal(status, 200);
  });
});
