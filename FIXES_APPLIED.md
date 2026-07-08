# Fixes applied

- Debounced Ledger search API calls with a 300ms timeout.
- Scrape rows are inserted/updated immediately inside the scraping loop, so the Ledger can show rows during a long scrape.
- Added cross-run dedupe using normalized phone number and name+phone checks; duplicate sends are also skipped per campaign.
- Tightened Google Maps rating/review extraction to rating-specific elements instead of scanning the whole visible page first.
- Added CAPTCHA/unusual-traffic detection for Google Maps pages.
- Added scrape cancellation endpoint and UI button.
- Website checks now retry once, detect common bot/challenge pages, store `website_checked_at`, and run with a concurrency limit of 6.
- Added `blocked` website status for Cloudflare/CAPTCHA-style pages.
- Added Ledger pagination at 100 rows per page.
- Added WhatsApp send confirmation before starting a campaign.
- Added pipeline status timestamps and a `pipeline_history` audit table/API.
- Added a localhost-only network safety rail by default. Set `ALLOW_NETWORK=true` only after putting the app behind authentication.

## Added: similar local website examples

New pitching feature for no-website/broken-site leads:

- Added backend API: `GET /api/businesses/:id/competitor-examples`.
- For a selected lead, it finds businesses already stored in the ledger that are:
  - in the same city/locality,
  - in the same or similar category when possible,
  - marked as `working`,
  - and have a website URL.
- Added a **Similar Websites** column in the Ledger.
- For leads with `No Website`, `Broken`, or `Blocked/Challenge`, click **View examples** to see local competitor websites.
- Each example card shows business name, category, city, address, rating/reviews, and an **Open website** button.
- If no close category match exists, it falls back to other working websites from the same city so you still have local proof examples.
