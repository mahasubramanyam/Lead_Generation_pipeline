# 3-Minute Demo Script

**Link:** `https://lead-pipeline.vercel.app`  
**Credentials:** `demo@example.com` / `demopass123`

---

## 0:00 – 0:15 | Title + What is Lead Pipeline?

*Screen: Project logo + tagline*

**Voiceover:** "Meet Lead Pipeline — a full-stack CRM that helps Indian web agencies find local businesses without working websites, check if those sites are reachable, and reach out via WhatsApp — all from one dashboard."

---

## 0:15 – 0:35 | Demo Mode Banner + Login

*Screen: Login page → type demo@example.com / demopass123 → click Login*

**Voiceover:** "This demo is hosted on free cloud infrastructure — Vercel for the frontend, Koyeb for the backend, and Neon for the database. No credit cards required. I've already created a demo account, so let's log in."

*Screen: Dashboard loads with yellow demo banner*

**Voiceover:** "Notice the yellow banner — that tells you we're in demo mode. Live scraping and WhatsApp are disabled. Instead, 500 realistic sample businesses are pre-seeded."

---

## 0:35 – 1:05 | The Ledger (Business Listing)

*Screen: Scroll through the infinite-scroll ledger, show search, filter by pipeline status*

**Voiceover:** "This is the main ledger — an infinite-scroll spreadsheet with every business we've found. You can search by name, phone, or city. Filter by pipeline stage — not contacted, contacted, interested, will talk later, not interested, or completed."

*Screen: Filter by "interested", then clear filter, then sort by rating*

**Voiceover:** "You can sort by any column — rating, name, city. The idea is to quickly triage which businesses are worth pursuing."

---

## 1:05 – 1:25 | Business Detail + Competitor Examples

*Screen: Click on a business → View detail → Competitor Examples tab*

**Voiceover:** "Click any business to see the full detail. And here's a unique feature — Competitor Examples. For any business that doesn't have a working website, we show similar local businesses that DO have websites. This is the sales ammunition your agency needs to convince them to buy."

---

## 1:25 – 1:45 | Scrape Tab

*Screen: Switch to Scrape tab, show the form*

**Voiceover:** "The Scrape tab is where you find new leads. Enter a location — say Bangalore — and categories like dental clinic, cafe, beauty parlor. In production, this launches a headless Chrome browser that scrapes Google Maps. In demo mode, we return mock data instantly."

*Screen: Click "Start Scrape" → see mock results appear*

**Voiceover:** "In production, you'd see real business names, phone numbers, addresses, ratings, and websites from Google Maps."

---

## 1:45 – 2:05 | WhatsApp Outreach

*Screen: Switch to WhatsApp tab, show the template composer*

**Voiceover:** "Once you have leads, the WhatsApp tab lets you send templated outreach messages. Select businesses, write your message with placeholders like {name} or {city}, and hit send."

*Screen: Show message send animation*

**Voiceover:** "In production, this opens a real WhatsApp Web session and sends messages with configurable delays to avoid being flagged. In demo mode, everything's mocked — you can see the flow without needing a real phone."

---

## 2:05 – 2:25 | Stats + Pipeline History + Send Log

*Screen: Click on Stats tab, scroll through charts*

**Voiceover:** "The Stats tab shows you the big picture — total leads, pipeline breakdown, website status distribution. The Pipeline History shows every status change, and the Send Log tracks every WhatsApp message sent."

*Screen: Show pipeline history scrolling*

**Voiceover:** "This helps you measure your sales team's effectiveness over time."

---

## 2:25 – 2:45 | Tech Stack + Dual Mode

*Screen: Show architecture diagram or split screen of code*

**Voiceover:** "Under the hood — React with Vite on the frontend, Node.js Express on the backend, PostgreSQL for the database. What makes this project unique is the dual-mode architecture. Set DEMO_MODE=true and it's a fully self-contained demo — no Puppeteer, no Redis, no WhatsApp needed. Set DEMO_MODE=false and you get the full production experience with real scraping and automation."

---

## 2:45 – 3:00 | Call to Action + Outro

*Screen: GitHub repo page*

**Voiceover:** "The full code is on GitHub, with detailed READMEs for both local production setup and cloud deployment. There's also a one-command deploy script that creates a Neon database, deploys to Koyeb and Vercel automatically. Check the links in the description to try it yourself."

*Screen: Thank you + contact info*

**Voiceover:** "Thanks for watching. Happy lead generation!"
