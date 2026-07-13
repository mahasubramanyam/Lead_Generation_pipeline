# Lead Pipeline — Portfolio Project Summary

Full-stack CRM for Indian web agencies to find, qualify, and contact local businesses without working websites. Deployed as a free cloud demo.

**Live URL:** https://lead-pipeline.vercel.app  
**GitHub:** https://github.com/mahasubramanyam/Lead_Generation_pipeline  
**Tech Stack:** React 18, Vite 5, Node.js 20, Express 4, PostgreSQL, Puppeteer, BullMQ, Redis, JWT, Swagger

---

## Project Highlights

### Dual-Mode Architecture (`DEMO_MODE` flag)
One codebase, two modes. A single environment variable controls whether the app runs as a full production system (with live scraping, Redis queues, WhatsApp automation) or as a free cloud demo (with mock data, no external dependencies). This avoids maintaining separate codebases for development vs. production.

### Google Maps Automation (Production Mode)
Headless Chrome via Puppeteer navigates Google Maps search results, scrolls to load all listings, and extracts name, phone, address, rating, review count, and website for each business. Runs as a BullMQ background job with real-time progress polling.

### Website Reachability Checker
Each business URL is visited programmatically (8s timeout) to determine if the site is: Working (200), Broken (error/404), Blocked (Cloudflare/captcha/detected as bot), or No Website. Provides competitor examples for businesses without working sites.

### WhatsApp Web Automation (Production Mode)
Opens a real WhatsApp Web session in a controlled browser. Users select businesses, write a template message, and messages are sent with randomised delays (3–9 seconds) to avoid being flagged. Includes pause/stop/resume controls and a full send log.

### CRM Ledger
Infinite-scroll table with search, filter by pipeline status / website status, sort by any column, pagination, and CSV/XLSX export. Tracks 6 pipeline stages with full history.

### API Design
RESTful API with JWT authentication, rate limiting (`express-rate-limit`), request validation, pagination, and full Swagger/OpenAPI 3.0.3 documentation at `/api-docs`.

### Testing
Three test suites totalling 130 tests: 26 unit tests (helpers), 33 API integration tests, and 71 comprehensive QA tests covering auth, edge cases, business CRUD, deduplication, website checker, stats, WhatsApp safeguards, config, competitor examples, and performance.

### Deployment
One-command deployment script (`deploy.ps1`) that provisions a Neon PostgreSQL database, deploys the Express backend to Koyeb, and deploys the Vite frontend to Vercel — all using free tiers with no credit card required.

---

## Skills Demonstrated

| Skill | Evidence |
|-------|----------|
| **Full-Stack Engineering** | React frontend + Express backend + PostgreSQL database |
| **Web Scraping / Automation** | Puppeteer for Google Maps + WhatsApp Web + website checking |
| **Background Jobs / Queues** | BullMQ + Redis for scrape job queuing with real-time polling |
| **Authentication / Security** | JWT tokens, bcryptjs password hashing, rate limiting, input validation |
| **API Design / Documentation** | RESTful API with Swagger/OpenAPI 3.0.3 spec |
| **Database Design** | PostgreSQL with proper indexing, deduplication, conflict handling |
| **Testing** | 130 tests across unit, integration, and QA suites |
| **Docker / Containerisation** | Dockerfile + docker-compose.yml for local production stack |
| **CI/CD** | GitHub Actions with automated testing on push |
| **Cloud Deployment** | Vercel (frontend), Koyeb (backend), Neon (PostgreSQL) |
| **Responsive Design** | CSS media queries for desktop, tablet, phone |
| **Architecture** | Dual-mode system design (`DEMO_MODE` flag), environment-based configuration |

---

## Feature Checklist

### Core CRM
- [x] JWT registration / login / password change
- [x] Create, read, update, delete businesses
- [x] Search by name / phone / city
- [x] Filter by pipeline status (6 stages)
- [x] Filter by website status (5 statuses)
- [x] Sort by any column (name, rating, city, etc.)
- [x] Infinite-scroll pagination
- [x] CSV / XLSX export
- [x] Pipeline history tracking
- [x] Duplicate detection (phone-based)

### Scraper
- [x] Google Maps navigation via Puppeteer
- [x] Extract name, phone, address, rating, reviews, website
- [x] Location + categories input
- [x] BullMQ job queue with real-time polling
- [x] Cancel running scrape
- [x] Job status endpoint
- [x] Rate limit protection

### Website Checker
- [x] Visit each URL with 8s timeout
- [x] Classify: Working / Broken / Blocked / No Website
- [x] Bot challenge detection (Cloudflare, captcha, DDoS protection)
- [x] Process all unchecked businesses in batch
- [x] Competitor examples for businesses without websites

### WhatsApp Automation
- [x] WhatsApp Web connection via Puppeteer
- [x] Connection status endpoint
- [x] Disconnect / reconnect
- [x] Send templated messages with {name}, {city} placeholders
- [x] Randomised delays (3–9s) between messages
- [x] Pause / resume send
- [x] Stop send mid-way
- [x] Full send log with timestamps

### Demo Mode
- [x] 500 pre-seeded realistic businesses
- [x] Mock scrape returns sample data
- [x] Mock website checker returns varied statuses
- [x] Mock WhatsApp always shows "connected"
- [x] Yellow demo banner in UI
- [x] Auto-seed on first startup
- [x] No Redis / Puppeteer / Chrome needed

### Deployment
- [x] Vercel deployment (frontend)
- [x] Koyeb deployment (backend)
- [x] Neon PostgreSQL (database)
- [x] One-command deploy script (deploy.ps1)
- [x] Environment variable reference (README-DEMO.md, DEPLOY-DEMO.md)
- [x] Dockerfile + docker-compose.yml
- [x] CI pipeline (GitHub Actions)

### Testing
- [x] 26 helper unit tests (normalizeUrl, looksLikeBotChallenge, cleanPhone)
- [x] 33 API integration tests
- [x] 71 QA tests (auth, edge cases, CRUD, dedup, etc.)
- [x] All 130 tests pass in production mode
- [x] Demo mode verified manually

### Documentation
- [x] README.md — project overview, architecture, quick start
- [x] README-LOCAL.md — full local production setup
- [x] README-DEMO.md — cloud demo setup guide
- [x] DEPLOY-DEMO.md — deployment step-by-step
- [x] VIDEO_DEMO.md — 3-minute video script
- [x] RESUME.md — this document
- [x] Swagger / OpenAPI docs at /api-docs
