# Lead Pipeline — Local Full Version

## Prerequisites

- Node.js 20+
- Docker (for PostgreSQL and Redis)
- npm dependencies installed

## Setup

```bash
# Install dependencies
npm install

# Start PostgreSQL and Redis
docker start pg-db redis-stack
# Or if first time:
docker run -d --name pg-db -e POSTGRES_USER=user -e POSTGRES_PASSWORD=pass -e POSTGRES_DB=lead_pipeline -p 5432:5432 postgres:15-alpine
docker run -d --name redis-stack -p 6379:6379 redis:7-alpine
```

## Environment

Create a `.env` file (or use defaults):

```env
PORT=5000
DATABASE_URL=postgresql://user:pass@localhost:5432/lead_pipeline
REDIS_URL=redis://localhost:6379
JWT_SECRET=change-this-to-a-random-secret
ALLOW_NETWORK=false
DEMO_MODE=false
```

## Run

```bash
# Backend only
npm run server

# Frontend + backend (concurrently)
npm start
```

- API: `http://localhost:5000`
- Swagger docs: `http://localhost:5000/api-docs/`
- Frontend: `http://localhost:5173`

## Tests

```bash
npm test              # helpers.test.js (26 unit tests)
npm run test:api      # api.test.js (33 API tests)
npm run test:all      # helpers + api
node --test tests/qa.test.js  # QA suite (71 tests)
```

## Features enabled (DEMO_MODE=false)

- ✅ Live Google Maps scraping via Puppeteer
- ✅ Real website reachability checks
- ✅ WhatsApp Web messaging
- ✅ BullMQ background job queue (requires Redis)
- ✅ Chrome headless browser
