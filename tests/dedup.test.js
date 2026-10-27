import { describe, it, before } from "node:test";
import assert from "node:assert/strict";

const BASE = "http://localhost:5000";
const API = (path) => `${BASE}/api${path}`;

let TOKEN = "";
const USER = `dedup-${Date.now()}`;
const PASS = "deduppass123";

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

describe("Phase 2 dedup and merge", () => {
  it("ingests a lead and is idempotent on repeated source record", async () => {
    const first = await json("POST", "/leads/ingest", { source: { type: "test", recordId: "idem-1" }, lead: { name: "Idem Lead", phone: "+14155550100" } });
    assert.equal(first.status, 200);
    assert.equal(first.body.inserted, true);
    const second = await json("POST", "/leads/ingest", { source: { type: "test", recordId: "idem-1" }, lead: { name: "Idem Lead", phone: "+14155550100" } });
    assert.equal(second.status, 200);
    assert.equal(second.body.inserted, false);
    assert.equal(second.body.updated, true);
    assert.equal(second.body.leadId, first.body.leadId);
    assert.equal(second.body.sourceId, first.body.sourceId);
  });

  it("exact phone identifier prevents duplicate lead creation", async () => {
    const first = await json("POST", "/leads/ingest", { source: { type: "test", recordId: "exact-1" }, lead: { name: "Exact One", phone: "+14155550200" } });
    const second = await json("POST", "/leads/ingest", { source: { type: "test", recordId: "exact-2" }, lead: { name: "Exact Two", phone: "+14155550200" } });
    assert.equal(second.body.leadId, first.body.leadId);
  });

  it("conflicting identifiers are flagged in duplicate candidates", async () => {
    const a = await json("POST", "/leads/ingest", { source: { type: "test", recordId: "conf-a" }, lead: { name: "Conflict A", phone: "+14155550300", city: "SF" } });
    await json("POST", "/leads/ingest", { source: { type: "test", recordId: "conf-b" }, lead: { name: "Conflict B", phone: "+14155550400", city: "SF" } });
    const dup = await json("GET", `/leads/${a.body.leadId}/duplicates`);
    assert.equal(dup.status, 200);
    const cand = dup.body.candidates.find((c) => c.lead.id !== a.body.leadId);
    assert.ok(cand, "should have candidate");
    assert.equal(cand.conflicting, true);
  });

  it("merge requires force for conflicting identifiers", async () => {
    const a = await json("POST", "/leads/ingest", { source: { type: "test", recordId: "merge-a" }, lead: { name: "Merge A", phone: "+14155550500", city: "SF" } });
    const b = await json("POST", "/leads/ingest", { source: { type: "test", recordId: "merge-b" }, lead: { name: "Merge B", phone: "+14155550600", city: "SF" } });
    const noForce = await json("POST", "/leads/merge", { survivorId: a.body.leadId, mergedId: b.body.leadId, reason: "test" });
    assert.equal(noForce.status, 409);
    const forced = await json("POST", "/leads/merge", { survivorId: a.body.leadId, mergedId: b.body.leadId, reason: "test", force: true });
    assert.equal(forced.status, 200);
    assert.ok(forced.body.undoToken);
  });

  it("merge history and undo restore the merged lead", async () => {
    const a = await json("POST", "/leads/ingest", { source: { type: "test", recordId: "undo-a" }, lead: { name: "Undo A", phone: "+14155550700", city: "SF" } });
    const b = await json("POST", "/leads/ingest", { source: { type: "test", recordId: "undo-b" }, lead: { name: "Undo B", phone: "+14155550800", city: "SF" } });
    const merge = await json("POST", "/leads/merge", { survivorId: a.body.leadId, mergedId: b.body.leadId, reason: "undo test", force: true });
    assert.equal(merge.status, 200);
    const beforeUndo = await json("GET", `/leads/${b.body.leadId}`);
    assert.equal(beforeUndo.status, 404);
    const undo = await json("POST", "/leads/undo-merge", { undoToken: merge.body.undoToken });
    assert.equal(undo.status, 200);
    const afterUndo = await json("GET", `/leads/${b.body.leadId}`);
    assert.equal(afterUndo.status, 200);
  });

  it("tenant isolation prevents cross-tenant merge", async () => {
    // second user
    const other = `dedup-other-${Date.now()}`;
    const reg = await json("POST", "/auth/register", { username: other, password: PASS });
    // register returns token but TOKEN global; use direct fetch
    const tok2 = reg.body.token;
    const leadOther = await fetch(API("/leads/ingest"), { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${tok2}` }, body: JSON.stringify({ source: { type: "test", recordId: "other-1" }, lead: { name: "Other Tenant", phone: "+14155550900" } }) }).then(r => r.json());
    const mine = await json("POST", "/leads/ingest", { source: { type: "test", recordId: "mine-1" }, lead: { name: "My Tenant", phone: "+14155550901" } });
    const cross = await fetch(API("/leads/merge"), { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${TOKEN}` }, body: JSON.stringify({ survivorId: mine.body.leadId, mergedId: leadOther.leadId, force: true }) });
    assert.equal(cross.status, 404);
  });

  it("preserves existing businesses API contract", async () => {
    const r = await json("GET", "/businesses?page=1&pageSize=5");
    assert.equal(r.status, 200);
    assert.ok(Array.isArray(r.body.data));
    assert.ok("total" in r.body);
  });
});
