import dns from "node:dns/promises";

export class ConnectorError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.code = code;
    this.details = details;
  }
}

export const IntegrationStatus = {
  UNCONFIGURED: "unconfigured",
  CONFIGURED: "configured",
  CONNECTED: "connected",
  RUNNING: "running",
  FAILED: "failed",
  UNAVAILABLE: "unavailable",
  LEGACY: "legacy",
};

export function isLegacyStatus(status) {
  return status === IntegrationStatus.LEGACY;
}

export function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function isPrivateIp(ip) {
  const v = String(ip || "").toLowerCase();
  if (v === "localhost") return true;
  if (v === "::1" || v === "::" || v === "0:0:0:0:0:0:0:1") return true;
  if (v.startsWith("fe80:") || v.startsWith("fc") || v.startsWith("fd")) return true;
  if (v.startsWith("::ffff:")) return isPrivateIp(v.slice(7));
  const parts = v.split(".").map(Number);
  if (parts.length === 4 && parts.every((n) => Number.isInteger(n) && n >= 0 && n <= 255)) {
    const [a, b] = parts;
    if (a === 0 || a === 10 || a === 127) return true;
    if (a === 169 && b === 254) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 100 && b >= 64 && b <= 127) return true;
    if (a === 198 && (b === 18 || b === 19)) return true;
    if (a >= 224) return true;
  }
  return false;
}

export async function safeFetch(url, options = {}, timeoutMs = 10000) {
  const parsed = new URL(url);
  if (!["http:", "https:"].includes(parsed.protocol)) throw new ConnectorError("invalid_url", "Unsupported protocol");
  const host = parsed.hostname.toLowerCase();
  if (host === "localhost" || host === "metadata.google.internal") throw new ConnectorError("blocked_host", "Blocked host");
  if (isPrivateIp(host)) throw new ConnectorError("blocked_private", "Blocked private address");
  const addresses = await dns.lookup(host, { all: true, verbatim: true });
  if (!addresses || addresses.length === 0) throw new ConnectorError("dns_failed", "DNS resolution failed");
  for (const addr of addresses) {
    if (isPrivateIp(addr.address)) throw new ConnectorError("blocked_private", "Blocked private address");
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal, redirect: "follow" });
  } finally {
    clearTimeout(timeout);
  }
}

export async function withRetry(fn, { retries = 2, baseDelay = 300, maxDelay = 3000 } = {}) {
  let lastError;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      if (attempt === retries) break;
      const delay = Math.min(baseDelay * Math.pow(2, attempt), maxDelay);
      await sleep(delay);
    }
  }
  throw lastError;
}

const registry = new Map();

export function registerConnector(connector) {
  if (!connector || !connector.id) throw new Error("Connector must have an id");
  if (registry.has(connector.id)) throw new Error(`Connector already registered: ${connector.id}`);
  registry.set(connector.id, connector);
}

export function getConnector(id) {
  return registry.get(id) || null;
}

export function listConnectors() {
  return Array.from(registry.values()).map((c) => {
    const configured = typeof c.isConfigured === "function" ? c.isConfigured() : true;
    let status = configured ? IntegrationStatus.CONFIGURED : IntegrationStatus.UNCONFIGURED;
    if (c.statusOverride) status = c.statusOverride;
    const legacy = typeof c.isLegacy === "function" ? c.isLegacy() : false;
    if (legacy) status = IntegrationStatus.LEGACY;
    return {
      id: c.id,
      name: c.name,
      capabilities: c.capabilities || [],
      configSchema: c.configSchema || { required: [], optional: [] },
      configured,
      status,
      legacy,
      provider: c.provider || null,
      lastCheck: c.lastCheck || null,
      error: c.lastError || null,
    };
  });
}

export function validateConnectorConfig(id, config) {
  const c = getConnector(id);
  if (!c) throw new ConnectorError("not_found", "Unknown connector");
  if (typeof c.validateConfig === "function") return c.validateConfig(config || {});
  return { ok: true, errors: [] };
}

export function normalizeLead(raw, sourceType) {
  return {
    name: raw.name || "",
    category: raw.category || "",
    address: raw.address || "",
    city: raw.city || "",
    country: raw.country || "",
    phone: raw.phone || "",
    email: raw.email || "",
    website_url: raw.website_url || raw.websiteUrl || "",
    rating: raw.rating || "",
    reviews: raw.reviews || "",
    lat: raw.lat ?? null,
    lon: raw.lon ?? null,
    location_query: raw.location_query || raw.locationQuery || "",
    source: sourceType,
  };
}
