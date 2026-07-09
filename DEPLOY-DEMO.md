# Deploy Demo to Render + Vercel

This guide deploys the demo version for free on Render (backend + database)
and Vercel (frontend).

## Architecture

```
User ──→ Vercel (React frontend)
              │
              │  /api/* proxied via VITE_API_URL
              ▼
         Render (Express backend + PostgreSQL)
```

## 1. Render — Backend + PostgreSQL

### Option A: Blueprint (using render.yaml)

1. Push your repo to GitHub
2. Go to https://dashboard.render.com
3. Click **New +** → **Blueprint**
4. Connect your GitHub repo
5. Render reads `render.yaml` and creates:
   - A **Web Service** (`lead-pipeline`)
   - A **PostgreSQL database** (`lead-pipeline-db`)
6. Environment variables are auto-set from `render.yaml`

### Option B: Manual

1. **Create a Web Service**
   - Connect GitHub repo
   - Name: `lead-pipeline`
   - Runtime: **Node**
   - Build Command: `npm ci`
   - Start Command: `node server.js`
   - Plan: **Free**

2. **Add environment variables**

   | Key | Value |
   |-----|-------|
   | `DEMO_MODE` | `true` |
   | `ALLOW_NETWORK` | `true` |
   | `JWT_SECRET` | (generate a random string) |
   | `NODE_VERSION` | `20` |

3. **Create a PostgreSQL database**
   - From the Render dashboard, **New +** → **PostgreSQL**
   - Name: `lead-pipeline-db`
   - Plan: **Free**
   - Copy the **Internal Database URL**

4. **Add the database URL to your Web Service**
   - Go to your Web Service → **Environment**
   - Add `DATABASE_URL` = the Internal Database URL from step 3

### Important for free tier

- The web service sleeps after 15 minutes of inactivity.
- First request after sleep takes ~30 seconds to wake up.
- The database persists data even when the service sleeps.
- You get 750 hours/month (enough for 24/7 for 31 days on a single service).

---

## 2. Vercel — Frontend

1. Push your repo to GitHub
2. Go to https://vercel.com
3. Click **Add New** → **Project**
4. Import your GitHub repo
5. **Framework Preset**: Vite
6. **Build Command**: `npm run build`
7. **Output Directory**: `dist`

8. **Add environment variable**

   | Key | Value |
   |-----|-------|
   | `VITE_API_URL` | `https://lead-pipeline.onrender.com` |

   (Replace with your actual Render URL)

9. Deploy

---

## 3. Verify

1. Open the Vercel URL → you should see the login page
2. Create an account
3. The Ledger tab shows 500 pre-seeded demo businesses
4. The "Find Leads" tab generates sample businesses
5. WhatsApp tab works in demo (no real connection)
6. Search, filters, export, pipeline updates all work
7. A yellow banner shows: **Demo Mode — Live scraping and WhatsApp are disabled.**

---

## Environment Variables Reference

| Variable | Default | Local | Demo | Production |
|----------|---------|-------|------|------------|
| `PORT` | `5000` | `5000` | set by Render | set by Render |
| `DATABASE_URL` | `postgresql://user:pass@localhost:5432/lead_pipeline` | local PG | Render PG | Render PG |
| `REDIS_URL` | `redis://localhost:6379` | local Redis | not needed | production Redis |
| `JWT_SECRET` | `lp-secret-change-in-production` | change it | set in Render | set in Render |
| `ALLOW_NETWORK` | `false` | `false` | `true` | `true` |
| `DEMO_MODE` | `false` | `false` | `true` | `false` |
| `VITE_API_URL` | (empty) | not needed | Render URL | Render URL |
