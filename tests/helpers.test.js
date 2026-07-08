import { describe, it } from "node:test";
import assert from "node:assert/strict";

// Prevent server from starting during unit tests
process.env.NODE_ENV = "test";
const { normalizeUrl, looksLikeBotChallenge, cleanPhone } = await import("../server.js");

describe("normalizeUrl", () => {
  it("adds https:// when protocol is missing", () => {
    assert.equal(normalizeUrl("example.com"), "https://example.com");
  });
  it("preserves existing https://", () => {
    assert.equal(normalizeUrl("https://example.com"), "https://example.com");
  });
  it("preserves existing http://", () => {
    assert.equal(normalizeUrl("http://example.com"), "http://example.com");
  });
  it("trims whitespace", () => {
    assert.equal(normalizeUrl("  example.com  "), "https://example.com");
  });
  it("returns null for null input", () => {
    assert.equal(normalizeUrl(null), null);
  });
  it("returns null for empty string", () => {
    assert.equal(normalizeUrl(""), null);
  });
  it("returns empty https:// for whitespace-only (existing behavior)", () => {
    assert.equal(normalizeUrl("   "), "https://");
  });
});

describe("looksLikeBotChallenge", () => {
  it("detects Cloudflare text", () => {
    assert.ok(looksLikeBotChallenge("Checking your browser before accessing", "https://example.com"));
  });
  it("detects captcha text", () => {
    assert.ok(looksLikeBotChallenge("Please verify you are human captcha", "https://example.com"));
  });
  it("detects unusual traffic", () => {
    assert.ok(looksLikeBotChallenge("unusual traffic from your network", "https://example.com"));
  });
  it("detects by URL path", () => {
    assert.ok(looksLikeBotChallenge("", "https://example.com/cdn-cgi/"));
  });
  it("detects _challenge in URL", () => {
    assert.ok(looksLikeBotChallenge("", "https://example.com/_challenge"));
  });
  it("detects enable javascript", () => {
    assert.ok(looksLikeBotChallenge("please enable javascript to continue", "https://example.com"));
  });
  it("detects ddos protection", () => {
    assert.ok(looksLikeBotChallenge("ddos protection by", "https://example.com"));
  });
  it("detects access denied", () => {
    assert.ok(looksLikeBotChallenge("access denied", "https://example.com"));
  });
  it("returns false for normal page", () => {
    assert.ok(!looksLikeBotChallenge("Welcome to our site! We offer great services.", "https://example.com"));
  });
  it("returns false for empty input", () => {
    assert.ok(!looksLikeBotChallenge("", ""));
  });
});

describe("cleanPhone", () => {
  it("formats 10-digit Indian number", () => {
    assert.equal(cleanPhone("9876543210"), "+919876543210");
  });
  it("formats 12-digit number starting with 91", () => {
    assert.equal(cleanPhone("919876543210"), "+919876543210");
  });
  it("strips non-digit characters", () => {
    assert.equal(cleanPhone("+91-98765-43210"), "+919876543210");
  });
  it("strips leading zeros", () => {
    assert.equal(cleanPhone("09876543210"), "+919876543210");
  });
  it("returns null for null input", () => {
    assert.equal(cleanPhone(null), null);
  });
  it("returns null for empty string", () => {
    assert.equal(cleanPhone(""), null);
  });
  it("returns null for too few digits", () => {
    assert.equal(cleanPhone("123"), null);
  });
  it("returns plus-prefixed for 7-9 digit numbers", () => {
    assert.equal(cleanPhone("1234567"), "+1234567");
  });
  it("returns null for no digits", () => {
    assert.equal(cleanPhone("abc-xyz"), null);
  });
});
