@echo off
cd /d C:\Users\mahas\OneDrive\maha1\Documents\WEB-AGENCY\lead-pipeline-competitor-cg\lead-pipeline

echo [1/4] Starting Docker Desktop (this may take a moment)...
start /B /MIN "" "C:\Program Files\Docker\Docker\Docker Desktop.exe"

echo [2/4] Waiting for Docker...
:wait_docker
timeout /t 5 /nobreak >nul
docker ps >nul 2>&1
if errorlevel 1 goto wait_docker

echo [3/4] Starting PostgreSQL + Redis...
docker start pg-db 2>nul || docker run -d --name pg-db -e POSTGRES_USER=user -e POSTGRES_PASSWORD=pass -e POSTGRES_DB=lead_pipeline -p 5432:5432 postgres:15-alpine
docker start redis-stack 2>nul || docker run -d --name redis-stack -p 6379:6379 redis:7-alpine

echo [4/4] Starting server + frontend together...
set DEMO_MODE=false
set JWT_SECRET=lp-secret-change-in-production
set DATABASE_URL=postgresql://user:pass@localhost:5432/lead_pipeline
set REDIS_URL=redis://localhost:6379

npm start
pause
