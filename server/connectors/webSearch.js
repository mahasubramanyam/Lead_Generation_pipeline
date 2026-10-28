import { ConnectorError, safeFetch, withRetry, normalizeLead, IntegrationStatus } from "./framework.js";

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
    optional: ["endpoint", "country"],
  },
  isConfigured(config) {
    const { provider, apiKey } = getConfig(config || {});
    return Boolean(provider && apiKey);
  },
  isLegacy() {
    return false;
  },
  validateConfig(config) {
    const { provider, apiKey } = getConfig(config || {});
    const errors = [];
    const allowed = ["brave", "bing", "google_cse"];
    if (!provider) errors.push("provider is required");
    else if (!allowed.includes(provider)) errors.push(`provider must be one of: ${allowed.join(", ")}`);
    if (!apiKey) errors.push("apiKey is required");
    if (config?.country) {
      const cc = String(config.country).toLowerCase();
      if (!VALID_COUNTRY_CODES.has(cc)) errors.push("country must be a valid ISO 3166-1 alpha-2 code");
    }
    return { ok: errors.length === 0, errors };
  },
  async getStatus(config = {}) {
    this.lastCheck = new Date().toISOString();
    const validation = this.validateConfig(config);
    if (!validation.ok) {
      this.lastError = validation.errors.join("; ");
      return { status: IntegrationStatus.UNCONFIGURED, message: "Missing required config", errors: validation.errors };
    }
    const { provider, apiKey } = getConfig(config);
    this.provider = provider;
    try {
      let testUrl, headers;
      if (provider === "brave") {
        testUrl = "https://api.search.brave.com/res/v1/web/search?q=test&count=1";
        headers = { "X-Subscription-Token": apiKey, Accept: "application/json" };
      } else if (provider === "bing") {
        testUrl = "https://api.bing.microsoft.com/v7.0/search?q=test&count=1";
        headers = { "Ocp-Apim-Subscription-Key": apiKey };
      } else if (provider === "google_cse") {
        const cx = process.env.GOOGLE_CSE_CX || "";
        if (!cx) {
          this.lastError = "GOOGLE_CSE_CX not set";
          return { status: IntegrationStatus.UNCONFIGURED, message: "GOOGLE_CSE_CX required", error: "missing_cx" };
        }
        testUrl = `https://www.googleapis.com/customsearch/v1?key=${apiKey}&cx=${cx}&q=test&num=1`;
        headers = {};
      } else {
        return { status: IntegrationStatus.UNAVAILABLE, message: "Unsupported provider" };
      }
      const response = await safeFetch(testUrl, { headers }, 5000);
      if (response.ok) {
        this.lastError = null;
        return { status: IntegrationStatus.CONNECTED, message: `${provider} reachable` };
      }
      if (response.status === 401 || response.status === 403) {
        this.lastError = "Invalid credentials";
        return { status: IntegrationStatus.FAILED, message: "Invalid or unauthorized credentials", error: "auth_failed" };
      }
      if (response.status === 429) {
        this.lastError = "Rate limited";
        return { status: IntegrationStatus.UNAVAILABLE, message: "Rate limited", error: "rate_limited" };
      }
      this.lastError = `HTTP ${response.status}`;
      return { status: IntegrationStatus.FAILED, message: `${provider} returned ${response.status}`, error: `http_${response.status}` };
    } catch (e) {
      this.lastError = e.message;
      return { status: IntegrationStatus.FAILED, message: e.message, error: e.code || "connection_failed" };
    }
  },
  async search({ query = "", location = "", country = "", limit = 10, config = {} } = {}) {
    const validation = this.validateConfig(config);
    if (!validation.ok) {
      throw new ConnectorError("not_configured", "Web search is not configured: " + validation.errors.join("; "), { errors: validation.errors });
    }
    const { provider, apiKey } = getConfig(config);
    const normalizedCountry = String(country || "").trim().toLowerCase();
    if (normalizedCountry && !VALID_COUNTRY_CODES.has(normalizedCountry)) {
      throw new ConnectorError("invalid_country", "country must be a valid ISO 3166-1 alpha-2 code");
    }

    const q = [query, location].filter(Boolean).join(" ").trim();
    if (!q) throw new ConnectorError("invalid_query", "query or location is required");
    const boundedLimit = Math.min(Math.max(1, Number(limit) || 10), 20);

    // Build query with country appended for providers that don't support a dedicated country parameter
    let searchQuery = q;
    let countryFilterSupported = false;
    let countryFilterMethod = "none";

    if (provider === "brave") {
      const url = new URL("https://api.search.brave.com/res/v1/web/search");
      url.searchParams.set("q", q);
      url.searchParams.set("count", String(boundedLimit));
      if (normalizedCountry) {
        url.searchParams.set("country", normalizedCountry);
        countryFilterSupported = true;
        countryFilterMethod = "country_param";
      }
      const response = await withRetry(async () => {
        const r = await safeFetch(url.toString(), { headers: { "X-Subscription-Token": apiKey, Accept: "application/json" } }, 10000);
        if (!r.ok) throw new ConnectorError("provider_error", `Brave search failed: ${r.status}`);
        return r;
      });
      const data = await response.json();
      const web = data.web?.results || [];
      return {
        provider: "brave",
        countryFilter: normalizedCountry || null,
        countryFilterSupported,
        countryFilterMethod,
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
      // Bing uses 'mkt' market code; country alone is not a supported filter without a language.
      // We append country to the query as the honest fallback and note the limitation.
      if (normalizedCountry) {
        searchQuery = `${q} ${normalizedCountry}`;
        url.searchParams.set("q", searchQuery);
        countryFilterSupported = false;
        countryFilterMethod = "query_suffix (Bing requires a market code 'mkt' for country filtering; country appended to query instead)";
      }
      const response = await withRetry(async () => {
        const r = await safeFetch(url.toString(), { headers: { "Ocp-Apim-Subscription-Key": apiKey } }, 10000);
        if (!r.ok) throw new ConnectorError("provider_error", `Bing search failed: ${r.status}`);
        return r;
      });
      const data = await response.json();
      const web = data.webPages?.value || [];
      return {
        provider: "bing",
        countryFilter: normalizedCountry || null,
        countryFilterSupported,
        countryFilterMethod,
        results: web.map((r, idx) => normalizeLead({
          name: r.name || "",
          website_url: r.url || "",
          address: r.snippet || "",
          location_query: searchQuery,
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
      if (normalizedCountry) {
        url.searchParams.set("gl", normalizedCountry);
        countryFilterSupported = true;
        countryFilterMethod = "gl_param";
      }
      const response = await withRetry(async () => {
        const r = await safeFetch(url.toString(), {}, 10000);
        if (!r.ok) throw new ConnectorError("provider_error", `Google CSE failed: ${r.status}`);
        return r;
      });
      const data = await response.json();
      const items = data.items || [];
      return {
        provider: "google_cse",
        countryFilter: normalizedCountry || null,
        countryFilterSupported,
        countryFilterMethod,
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