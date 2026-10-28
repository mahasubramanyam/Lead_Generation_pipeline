import React, { useState, useEffect } from "react";

function statusBadge(status) {
  const colors = {
    unconfigured: "var(--web-no_website)",
    configured: "var(--st-will_talk_later)",
    connected: "var(--web-working)",
    running: "var(--st-interested)",
    failed: "var(--web-no_website)",
    unavailable: "var(--st-not_interested)",
    legacy: "var(--st-not_contacted)",
  };
  const labels = {
    unconfigured: "Unconfigured",
    configured: "Configured",
    connected: "Connected",
    running: "Running",
    failed: "Failed",
    unavailable: "Unavailable",
    legacy: "Legacy",
  };
  return (
    <span className="badge-status" style={{ background: "#f4f3ee", color: colors[status] || "inherit" }}>
      <span className="badge-dot" style={{ background: colors[status] || "inherit" }} />
      {labels[status] || status}
    </span>
  );
}

export default function ConnectorsTab() {
  const [connectors, setConnectors] = useState([]);
  const [osmQuery, setOsmQuery] = useState("");
  const [osmLocation, setOsmLocation] = useState("");
  const [osmResult, setOsmResult] = useState(null);
  const [osmLoading, setOsmLoading] = useState(false);
  const [osmError, setOsmError] = useState(null);
  const [csvPreview, setCsvPreview] = useState(null);
  const [csvError, setCsvError] = useState(null);
  const [webSearchProvider, setWebSearchProvider] = useState("");
  const [webSearchStatus, setWebSearchStatus] = useState(null);
  const [webSearchChecking, setWebSearchChecking] = useState(false);

  useEffect(() => {
    async function loadConnectors() {
      try {
        const res = await fetch("/api/connectors", { headers: { Authorization: `Bearer ${localStorage.getItem("token")}` } });
        const d = await res.json();
        setConnectors(d.data || []);
      } catch (e) {
        console.error("Failed to load connectors", e);
      }
    }
    loadConnectors();
  }, []);

  async function api(path, opts = {}) {
    const token = localStorage.getItem("token");
    const headers = { "Content-Type": "application/json", ...opts.headers };
    if (token) headers["Authorization"] = `Bearer ${token}`;
    const res = await fetch(path, { ...opts, headers });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body.error || `Request failed: ${res.status}`);
    }
    return res.json();
  }

  async function checkWebSearchStatus() {
    setWebSearchChecking(true);
    try {
      const res = await api("/api/connectors/web_search/status", {
        method: "POST",
        body: JSON.stringify({ config: { provider: webSearchProvider } }),
      });
      setWebSearchStatus(res);
    } catch (e) {
      setWebSearchStatus({ status: "failed", message: e.message, error: e.code });
    } finally {
      setWebSearchChecking(false);
    }
  }

  async function runOsm() {
    setOsmLoading(true);
    setOsmError(null);
    setOsmResult(null);
    try {
      const res = await api("/api/connectors/osm/search", {
        method: "POST",
        body: JSON.stringify({ query: osmQuery, location: osmLocation, limit: 20 }),
      });
      setOsmResult(res);
    } catch (e) {
      setOsmError(e.message);
    } finally {
      setOsmLoading(false);
    }
  }

  async function previewCsv(file) {
    setCsvError(null);
    setCsvPreview(null);
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async () => {
      try {
        const base64 = reader.result.split(",")[1];
        const format = file.name.toLowerCase().endsWith(".xlsx") ? "xlsx" : "csv";
        const res = await api("/api/connectors/import/preview", {
          method: "POST",
          body: JSON.stringify({ content: base64, format }),
        });
        setCsvPreview({ ...res, format, base64 });
      } catch (e) {
        setCsvError(e.message);
      }
    };
    reader.readAsDataURL(file);
  }

  async function commitCsv() {
    if (!csvPreview) return;
    try {
      const res = await api("/api/connectors/import/commit", {
        method: "POST",
        body: JSON.stringify({ rows: csvPreview.accepted, source: { type: "csv_import" } }),
      });
      alert(`Imported ${res.inserted} new, ${res.updated} updated.`);
      setCsvPreview(null);
    } catch (e) {
      setCsvError(e.message);
    }
  }

  return (
    <div>
      <div className="panel">
        <h2>Available connectors</h2>
        <div className="ledger-wrap">
          <table className="ledger">
            <thead><tr><th>ID</th><th>Name</th><th>Capabilities</th><th>Status</th><th>Provider</th><th>Last Check</th></tr></thead>
            <tbody>
              {connectors.map((c) => (
                <tr key={c.id}>
                  <td className="mono">{c.id}</td>
                  <td>{c.name}</td>
                  <td>{(c.capabilities || []).join(", ")}</td>
                  <td>{statusBadge(c.status || (c.configured ? "configured" : "unconfigured"))}</td>
                  <td>{c.provider || (c.legacy ? "—" : "—")}</td>
                  <td>{c.lastCheck ? new Date(c.lastCheck).toLocaleString() : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="panel">
        <h2>OpenStreetMap discovery</h2>
        <p className="desc">Uses the public Nominatim service. Respect its usage policy; requests are rate-limited to one per second.</p>
        <div className="row">
          <div className="field" style={{ minWidth: 220 }}>
            <label>Business / category</label>
            <input type="text" value={osmQuery} onChange={(e) => setOsmQuery(e.target.value)} placeholder="e.g. bakeries" />
          </div>
          <div className="field" style={{ minWidth: 220 }}>
            <label>Location</label>
            <input type="text" value={osmLocation} onChange={(e) => setOsmLocation(e.target.value)} placeholder="e.g. Berlin" />
          </div>
          <div className="field">
            <label>&nbsp;</label>
            <button className="btn" onClick={runOsm} disabled={osmLoading}>{osmLoading ? "Searching…" : "Search OSM"}</button>
          </div>
        </div>
        {osmError && <p className="helper-text" style={{ color: "var(--web-no_website)" }}>{osmError}</p>}
        {osmResult && (
          <p className="helper-text">Found {osmResult.count} results — inserted {osmResult.inserted}, updated {osmResult.updated}.</p>
        )}
      </div>

      <div className="panel">
        <h2>CSV / Excel import</h2>
        <p className="desc">Upload a CSV or XLSX file. Preview errors before committing. Spreadsheet formulas are sanitized.</p>
        <input type="file" accept=".csv,.xlsx" onChange={(e) => { const f = e.target.files?.[0]; previewCsv(f); }} />
        {csvError && <p className="helper-text" style={{ color: "var(--web-no_website)" }}>{csvError}</p>}
        {csvPreview && (
          <div>
            <p className="helper-text">Rows: {csvPreview.totalRows} — accepted {csvPreview.acceptedCount}, rejected {csvPreview.rejectedCount}.</p>
            {csvPreview.errors?.length > 0 && (
              <ul className="helper-text">
                {csvPreview.errors.slice(0, 10).map((e, i) => <li key={i}>Row {e.row}: {e.reason}</li>)}
              </ul>
            )}
            <button className="btn" onClick={commitCsv} disabled={!csvPreview.acceptedCount}>Commit import</button>
          </div>
        )}
      </div>

      <div className="panel">
        <h2>Web search connector</h2>
        <p className="desc">Configure via request config or environment: WEB_SEARCH_PROVIDER (brave|bing|google_cse) and WEB_SEARCH_API_KEY. No fake results are returned when unconfigured.</p>
        <div className="row">
          <div className="field" style={{ minWidth: 200 }}>
            <label>Provider</label>
            <select value={webSearchProvider} onChange={(e) => setWebSearchProvider(e.target.value)}>
              <option value="">Select provider</option>
              <option value="brave">Brave Search</option>
              <option value="bing">Bing Search</option>
              <option value="google_cse">Google Custom Search</option>
            </select>
          </div>
          <div className="field">
            <label>&nbsp;</label>
            <button className="btn" onClick={checkWebSearchStatus} disabled={webSearchChecking || !webSearchProvider}>
              {webSearchChecking ? "Checking…" : "Check connection"}
            </button>
          </div>
        </div>
        {webSearchStatus && (
          <div style={{ marginTop: 12 }}>
            {statusBadge(webSearchStatus.status)}
            <span className="helper-text" style={{ marginLeft: 8 }}>
              {webSearchStatus.message || ""}
            </span>
            {webSearchStatus.error && <span className="mono" style={{ marginLeft: 8 }}>({webSearchStatus.error})</span>}
          </div>
        )}
      </div>
    </div>
  );
}
