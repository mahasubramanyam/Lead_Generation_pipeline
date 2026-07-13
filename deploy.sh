#!/usr/bin/env bash
# one-command deployment to Vercel + Koyeb + Neon
set -euo pipefail

usage() {
  cat <<EOF
Usage: $0 --koyeb-token TOKEN --neon-token TOKEN --vercel-token TOKEN [--jwt-secret SECRET] [--skip-backend] [--skip-frontend]

Required:
  --koyeb-token   API token from https://app.koyeb.com/account/api
  --neon-token    API token from https://console.neon.tech/app/settings/api-keys
  --vercel-token  API token from https://vercel.com/account/tokens

Optional:
  --jwt-secret    Random string for JWT signing (auto-generated if omitted)
  --skip-backend  Skip backend deployment
  --skip-frontend Skip frontend deployment
EOF
  exit 1
}

ROOT_DIR="$(cd "$(dirname "$0")" && pwd)"

JWT_SECRET=""
SKIP_BACKEND=false
SKIP_FRONTEND=false

while [[ $# -gt 0 ]]; do
  case "$1" in
    --koyeb-token)   KOYEB_TOKEN="$2";   shift 2 ;;
    --neon-token)    NEON_TOKEN="$2";    shift 2 ;;
    --vercel-token)  VERCEL_TOKEN="$2";  shift 2 ;;
    --jwt-secret)    JWT_SECRET="$2";    shift 2 ;;
    --skip-backend)  SKIP_BACKEND=true;  shift ;;
    --skip-frontend) SKIP_FRONTEND=true; shift ;;
    *) echo "Unknown option: $1"; usage ;;
  esac
done

[ -z "${KOYEB_TOKEN:-}" ] && echo "Missing --koyeb-token" && usage
[ -z "${NEON_TOKEN:-}" ] && echo "Missing --neon-token" && usage
[ -z "${VERCEL_TOKEN:-}" ] && echo "Missing --vercel-token" && usage
[ -z "$JWT_SECRET" ] && JWT_SECRET=$(openssl rand -hex 32)

echo "=== Lead Pipeline Deployment ==="
echo ""

# ── 1. Create Neon PostgreSQL database ──────────────────────────
echo "[1/4] Creating Neon PostgreSQL database..."

PROJECT_JSON=$(curl -sf -H "Authorization: Bearer $NEON_TOKEN" \
  "https://console.neon.tech/api/v2/projects" 2>/dev/null || echo '{"projects":[]}')
PROJECT_ID=$(echo "$PROJECT_JSON" | jq -r '.projects[] | select(.name=="lead-pipeline") | .id' 2>/dev/null || echo "")

if [ -z "$PROJECT_ID" ]; then
  CREATE_JSON=$(curl -sf -X POST \
    -H "Authorization: Bearer $NEON_TOKEN" \
    -H "Content-Type: application/json" \
    -d '{"project":{"name":"lead-pipeline","region_id":"aws-ap-south-1"}}' \
    "https://console.neon.tech/api/v2/projects")
  PROJECT_ID=$(echo "$CREATE_JSON" | jq -r '.project.id')
  echo "  Created project: $PROJECT_ID"
  sleep 10
fi

# Get connection string
DB_JSON=$(curl -sf -H "Authorization: Bearer $NEON_TOKEN" \
  "https://console.neon.tech/api/v2/projects/$PROJECT_ID/databases" 2>/dev/null || echo '{"databases":[]}')
DATABASE_NAME=$(echo "$DB_JSON" | jq -r '.databases[0].name // "lead_pipeline"')
DATABASE_USER=$(echo "$DB_JSON" | jq -r '.databases[0].owner_name // "user"')
DATABASE_HOST=$(echo "$DB_JSON" | jq -r '.databases[0].host // ""')

if [ -z "$DATABASE_HOST" ]; then
  # Try to create the database
  curl -sf -X POST \
    -H "Authorization: Bearer $NEON_TOKEN" \
    -H "Content-Type: application/json" \
    -d '{"database":{"name":"lead_pipeline"}}' \
    "https://console.neon.tech/api/v2/projects/$PROJECT_ID/databases" > /dev/null 2>&1 || true
  
  CONN_JSON=$(curl -sf -H "Authorization: Bearer $NEON_TOKEN" \
    "https://console.neon.tech/api/v2/projects/$PROJECT_ID/connection_uri" 2>/dev/null || echo '{"connection_uri":""}')
  CONNECTION_URI=$(echo "$CONN_JSON" | jq -r '.connection_uri')
else
  PASSWORD=$(echo "$DB_JSON" | jq -r '.databases[0].password // "pass"')
  CONNECTION_URI="postgresql://${DATABASE_USER}:${PASSWORD}@${DATABASE_HOST}:5432/${DATABASE_NAME}?sslmode=require"
fi

echo "  Database ready: $PROJECT_ID" | tee /dev/null

# ── 2. Deploy backend to Koyeb ─────────────────────────────────
BACKEND_URL=""
if [ "$SKIP_BACKEND" = false ]; then
  echo "[2/4] Deploying backend to Koyeb..."

  # Create app
  curl -sf -X POST \
    -H "Authorization: Bearer $KOYEB_TOKEN" \
    -H "Content-Type: application/json" \
    -d '{"app":{"name":"lead-pipeline"}}' \
    "https://app.koyeb.com/v1/apps" > /dev/null 2>&1 || echo "  App may already exist, continuing..."

  # Create service from GitHub
  cat > /tmp/koyeb-payload.json <<JSONEOF
{
  "service": {
    "app_name": "lead-pipeline",
    "definition": {
      "name": "lead-pipeline",
      "git": {
        "repository": "https://github.com/mahasubramanyam/Lead_Generation_pipeline",
        "branch": "main",
        "build_command": "npm install",
        "run_command": "node server.js"
      },
      "instance_type": "free",
      "ports": [{"port": 5000, "protocol": "http"}],
      "env": [
        {"key": "DEMO_MODE", "value": "true"},
        {"key": "ALLOW_NETWORK", "value": "true"},
        {"key": "DATABASE_URL", "value": "'"$CONNECTION_URI"'"},
        {"key": "JWT_SECRET", "value": "'"$JWT_SECRET"'"},
        {"key": "NODE_VERSION", "value": "20"}
      ],
      "regions": ["was"],
      "scalings": {"min": 1, "max": 1}
    }
  }
}
JSONEOF

  SERVICE_RESULT=$(curl -sf -X POST \
    -H "Authorization: Bearer $KOYEB_TOKEN" \
    -H "Content-Type: application/json" \
    -d @/tmp/koyeb-payload.json \
    "https://app.koyeb.com/v1/services" 2>/dev/null || echo "")

  if [ -n "$SERVICE_RESULT" ]; then
    echo "  Backend deploying on Koyeb..."
    sleep 30
    # Try to get the public URL
    SVCS_JSON=$(curl -sf -H "Authorization: Bearer $KOYEB_TOKEN" \
      "https://app.koyeb.com/v1/services" 2>/dev/null || echo '{"services":[]}')
    BACKEND_URL=$(echo "$SVCS_JSON" | jq -r '.services[] | select(.definition.name=="lead-pipeline") | .id as $id | .app_id as $app | "https://\($app)-\($id).koyeb.app"' 2>/dev/null | head -1)
  fi
fi

[ -z "$BACKEND_URL" ] && BACKEND_URL="https://lead-pipeline.koyeb.app"
echo "  Backend URL: $BACKEND_URL"

# ── 3. Deploy frontend to Vercel ───────────────────────────────
FRONTEND_URL=""
if [ "$SKIP_FRONTEND" = false ]; then
  echo "[3/4] Deploying frontend to Vercel..."

  # Install Vercel CLI if not present
  command -v vercel >/dev/null 2>&1 || npm install -g vercel

  cd "$ROOT_DIR"
  VITE_API_URL="$BACKEND_URL" vercel deploy \
    --token "$VERCEL_TOKEN" \
    --yes \
    --prod \
    --build-env VITE_API_URL="$BACKEND_URL" 2>&1 | tee /tmp/vercel-output.txt || true

  FRONTEND_URL=$(grep -oE 'https://[a-z0-9-]+\.vercel\.app' /tmp/vercel-output.txt | head -1)
fi

# ── Summary ────────────────────────────────────────────────────
echo ""
echo "=== Deployment Complete ==="
echo ""
echo "  Backend URL:  $BACKEND_URL"
echo "  Frontend URL: $FRONTEND_URL"
echo ""
echo "  Environment Variables (set in Koyeb):"
echo "    DEMO_MODE=true"
echo "    ALLOW_NETWORK=true"
echo "    DATABASE_URL=$CONNECTION_URI"
echo "    JWT_SECRET=$JWT_SECRET"
echo "    NODE_VERSION=20"
echo ""
echo "  Frontend env (set in Vercel):"
echo "    VITE_API_URL=$BACKEND_URL"
echo ""
echo "  Next steps:"
echo "  1. Open $FRONTEND_URL"
echo "  2. Create an account"
echo "  3. The app auto-seeds 500 sample businesses"
echo "  4. Explore all features in demo mode"
