// ─── UK Companies House API connector ──────────────────────────────
// Official API: https://developer.company-information.service.gov.uk/
// Rate limit: 600 requests per 5 minutes per API key.
// License: Open Government Licence v3.0 (commercial use allowed with attribution).
// Fields: company name, number, status, registered address, SIC codes, officers, PSC, filings.
// No phone, email, or website in basic company profile.
// ─────────────────────────────────────────────────────────────────────

import { ConnectorError, safeFetch, withRetry, normalizeLead, IntegrationStatus } from "./framework.js";

const COMPANIES_HOUSE_BASE_URL = "https://api.companieshouse.gov.uk";

function getApiKey(config) {
  return config?.apiKey || process.env.COMPANIES_HOUSE_API_KEY || "";
}

function normalizeCompanyNumber(num) {
  if (!num) return "";
  // Remove spaces and uppercase
  return String(num).replace(/\s+/g, "").toUpperCase();
}

const companiesHouseConnector = {
  id: "companies_house",
  name: "UK Companies House (company verification)",
  provider: "companies_house",
  capabilities: ["search", "verify"],
  configSchema: {
    required: ["apiKey"],
    optional: [],
  },
  isConfigured(config) {
    return Boolean(getApiKey(config || {}));
  },
  isLegacy() {
    return false;
  },
  validateConfig(config) {
    const errors = [];
    if (!getApiKey(config || {})) errors.push("apiKey is required (set COMPANIES_HOUSE_API_KEY or pass apiKey in config)");
    return { ok: errors.length === 0, errors };
  },
  async getStatus(config = {}) {
    this.lastCheck = new Date().toISOString();
    const apiKey = getApiKey(config);
    if (!apiKey) {
      this.lastError = "API key not configured";
      return { status: IntegrationStatus.UNCONFIGURED, message: "COMPANIES_HOUSE_API_KEY not set", error: "missing_api_key" };
    }
    try {
      // Test with a known company number (Companies House itself: 00002160)
      const url = `${COMPANIES_HOUSE_BASE_URL}/company/00002160`;
      const response = await safeFetch(url, {
        headers: { Authorization: `Basic ${btoa(apiKey + ":")}` },
      }, 5000);
      if (response.ok) {
        this.lastError = null;
        return { status: IntegrationStatus.CONNECTED, message: "Companies House API reachable and authenticated" };
      }
      if (response.status === 401) {
        this.lastError = "Invalid API key";
        return { status: IntegrationStatus.FAILED, message: "Invalid API key", error: "auth_failed" };
      }
      if (response.status === 429) {
        this.lastError = "Rate limited";
        return { status: IntegrationStatus.UNAVAILABLE, message: "Rate limited", error: "rate_limited" };
      }
      this.lastError = `HTTP ${response.status}`;
      return { status: IntegrationStatus.FAILED, message: `Companies House returned ${response.status}`, error: `http_${response.status}` };
    } catch (e) {
      this.lastError = e.message;
      return { status: IntegrationStatus.FAILED, message: e.message, error: e.code || "connection_failed" };
    }
  },
  async search({ query = "", limit = 20, config = {} } = {}) {
    const apiKey = getApiKey(config);
    if (!apiKey) {
      throw new ConnectorError("not_configured", "Companies House API key not configured: set COMPANIES_HOUSE_API_KEY", { errors: ["apiKey is required"] });
    }
    const q = String(query || "").trim();
    if (!q) throw new ConnectorError("invalid_query", "query is required");
    const boundedLimit = Math.min(Math.max(1, Number(limit) || 20), 100);

    const url = new URL(`${COMPANIES_HOUSE_BASE_URL}/search/companies`);
    url.searchParams.set("q", q);
    url.searchParams.set("items_per_page", String(boundedLimit));

    const response = await withRetry(async () => {
      const r = await safeFetch(url.toString(), {
        headers: { Authorization: `Basic ${btoa(apiKey + ":")}` },
      }, 10000);
      if (r.status === 401) throw new ConnectorError("auth_failed", "Invalid Companies House API key");
      if (r.status === 429) throw new ConnectorError("rate_limited", "Companies House rate limit exceeded (600 req/5 min)");
      if (!r.ok) throw new ConnectorError("provider_error", `Companies House search failed: ${r.status}`);
      return r;
    });

    const data = await response.json();
    const items = data.items || [];

    const results = items.map((item) => {
      const companyNumber = normalizeCompanyNumber(item.company_number);
      const address = item.address_snippet || "";
      // Companies House does not provide phone, email, or website in basic search results.
      return normalizeLead({
        name: item.title || "",
        category: (item.company_type || "").replace(/_/g, " "),
        address,
        city: "",
        country: "GB",
        phone: "",
        email: "",
        website_url: "",
        rating: "",
        reviews: "",
        location_query: q,
        source_record_id: companyNumber,
      }, "companies_house");
    });

    return {
      provider: "companies_house",
      attribution: "Contains public sector information licensed under the Open Government Licence v3.0",
      license: "Open Government Licence v3.0",
      totalCount: data.total_results || items.length,
      results,
    };
  },
  async getCompany(companyNumber, config = {}) {
    const apiKey = getApiKey(config);
    if (!apiKey) {
      throw new ConnectorError("not_configured", "Companies House API key not configured: set COMPANIES_HOUSE_API_KEY", { errors: ["apiKey is required"] });
    }
    const normalized = normalizeCompanyNumber(companyNumber);
    if (!normalized) throw new ConnectorError("invalid_input", "company number is required");

    const url = `${COMPANIES_HOUSE_BASE_URL}/company/${encodeURIComponent(normalized)}`;
    const response = await withRetry(async () => {
      const r = await safeFetch(url, {
        headers: { Authorization: `Basic ${btoa(apiKey + ":")}` },
      }, 10000);
      if (r.status === 401) throw new ConnectorError("auth_failed", "Invalid Companies House API key");
      if (r.status === 404) throw new ConnectorError("not_found", `Company ${normalized} not found`);
      if (r.status === 429) throw new ConnectorError("rate_limited", "Companies House rate limit exceeded (600 req/5 min)");
      if (!r.ok) throw new ConnectorError("provider_error", `Companies House request failed: ${r.status}`);
      return r;
    });

    const data = await response.json();
    const addr = data.registered_office_address || {};
    const address = [addr.premises, addr.address_line_1, addr.address_line_2, addr.locality, addr.region, addr.postal_code, addr.country].filter(Boolean).join(", ");

    return {
      provider: "companies_house",
      attribution: "Contains public sector information licensed under the Open Government Licence v3.0",
      license: "Open Government Licence v3.0",
      company: {
        company_number: data.company_number || normalized,
        company_name: data.company_name || "",
        company_status: data.company_status || "",
        company_type: data.type || "",
        date_of_creation: data.date_of_creation || "",
        sic_codes: data.sic_codes || [],
        registered_office_address: address,
        jurisdiction: data.jurisdiction || "",
        // Companies House does not provide phone, email, or website in the basic profile.
        phone: "",
        email: "",
        website_url: "",
      },
    };
  },
};

export default companiesHouseConnector;