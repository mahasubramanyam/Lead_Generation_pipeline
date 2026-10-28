// ─── OSM / Nominatim compliance notice ─────────────────────────────
// The public Nominatim service at nominatim.openstreetmap.org is governed
// by the OSMF Nominatim Usage Policy (https://operations.osmfoundation.org/policies/nominatim).
// That policy explicitly forbids:
//   - "Systematic queries" (downloading all POIs in an area)
//   - "Reselling of geocoding results" (apps whose primary function is geocoding)
//   - Bulk geocoding of larger amounts of data
// Business lead discovery via public Nominatim search cannot be demonstrated
// to comply with these restrictions. Therefore, in production (NODE_ENV=production),
// public Nominatim business discovery is DISABLED. The connector returns an explicit
// unavailable status and an actionable error. No mock data or fallback is provided.
// For production use, deploy a self-hosted Nominatim instance or use a compliant
// third-party provider. See the E2a audit for details.
// ─────────────────────────────────────────────────────────────────────

import { ConnectorError, safeFetch, withRetry, sleep, normalizeLead, IntegrationStatus } from "./framework.js";

const NODE_ENV = process.env.NODE_ENV || "";
const IS_PRODUCTION = NODE_ENV === "production";

// Fail-closed: public Nominatim discovery is disabled unless explicitly opted in.
// Production always rejects. Missing NODE_ENV also rejects (fail-closed).
// Only explicitly non-production environments (development, test) with the flag enabled are allowed.
const OSM_PUBLIC_DISCOVERY_ENABLED = process.env.OSM_PUBLIC_DISCOVERY_ENABLED === "true";
const IS_EXPLICIT_NON_PRODUCTION = NODE_ENV === "development" || NODE_ENV === "test";
const OSM_DISCOVERY_ALLOWED = OSM_PUBLIC_DISCOVERY_ENABLED && IS_EXPLICIT_NON_PRODUCTION && !IS_PRODUCTION;

const COMPLIANCE_MESSAGE = "Public Nominatim business discovery is disabled: the OSMF Nominatim Usage Policy forbids systematic POI queries and reselling of geocoding results for lead discovery. To enable for local development/testing only, set OSM_PUBLIC_DISCOVERY_ENABLED=true and NODE_ENV=development (or test). Missing or invalid configuration is treated as disabled. For production, deploy a self-hosted Nominatim instance or use a compliant third-party provider. See https://operations.osmfoundation.org/policies/nominatim";

let lastRequestAt = 0;

const VALID_COUNTRY_CODES = new Set([
  "ad","ae","af","ag","ai","al","am","ao","aq","ar","as","at","au","aw","ax","az",
  "ba","bb","bd","be","bf","bg","bh","bi","bj","bl","bm","bn","bo","bq","br","bs","bt","bv","bw","by","bz",
  "ca","cc","cd","cf","cg","ch","ci","ck","cl","cm","cn","co","cr","cu","cv","cw","cx","cy","cz",
  "de","dj","dk","dm","do","dz",
  "ec","ee","eg","eh","er","es","et",
  "fi","fj","fk","fm","fo","fr",
  "ga","gb","gd","ge","gf","gg","gh","gi","gl","gm","gn","gp","gq","gr","gs","gt","gu","gw","gy",
  "hk","hm","hn","hr","ht","hu",
  "id","ie","il","im","in","io","iq","ir","is","it",
  "je","jm","jo","jp",
  "ke","kg","kh","ki","km","kn","kp","kr","kw","ky","kz",
  "la","lb","lc","li","lk","lr","ls","lt","lu","lv","ly",
  "ma","mc","md","me","mf","mg","mh","mk","ml","mm","mn","mo","mp","mq","mr","ms","mt","mu","mv","mw","mx","my","mz",
  "na","nc","ne","nf","ng","ni","nl","no","np","nr","nu","nz",
  "om",
  "pa","pe","pf","pg","ph","pk","pl","pm","pn","pr","ps","pt","pw","py",
  "qa",
  "re","ro","rs","ru","rw",
  "sa","sb","sc","sd","se","sg","sh","si","sj","sk","sl","sm","sn","so","sr","ss","st","sv","sx","sy","sz",
  "tc","td","tf","tg","th","tj","tk","tl","tm","tn","to","tr","tt","tv","tw","tz",
  "ua","ug","um","us","uy","uz",
  "va","vc","ve","vg","vi","vn","vu",
  "wf","ws",
  "ye","yt",
  "za","zm","zw",
]);

const osmConnector = {
  id: "osm",
  name: "OpenStreetMap (Nominatim)",
  provider: "openstreetmap",
  capabilities: ["search"],
  configSchema: {
    required: [],
    optional: ["baseUrl", "userAgent", "email", "country"],
  },
  isConfigured() {
    // Fail-closed: only enabled when explicitly opted in for non-production.
    return OSM_DISCOVERY_ALLOWED;
  },
  isLegacy() {
    return false;
  },
  validateConfig(config) {
    const errors = [];
    if (config?.baseUrl && !/^https?:\/\//.test(config.baseUrl)) errors.push("baseUrl must be an http(s) URL");
    if (config?.country && !VALID_COUNTRY_CODES.has(String(config.country).toLowerCase())) {
      errors.push("country must be a valid ISO 3166-1 alpha-2 code");
    }
    if (!OSM_DISCOVERY_ALLOWED) {
      errors.push(COMPLIANCE_MESSAGE);
    }
    return { ok: errors.length === 0, errors };
  },
  async getStatus(config = {}) {
    this.lastCheck = new Date().toISOString();
    if (!OSM_DISCOVERY_ALLOWED) {
      this.lastError = "compliance_restricted";
      return { status: IntegrationStatus.UNAVAILABLE, message: COMPLIANCE_MESSAGE, error: "compliance_restricted" };
    }
    try {
      const baseUrl = (config.baseUrl || process.env.OSM_BASE_URL || "https://nominatim.openstreetmap.org").replace(/\/$/, "");
      const testUrl = new URL(`${baseUrl}/search`);
      testUrl.searchParams.set("q", "test");
      testUrl.searchParams.set("format", "jsonv2");
      testUrl.searchParams.set("limit", "1");
      const userAgent = config.userAgent || process.env.OSM_USER_AGENT || "lead-pipeline/1.0 (contact: admin@example.com)";
      const response = await safeFetch(testUrl.toString(), { headers: { "User-Agent": userAgent } }, 5000);
      if (response.ok) {
        this.lastError = null;
        return { status: IntegrationStatus.CONNECTED, message: "OSM Nominatim reachable" };
      }
      if (response.status === 429) {
        this.lastError = "Rate limited";
        return { status: IntegrationStatus.UNAVAILABLE, message: "OSM rate limited", error: "rate_limited" };
      }
      this.lastError = `HTTP ${response.status}`;
      return { status: IntegrationStatus.FAILED, message: `OSM returned ${response.status}`, error: `http_${response.status}` };
    } catch (e) {
      this.lastError = e.message;
      return { status: IntegrationStatus.FAILED, message: e.message, error: e.code || "connection_failed" };
    }
  },
  async search({ query = "", location = "", country = "", category = "", limit = 20, config = {} } = {}) {
    if (!OSM_DISCOVERY_ALLOWED) {
      throw new ConnectorError("compliance_restricted", COMPLIANCE_MESSAGE);
    }
    const q = [category, query, location].filter(Boolean).join(" ").trim();
    if (!q) throw new ConnectorError("invalid_query", "query, category, or location is required");
    const boundedLimit = Math.min(Math.max(1, Number(limit) || 20), 50);

    const normalizedCountry = String(country || "").trim().toLowerCase();
    if (normalizedCountry && !VALID_COUNTRY_CODES.has(normalizedCountry)) {
      throw new ConnectorError("invalid_country", "country must be a valid ISO 3166-1 alpha-2 code");
    }

    const baseUrl = (config.baseUrl || process.env.OSM_BASE_URL || "https://nominatim.openstreetmap.org").replace(/\/$/, "");
    const url = new URL(`${baseUrl}/search`);
    url.searchParams.set("q", q);
    url.searchParams.set("format", "jsonv2");
    url.searchParams.set("limit", String(boundedLimit));
    url.searchParams.set("addressdetails", "1");
    url.searchParams.set("extratags", "1");
    if (normalizedCountry) {
      url.searchParams.set("countrycodes", normalizedCountry);
    }

    // Conservative rate limit: at least 1 second between requests
    const now = Date.now();
    const wait = 1000 - (now - lastRequestAt);
    if (wait > 0) await sleep(wait);
    lastRequestAt = Date.now();

    const userAgent = config.userAgent || process.env.OSM_USER_AGENT || "lead-pipeline/1.0 (contact: admin@example.com)";
    const response = await withRetry(async () => {
      const r = await safeFetch(url.toString(), {
        headers: {
          "User-Agent": userAgent,
          "Accept-Language": "en",
        },
      }, 10000);
      if (r.status === 429) throw new ConnectorError("rate_limited", "OSM rate limit exceeded");
      if (!r.ok) throw new ConnectorError("provider_error", `OSM request failed: ${r.status}`);
      return r;
    });

    const data = await response.json();
    if (!Array.isArray(data)) throw new ConnectorError("invalid_response", "Unexpected OSM response");

    const results = data.map((item) => {
      const addr = item.address || {};
      const extratags = item.extratags || {};
      const city = addr.city || addr.town || addr.village || addr.hamlet || "";
      const country = addr.country || "";
      const countryCode = addr.country_code ? addr.country_code.toUpperCase() : "";
      const address = [addr.house_number, addr.road, addr.suburb, addr.city || addr.town || addr.village].filter(Boolean).join(", ");
      return normalizeLead({
        name: item.namedetails?.name || item.display_name?.split(",")[0] || "Unknown",
        category: item.type || item.class || "",
        address,
        city,
        country: countryCode || country,
        phone: extratags.phone || extratags["contact:phone"] || "",
        email: extratags.email || extratags["contact:email"] || "",
        website_url: extratags.website || extratags["contact:website"] || "",
        rating: "",
        reviews: "",
        lat: item.lat ? Number(item.lat) : null,
        lon: item.lon ? Number(item.lon) : null,
        location_query: q,
        source_record_id: item.place_id || item.osm_id,
      }, "osm");
    });

    return {
      provider: "openstreetmap",
      attribution: "Data © OpenStreetMap contributors, ODbL 1.0",
      countryFilter: normalizedCountry || null,
      categoryFilter: category || null,
      results,
    };
  },
};

export default osmConnector;