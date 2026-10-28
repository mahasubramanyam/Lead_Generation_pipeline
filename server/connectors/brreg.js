// ─── Norway Brønnøysund Register (Brreg) connector ────────────────
// Official API: https://data.brreg.no/enhetsregisteret/api/dokumentasjon/en/index.html
// Base URL: https://data.brreg.no/enhetsregisteret/api
// License: NLOD 2.0 (Norwegian Licence for Open Government Data) — commercial use allowed with attribution.
// No authentication required. Free access.
// Rate limits: Not explicitly documented; conservative 1 req/sec enforced.
// Pagination: (page+1)*size cannot exceed 10,000; default size 20.
// Deleted entities: API returns 410 Gone for deleted entities fetched by org number.
// Sub-entities (underenheter) are not included in this connector.
// No personal identification data is fetched (no roles with SSN).
// ─────────────────────────────────────────────────────────────────────

import { ConnectorError, safeFetch, withRetry, sleep, normalizeLead, IntegrationStatus } from "./framework.js";

const BRREG_BASE_URL = "https://data.brreg.no/enhetsregisteret/api";

const brregConnector = {
  id: "brreg",
  name: "Norway Brønnøysund Register (Brreg)",
  provider: "brreg",
  capabilities: ["search", "verify"],
  configSchema: {
    required: [],
    optional: ["baseUrl"],
  },
  isConfigured() {
    return true; // No auth required; public API
  },
  isLegacy() {
    return false;
  },
  validateConfig(config) {
    const errors = [];
    if (config?.baseUrl && !/^https?:\/\//.test(config.baseUrl)) errors.push("baseUrl must be an http(s) URL");
    return { ok: errors.length === 0, errors };
  },
  async getStatus(config = {}) {
    this.lastCheck = new Date().toISOString();
    try {
      const baseUrl = (config.baseUrl || BRREG_BASE_URL).replace(/\/$/, "");
      const response = await safeFetch(`${baseUrl}/enheter?size=1`, {}, 5000);
      if (response.ok) {
        this.lastError = null;
        return { status: IntegrationStatus.CONNECTED, message: "Brreg API reachable" };
      }
      if (response.status === 429) {
        this.lastError = "Rate limited";
        return { status: IntegrationStatus.UNAVAILABLE, message: "Brreg rate limited", error: "rate_limited" };
      }
      this.lastError = `HTTP ${response.status}`;
      return { status: IntegrationStatus.FAILED, message: `Brreg returned ${response.status}`, error: `http_${response.status}` };
    } catch (e) {
      this.lastError = e.message;
      return { status: IntegrationStatus.FAILED, message: e.message, error: e.code || "connection_failed" };
    }
  },
  async search({ query = "", limit = 20, page = 0, config = {} } = {}) {
    const q = String(query || "").trim();
    if (!q) throw new ConnectorError("invalid_query", "query is required");
    const boundedLimit = Math.min(Math.max(1, Number(limit) || 20), 100);
    const boundedPage = Math.max(0, Number(page) || 0);

    // Pagination safety: (page+1)*size cannot exceed 10,000
    if ((boundedPage + 1) * boundedLimit > 10000) {
      throw new ConnectorError("invalid_pagination", "Pagination limit exceeded: (page+1)*size must not exceed 10,000");
    }

    const baseUrl = (config.baseUrl || BRREG_BASE_URL).replace(/\/$/, "");
    const url = new URL(`${baseUrl}/enheter`);
    url.searchParams.set("navn", q);
    url.searchParams.set("size", String(boundedLimit));
    url.searchParams.set("page", String(boundedPage));

    // Conservative rate limit: at least 1 second between requests
    const now = Date.now();
    const wait = 1000 - (now - (this._lastRequestAt || 0));
    if (wait > 0) await sleep(wait);
    this._lastRequestAt = Date.now();

    const response = await withRetry(async () => {
      const r = await safeFetch(url.toString(), {
        headers: { Accept: "application/json" },
      }, 10000);
      if (r.status === 429) throw new ConnectorError("rate_limited", "Brreg rate limit exceeded");
      if (!r.ok) throw new ConnectorError("provider_error", `Brreg search failed: ${r.status}`);
      return r;
    });

    const data = await response.json();
    const entities = data?._embedded?.enheter || [];

    // Filter out deleted entities (erSlettet === true)
    const activeEntities = entities.filter((e) => !e.erSlettet);

    const results = activeEntities.map((entity) => {
      const addr = entity.forretningsadresse || entity.postadresse || {};
      const addressParts = Array.isArray(addr.adresse) ? addr.adresse : (addr.adresse ? [addr.adresse] : []);
      const address = [...addressParts, addr.postnummer, addr.poststed].filter(Boolean).join(", ");
      const nace = entity.naeringskode1 || {};
      const orgForm = entity.organisasjonsform || {};

      return normalizeLead({
        name: entity.navn || "",
        category: nace.beskrivelse || "",
        address,
        city: addr.poststed || "",
        country: "NO",
        phone: entity.telefon || entity.mobil || "",
        email: entity.epostadresse || "",
        website_url: entity.hjemmeside || "",
        rating: "",
        reviews: "",
        lat: null,
        lon: null,
        location_query: q,
        source_record_id: entity.organisasjonsnummer || "",
      }, "brreg");
    });

    // Handle pagination metadata
    const pageInfo = data?.page || {};
    const totalPages = pageInfo.totalPages || 1;
    const totalElements = pageInfo.totalElements || results.length;

    return {
      provider: "brreg",
      attribution: "Contains data from the Central Coordinating Register for Legal Entities (Brønnøysundregistrene), licensed under NLOD 2.0",
      license: "NLOD 2.0 (Norwegian Licence for Open Government Data)",
      totalCount: totalElements,
      totalPages,
      currentPage: boundedPage,
      pageSize: boundedLimit,
      results,
    };
  },
  async getEntity(orgNumber, config = {}) {
    const normalized = String(orgNumber || "").replace(/\s+/g, "").trim();
    if (!normalized) throw new ConnectorError("invalid_input", "organisation number is required");

    const baseUrl = (config.baseUrl || BRREG_BASE_URL).replace(/\/$/, "");
    const url = `${baseUrl}/enheter/${encodeURIComponent(normalized)}`;

    // Conservative rate limit
    const now = Date.now();
    const wait = 1000 - (now - (this._lastRequestAt || 0));
    if (wait > 0) await sleep(wait);
    this._lastRequestAt = Date.now();

    const response = await withRetry(async () => {
      const r = await safeFetch(url, {
        headers: { Accept: "application/json" },
      }, 10000);
      if (r.status === 404) throw new ConnectorError("not_found", `Entity ${normalized} not found`);
      if (r.status === 410) throw new ConnectorError("removed", `Entity ${normalized} has been removed/deleted`);
      if (r.status === 429) throw new ConnectorError("rate_limited", "Brreg rate limit exceeded");
      if (!r.ok) throw new ConnectorError("provider_error", `Brreg request failed: ${r.status}`);
      return r;
    });

    const data = await response.json();

    // Check if entity is deleted
    if (data.erSlettet === true) {
      throw new ConnectorError("removed", `Entity ${normalized} has been removed/deleted`);
    }

    const addr = data.forretningsadresse || data.postadresse || {};
    const addressParts = Array.isArray(addr.adresse) ? addr.adresse : (addr.adresse ? [addr.adresse] : []);
    const address = [...addressParts, addr.postnummer, addr.poststed].filter(Boolean).join(", ");
    const nace = data.naeringskode1 || {};
    const orgForm = data.organisasjonsform || {};

    return {
      provider: "brreg",
      attribution: "Contains data from the Central Coordinating Register for Legal Entities (Brønnøysundregistrene), licensed under NLOD 2.0",
      license: "NLOD 2.0 (Norwegian Licence for Open Government Data)",
      entity: {
        organisasjonsnummer: data.organisasjonsnummer || normalized,
        navn: data.navn || "",
        organisasjonsform: orgForm.beskrivelse || orgForm.kode || "",
        naeringskode: nace.beskrivelse || "",
        naeringskodeKode: nace.kode || "",
        forretningsadresse: address,
        postadresse: data.postadresse ? [data.postadresse.adresse, data.postadresse.postnummer, data.postadresse.poststed].filter(Boolean).join(", ") : "",
        antallAnsatte: data.antallAnsatte ?? null,
        hjemmeside: data.hjemmeside || "",
        epostadresse: data.epostadresse || "",
        telefon: data.telefon || "",
        mobil: data.mobil || "",
        stiftelsesdato: data.stiftelsesdato || "",
        registreringsdatoEnhetsregisteret: data.registreringsdatoEnhetsregisteret || "",
        konkurs: data.konkurs || false,
        underAvvikling: data.underAvvikling || false,
        underTvangsavviklingEllerTvangsopplosning: data.underTvangsavviklingEllerTvangsopplosning || false,
        erSlettet: data.erSlettet || false,
        // Brreg does not provide phone/email/website for all entities; fields may be empty.
      },
    };
  },
  async getStatus(config = {}) {
    this.lastCheck = new Date().toISOString();
    try {
      const baseUrl = (config.baseUrl || BRREG_BASE_URL).replace(/\/$/, "");
      const response = await safeFetch(`${baseUrl}/enheter?size=1`, {}, 5000);
      if (response.ok) {
        this.lastError = null;
        return { status: IntegrationStatus.CONNECTED, message: "Brreg API reachable" };
      }
      if (response.status === 429) {
        this.lastError = "Rate limited";
        return { status: IntegrationStatus.UNAVAILABLE, message: "Brreg rate limited", error: "rate_limited" };
      }
      this.lastError = `HTTP ${response.status}`;
      return { status: IntegrationStatus.FAILED, message: `Brreg returned ${response.status}`, error: `http_${response.status}` };
    } catch (e) {
      this.lastError = e.message;
      return { status: IntegrationStatus.FAILED, message: e.message, error: e.code || "connection_failed" };
    }
  },
};

export default brregConnector;