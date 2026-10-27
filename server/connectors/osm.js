import { ConnectorError, safeFetch, withRetry, sleep, normalizeLead } from "./framework.js";

let lastRequestAt = 0;

const osmConnector = {
  id: "osm",
  name: "OpenStreetMap (Nominatim)",
  capabilities: ["search"],
  configSchema: {
    required: [],
    optional: ["baseUrl", "userAgent", "email"],
  },
  isConfigured() {
    return true;
  },
  validateConfig(config) {
    const errors = [];
    if (config?.baseUrl && !/^https?:\/\//.test(config.baseUrl)) errors.push("baseUrl must be an http(s) URL");
    return { ok: errors.length === 0, errors };
  },
  async search({ query = "", location = "", limit = 20, config = {} } = {}) {
    const q = [query, location].filter(Boolean).join(" ").trim();
    if (!q) throw new ConnectorError("invalid_query", "query or location is required");
    const boundedLimit = Math.min(Math.max(1, Number(limit) || 20), 50);
    const baseUrl = (config.baseUrl || process.env.OSM_BASE_URL || "https://nominatim.openstreetmap.org").replace(/\/$/, "");
    const url = new URL(`${baseUrl}/search`);
    url.searchParams.set("q", q);
    url.searchParams.set("format", "jsonv2");
    url.searchParams.set("limit", String(boundedLimit));
    url.searchParams.set("addressdetails", "1");
    url.searchParams.set("extratags", "1");

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
      results,
    };
  },
};

export default osmConnector;
