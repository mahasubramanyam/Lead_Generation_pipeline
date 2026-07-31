@echo off
cd /d C:\Users\mahas\OneDrive\maha1\Documents\WEB-AGENCY\lead-pipeline-competitor-cg\lead-pipeline

echo [1/4] Starting Docker Desktop...
start /B /MIN "" "C:\Program Files\Docker\Docker\Docker Desktop.exe"
timeout /t 20 /nobreak >nul

echo [2/4] Starting PostgreSQL + Redis containers...
docker start pg-db 2>nul || docker run -d --name pg-db -e POSTGRES_USER=user -e POSTGRES_PASSWORD=pass -e POSTGRES_DB=lead_pipeline -p 5432:5432 postgres:15-alpine
docker start redis-stack 2>nul || docker run -d --name redis-stack -p 6379:6379 redis:7-alpine

echo [3/4] Waiting for database...
:wait_db
timeout /t 3 /nobreak >nul
docker exec pg-db pg_isready -U user 2>nul | find "accepting" >nul
if errorlevel 1 goto wait_db

echo [4/4] Starting Node.js server...
set DEMO_MODE=false
set JWT_SECRET=lp-secret-change-in-production
set DATABASE_URL=postgresql://user:pass@localhost:5432/lead_pipeline
set REDIS_URL=redis://localhost:6379
node server.js

pause
