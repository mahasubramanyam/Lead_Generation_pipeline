# Lead Pipeline

A full-stack CRM for finding Indian businesses without working websites. Scrapes Google Maps, checks website reachability, tracks pipeline status, and sends WhatsApp outreach — all from one interface.

**Live Demo:** [https://lead-pipeline.vercel.app](https://lead-pipeline.vercel.app)  
**Demo Credentials:** `demo@example.com` / `demopass123`

---

## Architecture

```
┌─────────────┐     ┌──────────────┐     ┌────────────┐
│   Vercel    │────▶│    Koyeb     │────▶│    Neon    │
│  (Frontend) │     │  (Backend)   │     │ (PostgreSQL)│
│  React/Vite │     │   Express    │     │   Free DB  │
└─────────────┘     └──────────────┘     └────────────┘
                           │
              ┌────────────┴────────────┐
              │  DEMO_MODE=true/false   │
              │  controls live features │
              └─────────────────────────┘
```

### Two Modes

| Feature | Local Production (`DEMO_MODE=false`) | Cloud Demo (`DEMO_MODE=true`) |
|---------|--------------------------------------|-------------------------------|
| Data source | Live Google Maps scraping (Puppeteer) | 500 pre-seeded realistic businesses |
| Website check | Real URL visit (Puppeteer) | Randomised realistic statuses |
| WhatsApp | Real WhatsApp Web automation | Mock responses, always "connected" |
| Scrape queue | BullMQ + Redis | Skipped entirely |
| Database | Local PostgreSQL (Docker) | Neon PostgreSQL (cloud) |
| Browser | Chrome (Puppeteer) | None required |
| Free to host? | No (needs Docker + Chrome) | Yes (no card needed) |

---

## Features

- **Google Maps Scraper** — Pulls business listings by location + category (local mode only)
- **Website Reachability Checker** — Visits each URL to detect working/broken/blocked (mock in demo)
- **Competitor Examples** — Shows similar local businesses with working websites as sales ammunition
- **CRM Ledger** — Infinite-scroll spreadsheet with search, filter, sort, pagination
- **Pipeline Tracking** — 6-stage pipeline: not contacted → contacted → interested → will talk later → not interested → completed
- **WhatsApp Outreach** — Select businesses, compose a template message, send with configurable delay (mock in demo)
- **CSV/XLSX Export** — Download filtered/sorted data at any time
- **JWT Authentication** — Register/login with token-based sessions
- **Swagger Docs** — Full API documentation at `/api-docs`
- **Responsive UI** — Works on desktop, tablet, and phone
- **Dark Mode Ready** — CSS custom properties throughout
- **Docker Deployment** — Dockerfile + docker-compose.yml for local production

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | React 18, Vite 5, vanilla CSS |
| Backend | Node.js 20, Express 4 |
| Database | PostgreSQL 15 (local) / Neon (cloud) |
| Queue | BullMQ + Redis (local only) |
| Scraping | Puppeteer (local only) |
| Auth | bcryptjs + jsonwebtoken |
| API Docs | swagger-ui-express |
| Export | PapaParse (CSV), xlsx (XLSX) |
| Deployment | Vercel (frontend) + Koyeb (backend) + Neon (DB) |

---

## Project Structure

```
lead-pipeline/
├── server.js           # Express backend + all routes + scraper
├── swagger.js          # OpenAPI 3.0.3 spec
├── seed-demo.js        # 500-business demo data generator
├── vercel.json         # Vercel deployment config
├── deploy.ps1          # One-command deployment script
├── Dockerfile          # Docker multi-stage build
├── docker-compose.yml  # Local production stack
├── .github/workflows/  # CI pipeline
├── src/                # React frontend
│   ├── App.jsx         # Main app component
│   └── style.css       # All styles
├── tests/              # Test suites
│   ├── helpers.test.js # 26 unit tests
│   ├── api.test.js     # 33 API tests
│   └── qa.test.js      # 71 QA tests
└── data/               # Runtime data directory
```

---

## Quick Start (Local Production)

```bash
# Prerequisites: Node 20+, Docker

# 1. Install dependencies
npm install

# 2. Start PostgreSQL + Redis
docker run -d --name pg-db -e POSTGRES_USER=user -e POSTGRES_PASSWORD=pass -e POSTGRES_DB=lead_pipeline -p 5432:5432 postgres:15-alpine
docker run -d --name redis-stack -p 6379:6379 redis:7-alpine

# 3. Start the server
npm run server

# 4. In another terminal, start the frontend
npm run dev
```

Open http://localhost:5173 — register an account, then scrape your first location.

---

## Quick Start (Cloud Demo)

```bash
# Prerequisites: Node 20+, Neon + Koyeb accounts (free, no card)

# 1. Set environment variables
$env:DEMO_MODE = "true"
$env:DATABASE_URL = "postgresql://..."  # From Neon dashboard
$env:JWT_SECRET = "any-random-string"

# 2. Install and start
npm install
npm run server
```

Open http://localhost:5000 — 500 sample businesses are seeded automatically.

---

## Deployment

See `deploy.ps1` for a one-command deployment script. It:

1. Creates a Neon PostgreSQL database
2. Deploys the backend to Koyeb
3. Deploys the frontend to Vercel
4. Connects everything with correct environment variables

**Required API tokens:**
- Neon: https://console.neon.tech/app/settings/api-keys
- Koyeb: https://app.koyeb.com/account/api
- Vercel: https://vercel.com/account/tokens

---

## Environment Variables

| Variable | Default | Local | Demo |
|----------|---------|-------|------|
| `PORT` | `5000` | `5000` | Set by Koyeb |
| `DATABASE_URL` | `postgresql://user:pass@localhost:5432/lead_pipeline` | Local PG | Neon URL |
| `REDIS_URL` | `redis://localhost:6379` | Local Redis | Not needed |
| `JWT_SECRET` | `lp-secret-change-in-production` | Any string | Any string |
| `ALLOW_NETWORK` | `false` | `false` | `true` |
| `DEMO_MODE` | `false` | `false` | `true` |
| `VITE_API_URL` | (empty) | Not needed | `https://your-app.koyeb.app` |

---

## Testing

```bash
npm test              # 26 unit tests (helpers)
npm run test:api      # 33 API integration tests
npm run test:all      # 59 tests (helpers + api)
node --test tests/qa.test.js  # 71 QA tests
```

**Total: 130 tests — all pass.**

---

## Full Local Version Features

These features are available only when running locally with `DEMO_MODE=false`:

- **Google Maps Scraping** — Launches Chrome via Puppeteer, navigates Google Maps search results, extracts name/phone/address/rating/website from each listing
- **Website Reachability** — Visits each business website with an 8-second timeout, classifies as Working / Broken / Blocked / No Website
- **WhatsApp Web Automation** — Opens a real WhatsApp Web session in a controlled browser, sends templated messages with randomised delays
- **BullMQ Job Queue** — Queues scrape jobs with Redis, provides real-time job status polling
- **Duplicate Detection** — Phone-based deduplication across scrape runs

---

## API

Full Swagger documentation at `/api-docs` when the server is running.

Key endpoints:

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/auth/register` | Create account |
| POST | `/api/auth/login` | Get JWT token |
| GET | `/api/auth/check` | Verify token |
| POST | `/api/scrape` | Start scrape (job in demo) |
| GET | `/api/scrape/status/:jobId` | Poll scrape status |
| POST | `/api/scrape/cancel` | Cancel running scrape |
| GET | `/api/businesses` | List businesses (paginated) |
| POST | `/api/businesses` | Create business(es) |
| PATCH | `/api/businesses/:id` | Update business fields |
| DELETE | `/api/businesses` | Delete businesses |
| POST | `/api/check-websites` | Check website statuses |
| GET | `/api/businesses/:id/competitor-examples` | Similar local websites |
| GET | `/api/stats` | Dashboard statistics |
| GET | `/api/config` | Read config |
| POST | `/api/config` | Write config |
| POST | `/api/wa/connect` | Connect WhatsApp |
| POST | `/api/wa/disconnect` | Disconnect WhatsApp |
| GET | `/api/wa/status` | WhatsApp connection status |
| POST | `/api/wa/send` | Send WhatsApp messages |
| POST | `/api/wa/pause` | Pause/resume send |
| POST | `/api/wa/stop` | Stop send |
| GET | `/api/send-log` | Message history |
| GET | `/api/pipeline-history` | Pipeline change log |

---

## License

MIT — built as a portfolio project.
