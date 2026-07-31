@echo off
set DEMO_MODE=false
set JWT_SECRET=lp-secret-change-in-production
set DATABASE_URL=postgresql://user:pass@localhost:5432/lead_pipeline
set REDIS_URL=redis://localhost:6379
cd /d C:\Users\mahas\OneDrive\maha1\Documents\WEB-AGENCY\lead-pipeline-competitor-cg\lead-pipeline
node server.js
