import React, { useState, useEffect, useCallback, useRef } from "react";
import Papa from "papaparse";
import * as XLSX from "xlsx";

const PIPELINE_STATUSES = [
  { key: "not_contacted", label: "Not Contacted", color: "var(--st-not_contacted)" },
  { key: "contacted", label: "Contacted", color: "var(--st-contacted)" },
  { key: "interested", label: "Interested", color: "var(--st-interested)" },
  { key: "will_talk_later", label: "Will Talk Later", color: "var(--st-will_talk_later)" },
  { key: "not_interested", label: "Not Interested", color: "var(--st-not_interested)" },
  { key: "completed", label: "Completed", color: "var(--st-completed)" },
];

const WEBSITE_STATUSES = {
  no_website: { label: "No Website", color: "var(--web-no_website)" },
  broken: { label: "Broken", color: "var(--web-broken)" },
  blocked: { label: "Blocked/Challenge", color: "var(--web-blocked)" },
  working: { label: "Working", color: "var(--web-working)" },
  unchecked: { label: "Unchecked", color: "var(--web-unchecked)" },
};

function statusMeta(key) {
  return PIPELINE_STATUSES.find(s => s.key === key) || PIPELINE_STATUSES[0];
}

const API_BASE = import.meta.env.VITE_API_URL || "";

async function api(path, opts = {}) {
  const token = localStorage.getItem("token");
  const headers = { "Content-Type": "application/json", ...opts.headers };
  if (token) headers["Authorization"] = `Bearer ${token}`;
  const res = await fetch(`${API_BASE}/api${path}`, { ...opts, headers });
  if (res.status === 401) {
    localStorage.removeItem("token");
    window.location.reload();
  }
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `Request failed: ${res.status}`);
  }
  return res.json();
}

function AuthPage() {
  const [mode, setMode] = useState("login");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  async function handleSubmit(e) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/auth/${mode}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: username.trim(), password }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Request failed");
      localStorage.setItem("token", data.token);
      window.location.reload();
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="auth-page">
      <div className="auth-card">
        <div className="auth-brand">
          <div className="auth-logo">LP</div>
          <h1>Lead Pipeline</h1>
          <p className="auth-desc">no-website &amp; broken-site business finder — India</p>
        </div>
        <form onSubmit={handleSubmit}>
          <div className="auth-field">
            <label htmlFor="auth-username">Username</label>
            <input id="auth-username" type="text" value={username} onChange={e => setUsername(e.target.value)} placeholder="Your username" autoFocus autoComplete="username" />
          </div>
          <div className="auth-field">
            <label htmlFor="auth-password">Password</label>
            <input id="auth-password" type="password" value={password} onChange={e => setPassword(e.target.value)} placeholder="Your password" autoComplete={mode === "login" ? "current-password" : "new-password"} />
          </div>
          {error && <p className="auth-error">{error}</p>}
          <button className="btn auth-submit" type="submit" disabled={loading}>
            {loading ? "Please wait…" : mode === "login" ? "Sign In" : "Create Account"}
          </button>
        </form>
        <div className="auth-switch">
          {mode === "login" ? (
            <span>Don&apos;t have an account? <button type="button" className="link-btn" onClick={() => { setMode("register"); setError(null); }}>Create one</button></span>
          ) : (
            <span>Already have an account? <button type="button" className="link-btn" onClick={() => { setMode("login"); setError(null); }}>Sign in</button></span>
          )}
        </div>
      </div>
    </div>
  );
}

export default function App() {
  const [authChecked, setAuthChecked] = useState(false);
  const [authenticated, setAuthenticated] = useState(false);
  const [user, setUser] = useState(null);
  const [demoMode, setDemoMode] = useState(false);

  useEffect(() => {
    const token = localStorage.getItem("token");
    if (!token) {
      setAuthChecked(true);
      setAuthenticated(false);
      return;
    }
    fetch(`${API_BASE}/api/auth/check`, {
      headers: { Authorization: `Bearer ${token}` },
    }).then(res => {
      if (!res.ok) { localStorage.removeItem("token"); setAuthenticated(false); return; }
      return res.json();
    }).then(data => {
      if (data?.valid) { setUser(data.user); setAuthenticated(true); setDemoMode(data.demoMode || false); }
    }).catch(() => {
      localStorage.removeItem("token");
      setAuthenticated(false);
    }).finally(() => setAuthChecked(true));
  }, []);

  if (!authChecked) return <div className="loading-page"><div className="spinner" /></div>;
  if (!authenticated) return <AuthPage />;

  return <AuthenticatedApp user={user} demoMode={demoMode} />;
}

function AuthenticatedApp({ user, demoMode }) {
  const [tab, setTab] = useState("scrape");
  const [selectedIds, setSelectedIds] = useState(new Set());

  return (
    <div className="app-shell">
      {demoMode && <div className="demo-banner">Demo Mode &mdash; Live scraping and WhatsApp are disabled.</div>}
      <header className="app-header">
        <div className="app-title">
          <span className="mark">LP</span>
          <h1>Lead Pipeline</h1>
          <span className="sub">no-website &amp; broken-site business finder — India</span>
        </div>
        <nav className="tabs">
          <button className={`tab-btn ${tab === "scrape" ? "active" : ""}`} onClick={() => setTab("scrape")}>Find Leads</button>
          <button className={`tab-btn ${tab === "leads" ? "active" : ""}`} onClick={() => setTab("leads")}>Ledger</button>
          <button className={`tab-btn ${tab === "whatsapp" ? "active" : ""}`} onClick={() => setTab("whatsapp")}>WhatsApp</button>
        </nav>
        <div className="user-info">
          <span className="user-badge">{user?.username}</span>
          <button className="btn logout-btn" onClick={() => { localStorage.removeItem("token"); window.location.reload(); }}>Logout</button>
        </div>
      </header>
      <main className="app-body">
        {tab === "scrape" && <ScrapeTab demoMode={demoMode} onDone={() => setTab("leads")} />}
        {tab === "leads" && <LeadsTab selectedIds={selectedIds} setSelectedIds={setSelectedIds} />}
        {tab === "whatsapp" && <WhatsAppTab selectedIds={selectedIds} setSelectedIds={setSelectedIds} />}
      </main>
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════
   FIND LEADS — scrape Google Maps for a location + categories
   ══════════════════════════════════════════════════════════════ */
function ScrapeTab({ onDone, demoMode }) {
  const [location, setLocation] = useState(demoMode ? "Bangalore" : "");
  const [categoryInput, setCategoryInput] = useState("");
  const [categories, setCategories] = useState([]);
  const [maxPerQuery, setMaxPerQuery] = useState(20);
  const [headless, setHeadless] = useState(true);
  const [loading, setLoading] = useState(false);
  const [polling, setPolling] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);
  const jobIdRef = useRef(null);
  const pollRef = useRef(null);

  useEffect(() => {
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, []);

  function addCategory() {
    const c = categoryInput.trim();
    if (c && !categories.includes(c)) setCategories([...categories, c]);
    setCategoryInput("");
  }

  async function cancelScrape() {
    if (pollRef.current) clearInterval(pollRef.current);
    pollRef.current = null;
    setPolling(false);
    setLoading(false);
    setError("Scrape cancelled.");
    await api("/scrape/cancel", { method: "POST" }).catch(() => {});
  }

  async function runScrape() {
    if (!location.trim() || categories.length === 0) {
      setError("Enter a location and at least one business category.");
      return;
    }
    setLoading(true);
    setPolling(false);
    setError(null);
    setResult(null);
    try {
      const res = await api("/scrape", {
        method: "POST",
        body: JSON.stringify({ location: location.trim(), categories, maxPerQuery: Number(maxPerQuery), headless }),
      });
      const jobId = res.jobId;
      jobIdRef.current = jobId;
      setPolling(true);
      pollRef.current = setInterval(async () => {
        try {
          const status = await api(`/scrape/status/${jobId}`);
          if (status.state === "completed") {
            setResult(status.result);
            setPolling(false);
            setLoading(false);
            if (pollRef.current) clearInterval(pollRef.current);
            pollRef.current = null;
          } else if (status.state === "failed") {
            setError(status.error || "Scrape failed");
            setPolling(false);
            setLoading(false);
            if (pollRef.current) clearInterval(pollRef.current);
            pollRef.current = null;
          }
        } catch (e) {
          setError(e.message);
          setPolling(false);
          setLoading(false);
          if (pollRef.current) clearInterval(pollRef.current);
          pollRef.current = null;
        }
      }, 2000);
    } catch (e) {
      setError(e.message);
      setLoading(false);
    }
  }

  return (
    <div>
      <div className="panel">
        <h2>Find businesses in any Indian location</h2>
        <p className="desc">
          P{demoMode ? "rovides sample " : "ulls real listings from Google Maps for the location and categories you give it — "}
          name, category, address, phone, rating, and whether they have a website at all.
          {demoMode ? "  Data shown is for demo purposes." : "  Nothing here is generated; every row is a live scrape result."}
        </p>

        <div className="row">
          <div className="field" style={{ minWidth: 260 }}>
            <label>Location (city, town, or area — anywhere in India)</label>
            <input
              type="text" value={location} onChange={e => setLocation(e.target.value)}
              placeholder="e.g. Ambur, Tamil Nadu"
            />
          </div>
          <div className="field" style={{ minWidth: 220 }}>
            <label>Business category</label>
            <input
              type="text" value={categoryInput}
              onChange={e => setCategoryInput(e.target.value)}
              onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); addCategory(); } }}
              placeholder="e.g. bakeries — press Enter"
            />
          </div>
          <div className="field" style={{ width: 130 }}>
            <label>Max per category</label>
            <input type="number" min="5" max="100" value={maxPerQuery} onChange={e => setMaxPerQuery(e.target.value)} />
          </div>
          <div className="field">
            <label>&nbsp;</label>
            <button className="btn secondary" onClick={addCategory} type="button">Add category</button>
          </div>
        </div>

        {categories.length > 0 && (
          <div className="row" style={{ marginTop: 12 }}>
            {categories.map(c => (
              <span className="category-chip" key={c}>
                {c}
                <button onClick={() => setCategories(categories.filter(x => x !== c))}>×</button>
              </span>
            ))}
          </div>
        )}

        <div className="row" style={{ marginTop: 16, alignItems: "center" }}>
          <label style={{ fontSize: 13, display: "flex", gap: 6, alignItems: "center" }}>
            <input type="checkbox" checked={headless} onChange={e => setHeadless(e.target.checked)} />
            Run browser in background (headless)
          </label>
          <button className="btn" onClick={runScrape} disabled={loading || polling}>
            {loading || polling ? <span className="spinner" /> : null} {loading || polling ? (polling ? "Running…" : "Scraping…") : (demoMode ? "Generate sample businesses" : "Scrape Google Maps")}
          </button>
          {(loading || polling) && <button className="btn danger" onClick={cancelScrape} type="button">Cancel scrape</button>}
        </div>

        {error && <p className="helper-text" style={{ color: "var(--web-no_website)" }}>{error}</p>}

        {(loading || polling) && (
          <p className="helper-text">
            {demoMode
              ? "Generating sample businesses for the requested location and categories. Feel free to switch to the Ledger tab."
              : "This opens a real browser and visits each listing individually to pull phone numbers reliably — budget roughly 15–25 seconds per business. Feel free to switch to the Ledger tab; results land in the database as they're found."}
          </p>
        )}

        {result && (
          <div className="qr-hint">
            Scraped/updated <strong>{result.count}</strong> businesses for "{location}"{result.cancelled ? " before cancellation" : ""}.
            {typeof result.inserted === "number" && <> Inserted {result.inserted}, updated {result.updated}.</>}
            {result.pendingWebsiteChecks > 0 && (
              <> Checking reachability on {result.pendingWebsiteChecks} listed websites in the background — statuses
              will update in the Ledger within a minute or two.</>
            )}
            {" "}
            <button className="btn sm secondary" style={{ marginLeft: 8 }} onClick={onDone}>Open Ledger →</button>
          </div>
        )}
      </div>

      <div className="panel">
        <h2>How "no website / broken website" is decided</h2>
        <p className="desc" style={{ marginBottom: 0 }}>
          Every listing without a website link on Google Maps is tagged <strong>No Website</strong> immediately.
          Listings that do list a website get an automatic reachability check with one retry and an 8s timeout.
          Website checks run with limited concurrency, and obvious bot-challenge pages are tagged <strong>Blocked/Challenge</strong> instead of Working.
          You can re-run this check any time from the Ledger tab.
        </p>
      </div>
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════
   LEDGER — the spreadsheet-style CRM checklist
   ══════════════════════════════════════════════════════════════ */
function LeadsTab({ selectedIds, setSelectedIds }) {
  const [rows, setRows] = useState([]);
  const [totalRows, setTotalRows] = useState(0);
  const [stats, setStats] = useState(null);
  const [search, setSearch] = useState("");
  const [websiteFilter, setWebsiteFilter] = useState("");
  const [pipelineFilter, setPipelineFilter] = useState("");
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [checking, setChecking] = useState(false);
  const [examplePanel, setExamplePanel] = useState(null);
  const [exampleLoading, setExampleLoading] = useState(false);
  const pageRef = useRef(1);
  const loadingMoreRef = useRef(false);
  const pageSize = 100;
  const debounceRef = useRef(null);
  const sentinelRef = useRef(null);
  const hasMore = rows.length < totalRows;

  const loadPage = useCallback(async (pageNum, append) => {
    const params = new URLSearchParams();
    if (search) params.set("search", search);
    if (websiteFilter) params.set("website_status", websiteFilter);
    if (pipelineFilter) params.set("pipeline_status", pipelineFilter);
    params.set("page", pageNum);
    params.set("pageSize", pageSize);
    const [result, statData] = await Promise.all([
      api(`/businesses?${params.toString()}`),
      append ? Promise.resolve(null) : api("/stats"),
    ]);
    const newRows = result.data || result;
    setRows(prev => append ? [...prev, ...newRows] : newRows);
    setTotalRows(result.total ?? 0);
    if (statData) setStats(statData);
  }, [search, websiteFilter, pipelineFilter]);

  // Reset + load on filter change
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    setLoading(true);
    pageRef.current = 1;
    debounceRef.current = setTimeout(async () => {
      await loadPage(1, false);
      setLoading(false);
    }, 300);
    return () => clearTimeout(debounceRef.current);
  }, [loadPage]);

  // Infinite scroll — load next page when sentinel enters viewport
  useEffect(() => {
    const el = sentinelRef.current;
    if (!el) return;
    const observer = new IntersectionObserver(entries => {
      if (entries[0].isIntersecting && hasMore && !loadingMoreRef.current && !loading) {
        loadingMoreRef.current = true;
        setLoadingMore(true);
        pageRef.current += 1;
        loadPage(pageRef.current, true).finally(() => {
          loadingMoreRef.current = false;
          setLoadingMore(false);
        });
      }
    }, { rootMargin: "400px" });
    observer.observe(el);
    return () => observer.disconnect();
  }, [hasMore, loading, loadPage]);

  function handleSearchChange(v) {
    setSearch(v);
  }

  async function updateField(id, field, value) {
    setRows(prev => prev.map(r => r.id === id ? { ...r, [field]: value } : r));
    await api(`/businesses/${id}`, { method: "PATCH", body: JSON.stringify({ [field]: value }) });
  }

  function toggleSelect(id) {
    const next = new Set(selectedIds);
    if (next.has(id)) next.delete(id); else next.add(id);
    setSelectedIds(next);
  }

  function toggleSelectAll() {
    if (selectedIds.size === rows.length) setSelectedIds(new Set());
    else setSelectedIds(new Set(rows.map(r => r.id)));
  }

  async function checkWebsites(ids) {
    setChecking(true);
    try {
      await api("/check-websites", { method: "POST", body: JSON.stringify({ ids }) });
      pageRef.current = 1;
      setLoading(true);
      await loadPage(1, false);
      setLoading(false);
    } finally {
      setChecking(false);
    }
  }

  async function deleteSelected() {
    if (!selectedIds.size) return;
    if (!confirm(`Delete ${selectedIds.size} selected business(es)? This can't be undone.`)) return;
    await api("/businesses", { method: "DELETE", body: JSON.stringify({ ids: [...selectedIds] }) });
    setSelectedIds(new Set());
    pageRef.current = 1;
    setLoading(true);
    await loadPage(1, false);
    setLoading(false);
  }


  async function showCompetitorExamples(row) {
    setExampleLoading(true);
    setExamplePanel({ target: row, examples: [] });
    try {
      const data = await api(`/businesses/${row.id}/competitor-examples`);
      setExamplePanel(data);
    } catch (e) {
      setExamplePanel({ target: row, examples: [], error: e.message });
    } finally {
      setExampleLoading(false);
    }
  }

  async function exportData(format) {
    const params = new URLSearchParams();
    if (search) params.set("search", search);
    if (websiteFilter) params.set("website_status", websiteFilter);
    if (pipelineFilter) params.set("pipeline_status", pipelineFilter);
    params.set("page", 1); params.set("pageSize", 100000);
    const result = await api(`/businesses?${params.toString()}`);
    const allRows = result.data || result;
    const data = allRows.map(r => ({
      Name: r.name, Category: r.category, Address: r.address, City: r.city,
      Phone: r.phone, Rating: r.rating, Reviews: r.reviews,
      Website: r.website_url, "Website Status": WEBSITE_STATUSES[r.website_status]?.label || r.website_status,
      "Pipeline Status": statusMeta(r.pipeline_status).label, Notes: r.notes,
      "Scraped On": r.scraped_on,
    }));
    if (format === "csv") {
      const csv = Papa.unparse(data);
      const blob = new Blob([csv], { type: "text/csv" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url; a.download = "lead-pipeline.csv"; a.click();
      URL.revokeObjectURL(url);
    } else {
      const ws = XLSX.utils.json_to_sheet(data);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, "Leads");
      XLSX.writeFile(wb, "lead-pipeline.xlsx");
    }
  }

  return (
    <div>
      {stats && (
        <div className="stat-strip">
          <div className="stat-card"><div className="num">{stats.total}</div><div className="label">Total leads</div></div>
          <div className="stat-card"><div className="num">{stats.noWebsite}</div><div className="label">No website</div></div>
          <div className="stat-card"><div className="num">{stats.broken}</div><div className="label">Broken website</div></div>
          {PIPELINE_STATUSES.slice(1).map(s => {
            const found = stats.byPipeline.find(p => p.pipeline_status === s.key);
            return (
              <div className="stat-card" key={s.key}>
                <div className="num" style={{ color: s.color }}>{found ? found.n : 0}</div>
                <div className="label">{s.label}</div>
              </div>
            );
          })}
        </div>
      )}

      {examplePanel && (
        <div className="panel examples-panel">
          <div className="examples-head">
            <div>
              <h2>Similar local websites for {examplePanel.target?.name}</h2>
              <p className="desc">Use these as proof while pitching: “similar businesses nearby already have websites, so customers may compare you online.”</p>
            </div>
            <button className="btn secondary sm" onClick={() => setExamplePanel(null)}>Close</button>
          </div>
          {exampleLoading ? (
            <div className="empty-state">Finding similar local website examples…</div>
          ) : examplePanel.error ? (
            <p className="helper-text" style={{ color: "var(--web-no_website)" }}>{examplePanel.error}</p>
          ) : examplePanel.examples.length === 0 ? (
            <div className="empty-state">No working website examples found yet in this ledger for the same locality/category. Scrape a few more nearby businesses first.</div>
          ) : (
            <div className="examples-grid">
              {examplePanel.examples.map(ex => (
                <div className="example-card" key={ex.id}>
                  <div className="example-title">{ex.name}</div>
                  <div className="example-meta">{ex.category || "Similar business"} · {ex.city || "same locality"}</div>
                  <div className="example-address" title={ex.address}>{ex.address || "Address not available"}</div>
                  <div className="row" style={{ marginTop: 10, alignItems: "center" }}>
                    <span className="mono small-muted">{ex.rating ? `${ex.rating}★ (${ex.reviews || 0})` : "No rating"}</span>
                    <a className="btn secondary sm" href={ex.website_url} target="_blank" rel="noreferrer">Open website</a>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      <div className="panel">
        <div className="top-actions">
          <div className="row" style={{ marginBottom: 0 }}>
            <input
              className="search-box" type="text" placeholder="Search name, phone, category, address…"
              value={search} onChange={e => handleSearchChange(e.target.value)}
            />
            <select value={websiteFilter} onChange={e => setWebsiteFilter(e.target.value)}>
              <option value="">All website statuses</option>
              {Object.entries(WEBSITE_STATUSES).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
            </select>
            <select value={pipelineFilter} onChange={e => setPipelineFilter(e.target.value)}>
              <option value="">All pipeline statuses</option>
              {PIPELINE_STATUSES.map(s => <option key={s.key} value={s.key}>{s.label}</option>)}
            </select>
          </div>
          <div className="row" style={{ marginBottom: 0 }}>
            <button className="btn secondary sm" onClick={() => checkWebsites(null)} disabled={checking}>
              {checking ? "Checking…" : "Re-check unchecked sites"}
            </button>
            <button className="btn secondary sm" onClick={() => exportData("csv")}>Export CSV</button>
            <button className="btn secondary sm" onClick={() => exportData("xlsx")}>Export XLSX</button>
          </div>
        </div>

        {selectedIds.size > 0 && (
          <div className="selection-bar">
            <span>{selectedIds.size} selected</span>
            <button className="btn secondary" onClick={() => checkWebsites([...selectedIds])}>Check websites</button>
            <button className="btn danger" onClick={deleteSelected}>Delete</button>
            <button className="btn secondary" onClick={() => setSelectedIds(new Set())}>Clear selection</button>
          </div>
        )}

        <div className="ledger-wrap">
          {loading ? (
            <div className="empty-state">Loading ledger…</div>
          ) : rows.length === 0 ? (
            <div className="empty-state">No leads yet. Go to <strong>Find Leads</strong> to scrape a location.</div>
          ) : (
            <table className="ledger">
              <thead>
                <tr>
                  <th><input type="checkbox" checked={selectedIds.size === rows.length && rows.length > 0} onChange={toggleSelectAll} /></th>
                  <th>#</th>
                  <th>Business</th>
                  <th>Category</th>
                  <th>Address</th>
                  <th>Phone</th>
                  <th>Rating</th>
                  <th>Website</th>
                  <th>Similar Websites</th>
                  <th>Last Checked</th>
                  <th>Pipeline Status</th>
                  <th>Status Updated</th>
                  <th>Notes</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => {
                  const ws = WEBSITE_STATUSES[r.website_status] || WEBSITE_STATUSES.unchecked;
                  const ps = statusMeta(r.pipeline_status);
                  return (
                    <tr key={r.id}>
                      <td><input type="checkbox" checked={selectedIds.has(r.id)} onChange={() => toggleSelect(r.id)} /></td>
                      <td className="idx-cell">{i + 1}</td>
                      <td style={{ fontWeight: 600 }}>{r.name}</td>
                      <td>{r.category}</td>
                      <td className="mono" style={{ maxWidth: 220, overflow: "hidden", textOverflow: "ellipsis" }} title={r.address}>{r.address}</td>
                      <td className="mono">{r.phone || "—"}</td>
                      <td className="mono">{r.rating ? `${r.rating}★ (${r.reviews || 0})` : "—"}</td>
                      <td>
                        <span className="pill" style={{ background: ws.color }}>{ws.label}</span>
                        {r.website_url && (
                          <a href={r.website_url} target="_blank" rel="noreferrer" style={{ marginLeft: 6, fontSize: 11 }}>visit</a>
                        )}
                      </td>
                      <td>
                        {!["working", "unchecked"].includes(r.website_status) ? (
                          <button className="btn secondary sm" onClick={() => showCompetitorExamples(r)}>View examples</button>
                        ) : (
                          <span className="small-muted">—</span>
                        )}
                      </td>
                      <td className="mono">{r.website_checked_at ? new Date(r.website_checked_at).toLocaleString() : "—"}</td>
                      <td>
                        <select
                          className="status-select" style={{ background: ps.color }}
                          value={r.pipeline_status}
                          onChange={e => updateField(r.id, "pipeline_status", e.target.value)}
                        >
                          {PIPELINE_STATUSES.map(s => <option key={s.key} value={s.key}>{s.label}</option>)}
                        </select>
                      </td>
                      <td className="mono">{r.pipeline_updated_at ? new Date(r.pipeline_updated_at).toLocaleString() : "—"}</td>
                      <td>
                        <input
                          className="editable-cell notes-input" defaultValue={r.notes}
                          placeholder="Add a note…"
                          onBlur={e => { if (e.target.value !== r.notes) updateField(r.id, "notes", e.target.value); }}
                        />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
          <div ref={sentinelRef} style={{ height: 1 }} />
          {loadingMore && (
            <div className="row" style={{ justifyContent: "center", marginTop: 12 }}>
              <span className="helper-text"><span className="spinner" /> Loading more…</span>
            </div>
          )}
          {!hasMore && rows.length > 0 && (
            <p className="helper-text" style={{ textAlign: "center", marginTop: 12 }}>
              Showing all {totalRows} result{totalRows === 1 ? "" : "s"}.
            </p>
          )}
      </div>
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════
   WHATSAPP — connect, compose, send to the selected ledger rows
   ══════════════════════════════════════════════════════════════ */
function WhatsAppTab({ selectedIds, setSelectedIds }) {
  const [status, setStatus] = useState("disconnected");
  const [sendState, setSendState] = useState(null);
  const [message, setMessage] = useState(
    "Hi {name}! I noticed your business doesn't have a website yet (or it isn't loading). " +
    "I build simple, affordable websites for local businesses like yours — would you be open to a quick chat about it?"
  );
  const [delaySeconds, setDelaySeconds] = useState(60);
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState(null);
  const [targets, setTargets] = useState([]);
  const [log, setLog] = useState([]);
  const pollRef = useRef(null);

  useEffect(() => {
    if (selectedIds.size === 0) { setTargets([]); return; }
    (async () => {
      const all = await api("/businesses");
      const seenPhones = new Set();
      const uniqueTargets = [];
      for (const b of all.filter(b => selectedIds.has(b.id) && b.phone)) {
        const phoneKey = String(b.phone || "").replace(/\D/g, "");
        if (phoneKey && seenPhones.has(phoneKey)) continue;
        if (phoneKey) seenPhones.add(phoneKey);
        uniqueTargets.push(b);
      }
      setTargets(uniqueTargets);
    })();
  }, [selectedIds]);

  const refreshStatus = useCallback(async () => {
    try {
      const s = await api("/wa/status");
      setStatus(s.status);
      setSendState(s.sendState);
    } catch {}
  }, []);

  useEffect(() => {
    refreshStatus();
    pollRef.current = setInterval(refreshStatus, 2500);
    return () => clearInterval(pollRef.current);
  }, [refreshStatus]);

  useEffect(() => {
    api("/send-log").then(setLog).catch(() => {});
  }, [sendState?.running]);

  async function connect() {
    setConnecting(true);
    setError(null);
    try {
      await api("/wa/connect", { method: "POST" });
      refreshStatus();
    } catch (e) {
      setError(e.message);
    } finally {
      setConnecting(false);
    }
  }

  async function disconnect() {
    await api("/wa/disconnect", { method: "POST" });
    refreshStatus();
  }

  async function startSend() {
    setError(null);
    if (!confirm(`You're about to message ${targets.length} business(es). Continue?`)) return;
    try {
      await api("/wa/send", {
        method: "POST",
        body: JSON.stringify({ businesses: targets, message, delaySeconds: Number(delaySeconds) }),
      });
      refreshStatus();
    } catch (e) {
      setError(e.message);
    }
  }

  async function pauseResume() {
    await api("/wa/pause", { method: "POST" });
    refreshStatus();
  }

  async function stopSend() {
    await api("/wa/stop", { method: "POST" });
    refreshStatus();
  }

  const statusMap = {
    disconnected: { label: "Disconnected", color: "var(--web-no_website)" },
    connecting: { label: "Connecting…", color: "var(--st-will_talk_later)" },
    qr_ready: { label: "Scan the QR code in the opened browser window", color: "var(--st-will_talk_later)" },
    connected: { label: "Connected", color: "var(--web-working)" },
  };
  const sMeta = statusMap[status] || statusMap.disconnected;

  return (
    <div>
      <div className="panel">
        <h2>WhatsApp connection</h2>
        <p className="desc">Uses your real WhatsApp Web session (via a controlled browser). Scan once — the session is saved locally for next time.</p>
        <div className="row" style={{ alignItems: "center" }}>
          <span className="badge-status" style={{ background: "#f4f3ee", color: sMeta.color }}>
            <span className="badge-dot" style={{ background: sMeta.color }} /> {sMeta.label}
          </span>
          {status === "disconnected" && <button className="btn" onClick={connect} disabled={connecting}>{connecting ? "Opening…" : "Connect WhatsApp"}</button>}
          {status !== "disconnected" && <button className="btn secondary" onClick={disconnect}>Disconnect</button>}
        </div>
        {error && <p className="helper-text" style={{ color: "var(--web-no_website)" }}>{error}</p>}
      </div>

      <div className="panel">
        <h2>Compose outreach message</h2>
        <p className="desc">Use <code>{"{name}"}</code> and <code>{"{category}"}</code> — they're filled in per business automatically.</p>
        <div className="template-box">
          <textarea value={message} onChange={e => setMessage(e.target.value)} />
        </div>
        <div className="row" style={{ marginTop: 12, alignItems: "center" }}>
          <div className="field" style={{ width: 160 }}>
            <label>Delay between sends (seconds)</label>
            <input type="number" min="30" value={delaySeconds} onChange={e => setDelaySeconds(e.target.value)} />
          </div>
        </div>
        <p className="helper-text">A randomized delay is added on top of this automatically to avoid a robotic sending pattern. Longer delays are safer for your account.</p>
      </div>

      <div className="panel">
        <h2>Send queue — {targets.length} business{targets.length === 1 ? "" : "es"} selected from the Ledger</h2>
        {targets.length === 0 ? (
          <p className="desc">Go to the Ledger tab, tick the checkboxes next to the businesses you want to message, then come back here.</p>
        ) : (
          <>
            <div className="ledger-wrap" style={{ maxHeight: 220, overflowY: "auto" }}>
              <table className="ledger">
                <thead><tr><th>#</th><th>Business</th><th>Phone</th><th>Category</th></tr></thead>
                <tbody>
                  {targets.map((t, i) => (
                    <tr key={t.id}><td className="idx-cell">{i + 1}</td><td>{t.name}</td><td className="mono">{t.phone}</td><td>{t.category}</td></tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="row" style={{ marginTop: 14 }}>
              {!sendState?.running && (
                <button className="btn" onClick={startSend} disabled={status !== "connected"}>
                  Send to {targets.length} business{targets.length === 1 ? "" : "es"}
                </button>
              )}
              {sendState?.running && (
                <>
                  <button className="btn secondary" onClick={pauseResume}>{sendState.paused ? "Resume" : "Pause"}</button>
                  <button className="btn danger" onClick={stopSend}>Stop</button>
                </>
              )}
              <button className="btn secondary" onClick={() => setSelectedIds(new Set())}>Clear queue</button>
            </div>

            {sendState?.running && (
              <p className="helper-text">
                Sending {sendState.index} / {sendState.total} — {sendState.sentCount} sent, {sendState.failCount} failed
                {sendState.paused ? " (paused)" : ""}.
              </p>
            )}
          </>
        )}
      </div>

      <div className="panel">
        <h2>Recent activity</h2>
        <div className="ledger-wrap" style={{ maxHeight: 260, overflowY: "auto" }}>
          {log.length === 0 ? (
            <div className="empty-state">No messages sent yet.</div>
          ) : (
            <table className="ledger">
              <thead><tr><th>Business</th><th>Phone</th><th>Status</th><th>Reason</th><th>Time</th></tr></thead>
              <tbody>
                {log.map(l => (
                  <tr key={l.id}>
                    <td>{l.business_name}</td>
                    <td className="mono">{l.phone}</td>
                    <td>
                      <span className="pill" style={{ background: l.status === "sent" ? "var(--web-working)" : l.status === "skipped" ? "var(--st-not_contacted)" : "var(--web-no_website)" }}>
                        {l.status}
                      </span>
                    </td>
                    <td>{l.reason}</td>
                    <td className="mono">{l.sent_at}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}
