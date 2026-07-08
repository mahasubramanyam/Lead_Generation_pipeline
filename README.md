# Lead Pipeline — No-Website Business Finder (India)

A full-stack tool to find real businesses anywhere in India that have **no website or a broken
website**, track outreach against them in a spreadsheet-style checklist, and message them over
**WhatsApp** — all from one dashboard.

Built as a leaner, more focused version of the earlier `wa-pipeline` project: same real Google
Maps scraping and WhatsApp automation, but retargeted around a website-health check and a proper
CRM checklist instead of a generic dashboard. The Python scripts workflow and the AI message
builder have been removed — everything now runs from the app itself.

## What changed from the sample project

| | Sample (`wa-pipeline`) | This project |
|---|---|---|
| Scraper | Skipped any business that already had a website | Captures **every** business, then checks if the listed website actually loads |
| Website check | None | Automatic reachability check → `No Website` / `Broken` / `Working` |
| CRM | Free-text `crm_status` + reply log | Fixed checklist: Not Contacted → Contacted → Interested / Will Talk Later / Not Interested → Completed |
| Interface | Card-based dashboard | Spreadsheet/ledger table — inline-editable, exportable |
| Message builder | Claude API call | Simple local template with `{name}` / `{category}` placeholders — no API key needed |
| Python scripts tab | Downloadable `scraper.py` + `sender.py` | Removed — the app sends directly, no separate scripts to run |
| Location scope | Single hardcoded flow | Any city/town/area in India, typed in at scrape time |

## Features

- 🗺️ **Google Maps scraper** — real listings for any Indian location + business category you type in
- 🔍 **Website health check** — flags `No Website`, `Broken`, or `Working` per business (HTTP check with timeout, not a guess)
- 📋 **Spreadsheet checklist (Ledger)** — inline-editable table: pipeline status dropdown (Not Contacted / Contacted / Interested / Will Talk Later / Not Interested / Completed), notes column, bulk select, bulk delete, bulk re-check websites
- 📤 **CSV / XLSX export** of the full ledger, filtered or not
- 💬 **WhatsApp outreach** — connect once (QR scan, session persists locally), compose a template message, select rows from the Ledger, send with jittered delays, pause/resume/stop mid-run
- 💾 **SQLite persistence** — everything survives restarts

## Quick Start

```bash
npm install
npm start
```

This runs the backend on `http://localhost:5000` and the frontend on `http://localhost:5173`.

Or separately:
```bash
node server.js     # backend
npm run dev         # frontend
```

## Using it

1. **Find Leads** — type a location (e.g. "Ambur, Tamil Nadu" or "Koramangala, Bengaluru"), add
   one or more business categories (e.g. "bakeries", "salons"), and scrape. Real listings land in
   the Ledger as they're found; website checks for anything with a listed site run in the
   background right after.
2. **Ledger** — this is your spreadsheet. Filter by website status or pipeline status, tick
   checkboxes to select rows, set each business's pipeline status from the dropdown, and jot notes
   inline. Export to CSV/XLSX any time.
3. **WhatsApp** — connect (scan the QR code once — the session is saved to `data/wa_session` and
   reused after that), write your outreach message, select rows in the Ledger, then come back here
   to send. Sends are paced with a randomized delay and can be paused or stopped mid-run.

## Database

`data/pipeline.db` (SQLite):
- `businesses` — every scraped lead, with `website_status` and `pipeline_status` for the checklist
- `send_log` — WhatsApp send history
- `config` — misc app settings

## API Endpoints

| Method | Path | Description |
|---|---|---|
| GET | /api/businesses | List businesses (filter by `search`, `website_status`, `pipeline_status`, `city`) |
| POST | /api/businesses | Add businesses |
| PATCH | /api/businesses/:id | Update a business (status, notes, etc.) |
| DELETE | /api/businesses | Delete businesses |
| GET | /api/stats | Ledger stats |
| POST | /api/scrape | Scrape Google Maps for `location` + `categories` |
| POST | /api/check-websites | Re-check reachability for given `ids` (or all unchecked) |
| POST | /api/wa/connect | Launch WhatsApp Web session (QR on first run) |
| GET | /api/wa/status | Connection + send-queue status |
| POST | /api/wa/disconnect | Close the WhatsApp session |
| POST | /api/wa/send | Start a send campaign |
| POST | /api/wa/pause | Pause/resume the running campaign |
| POST | /api/wa/stop | Stop the running campaign |
| GET | /api/send-log | WhatsApp send history |

## Tech Stack

- **Frontend**: React 18 + Vite, plain CSS (no framework)
- **Backend**: Express.js + better-sqlite3
- **Scraper**: Puppeteer (Chromium) against Google Maps
- **Website check**: native `fetch` with an 8s timeout
- **WhatsApp**: Puppeteer driving `web.whatsapp.com` directly (no third-party WhatsApp API)
- **Export**: PapaParse (CSV) + SheetJS (XLSX)

## Important notes

- **Don't commit or share `data/wa_session/`.** It's a real logged-in WhatsApp Web browser
  profile — anyone with that folder can act as your WhatsApp account. Keep it out of zips, repos,
  and shared drives (it's already excluded via `.gitignore`).
- Automated WhatsApp sending is against WhatsApp's Terms of Service at scale. The jittered delay
  helps avoid obvious bot patterns, but heavy volume still carries a real risk of the number being
  flagged or banned — pace accordingly.
- Google Maps' DOM changes periodically; if scraping stops returning results, the CSS selectors in
  `server.js` (`/api/scrape`) are the first place to check.
- No authentication on the API — this is built for local, single-user use. Don't expose it
  directly to the internet without adding auth first.
