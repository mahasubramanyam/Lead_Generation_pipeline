# Lead Pipeline — Demo Version

## Overview

Demo mode runs the same application with live services disabled.
Instead of scraping, sending WhatsApp messages, or checking websites,
it returns realistic sample data so you can explore the UI and test
all features without a real infrastructure setup.

## How it works

Set `DEMO_MODE=true` (env var).

### What changes

| Feature | Production (`DEMO_MODE=false`) | Demo (`DEMO_MODE=true`) |
|---------|------|------|
| Scraping | Launches Puppeteer/Chrome, scrapes Google Maps | Generates sample businesses for requested location |
| Website checks | Visits each URL with Puppeteer | Assigns random realistic status |
| WhatsApp | Connects to real WhatsApp Web | Returns success without connecting |
| BullMQ queue | Requires Redis | Skipped entirely |
| Redis connection | Required | Not needed |
| Database | User-provided data | Auto-seeded with 500 sample businesses on first run |

### What stays the same

- ✅ Authentication (register, login, JWT)
- ✅ Business CRUD (create, read, update, delete)
- ✅ Search, filters, pagination
- ✅ CSV/XLSX export
- ✅ Competitor examples
- ✅ Dashboard statistics
- ✅ Pipeline status tracking
- ✅ Notes, ratings, reviews
- ✅ All API endpoints identical
- ✅ Swagger docs
- ✅ Frontend UI (with a small "Demo Mode" banner)

## Run locally

```bash
# Only PostgreSQL needed (no Redis)
docker start pg-db

DEMO_MODE=true node server.js

# Or with npm:
DEMO_MODE=true npm run server
```

The first startup seeds 500 realistic businesses across 20 Indian cities
and 50 business categories.

## Frontend banner

A yellow banner appears at the top:
> **Demo Mode — Live scraping and WhatsApp are disabled.**
