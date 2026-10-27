import { ConnectorError, safeFetch, withRetry, normalizeLead } from "./framework.js";

function getConfig(config) {
  const provider = config?.provider || process.env.WEB_SEARCH_PROVIDER || "";
  const apiKey = config?.apiKey || process.env.WEB_SEARCH_API_KEY || "";
  return { provider: provider.toLowerCase(), apiKey };
}

const webSearchConnector = {
  id: "web_search",
  name: "Web Search (configurable provider)",
  capabilities: ["search"],
  configSchema: {
    required: ["provider", "apiKey"],
    optional: ["endpoint"],
  },
  isConfigured(config) {
    const { provider, apiKey } = getConfig(config || {});
    return Boolean(provider && apiKey);
  },
  validateConfig(config) {
    const { provider, apiKey } = getConfig(config || {});
    const errors = [];
    const allowed = ["brave", "bing", "google_cse"];
    if (!provider) errors.push("provider is required");
    else if (!allowed.includes(provider)) errors.push(`provider must be one of: ${allowed.join(", ")}`);
    if (!apiKey) errors.push("apiKey is required");
    return { ok: errors.length === 0, errors };
  },
  async search({ query = "", location = "", limit = 10, config = {} } = {}) {
    const validation = this.validateConfig(config);
    if (!validation.ok) {
      throw new ConnectorError("not_configured", "Web search is not configured: " + validation.errors.join("; "), { errors: validation.errors });
    }
    const { provider, apiKey } = getConfig(config);
    const q = [query, location].filter(Boolean).join(" ").trim();
    if (!q) throw new ConnectorError("invalid_query", "query or location is required");
    const boundedLimit = Math.min(Math.max(1, Number(limit) || 10), 20);

    if (provider === "brave") {
      const url = new URL("https://api.search.brave.com/res/v1/web/search");
      url.searchParams.set("q", q);
      url.searchParams.set("count", String(boundedLimit));
      const response = await withRetry(async () => {
        const r = await safeFetch(url.toString(), { headers: { "X-Subscription-Token": apiKey, Accept: "application/json" } }, 10000);
        if (!r.ok) throw new ConnectorError("provider_error", `Brave search failed: ${r.status}`);
        return r;
      });
      const data = await response.json();
      const web = data.web?.results || [];
      return {
        provider: "brave",
        results: web.map((r, idx) => normalizeLead({
          name: r.title || "",
          website_url: r.url || "",
          address: r.description || "",
          location_query: q,
          source_record_id: r.url || `brave-${idx}`,
        }, "web_search")),
      };
    }

    if (provider === "bing") {
      const url = new URL("https://api.bing.microsoft.com/v7.0/search");
      url.searchParams.set("q", q);
      url.searchParams.set("count", String(boundedLimit));
      const response = await withRetry(async () => {
        const r = await safeFetch(url.toString(), { headers: { "Ocp-Apim-Subscription-Key": apiKey } }, 10000);
        if (!r.ok) throw new ConnectorError("provider_error", `Bing search failed: ${r.status}`);
        return r;
      });
      const data = await response.json();
      const web = data.webPages?.value || [];
      return {
        provider: "bing",
        results: web.map((r, idx) => normalizeLead({
          name: r.name || "",
          website_url: r.url || "",
          address: r.snippet || "",
          location_query: q,
          source_record_id: r.url || `bing-${idx}`,
        }, "web_search")),
      };
    }

    if (provider === "google_cse") {
      const cx = process.env.GOOGLE_CSE_CX || "";
      if (!cx) throw new ConnectorError("not_configured", "GOOGLE_CSE_CX is required for Google Custom Search");
      const url = new URL("https://www.googleapis.com/customsearch/v1");
      url.searchParams.set("key", apiKey);
      url.searchParams.set("cx", cx);
      url.searchParams.set("q", q);
      url.searchParams.set("num", String(boundedLimit));
      const response = await withRetry(async () => {
        const r = await safeFetch(url.toString(), {}, 10000);
        if (!r.ok) throw new ConnectorError("provider_error", `Google CSE failed: ${r.status}`);
        return r;
      });
      const data = await response.json();
      const items = data.items || [];
      return {
        provider: "google_cse",
        results: items.map((r, idx) => normalizeLead({
          name: r.title || "",
          website_url: r.link || "",
          address: r.snippet || "",
          location_query: q,
          source_record_id: r.link || `gcs-${idx}`,
        }, "web_search")),
      };
    }

    throw new ConnectorError("unsupported_provider", "Unsupported web search provider");
  },
};

export default webSearchConnector;
