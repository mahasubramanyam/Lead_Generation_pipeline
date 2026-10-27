import Papa from "papaparse";
import * as XLSX from "xlsx";

const MAX_FILE_BYTES = 5 * 1024 * 1024;
const MAX_ROWS = 10000;

function sanitizeCell(value) {
  const s = String(value ?? "").trim();
  // Prevent spreadsheet formula injection
  if (/^[=+\-@]/.test(s)) return `'${s}`;
  return s;
}

function normalizeHeader(h) {
  return String(h || "").trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
}

export function parseImportFile({ contentBase64, format }) {
  if (!contentBase64 || typeof contentBase64 !== "string") {
    throw new Error("content is required");
  }
  const buf = Buffer.from(contentBase64, "base64");
  if (buf.length === 0 || buf.length > MAX_FILE_BYTES) {
    throw new Error(`File must be between 1 byte and ${MAX_FILE_BYTES} bytes`);
  }

  let rows = [];
  let headers = [];

  if (format === "csv") {
    const text = buf.toString("utf8");
    const parsed = Papa.parse(text, { header: true, skipEmptyLines: true });
    if (parsed.errors && parsed.errors.length > 0) {
      throw new Error(parsed.errors[0].message || "CSV parse error");
    }
    headers = parsed.meta.fields || [];
    rows = parsed.data || [];
  } else if (format === "xlsx") {
    const wb = XLSX.read(buf, { type: "buffer" });
    const sheetName = wb.SheetNames[0];
    const sheet = wb.Sheets[sheetName];
    const json = XLSX.utils.sheet_to_json(sheet, { defval: "" });
    rows = json;
    headers = rows.length > 0 ? Object.keys(rows[0]) : [];
  } else {
    throw new Error("format must be 'csv' or 'xlsx'");
  }

  if (rows.length === 0) throw new Error("No data rows found");
  if (rows.length > MAX_ROWS) throw new Error(`Row count exceeds limit of ${MAX_ROWS}`);

  const normalizedHeaders = headers.map(normalizeHeader);
  const headerMap = {};
  headers.forEach((h, i) => { headerMap[normalizedHeaders[i]] = h; });

  const accepted = [];
  const rejected = [];
  rows.forEach((row, idx) => {
    const get = (key) => {
      const original = headerMap[key];
      return original ? sanitizeCell(row[original]) : "";
    };
    const name = get("name") || get("business_name") || get("company");
    if (!name) {
      rejected.push({ row: idx + 1, reason: "Missing name" });
      return;
    }
    accepted.push({
      name,
      category: get("category") || get("industry"),
      address: get("address"),
      city: get("city"),
      country: get("country"),
      phone: get("phone") || get("telephone"),
      email: get("email"),
      website_url: get("website") || get("website_url") || get("url"),
      rating: get("rating"),
      reviews: get("reviews"),
      location_query: get("location") || get("location_query"),
    });
  });

  return {
    headers,
    normalizedHeaders,
    totalRows: rows.length,
    acceptedCount: accepted.length,
    rejectedCount: rejected.length,
    errors: rejected,
    preview: accepted.slice(0, 20),
    accepted,
  };
}

export { sanitizeCell };
