<#
.SYNOPSIS
  One-command deployment of Lead Pipeline to Vercel + Koyeb + Neon.

.DESCRIPTION
  This script:
    1. Creates a free Neon PostgreSQL database
    2. Deploys the backend (Express) to Koyeb
    3. Deploys the frontend (Vite/React) to Vercel
    4. Connects everything with correct environment variables

.PARAMETER KoyebToken
  API token from https://app.koyeb.com/account/api

.PARAMETER NeonToken
  API token from https://console.neon.tech/app/settings/api-keys

.PARAMETER VercelToken
  API token from https://vercel.com/account/tokens

.PARAMETER JwtSecret
  A random string used for JWT signing. Auto-generated if omitted.

.PARAMETER SkipBackend
  Skip backend deployment (if already deployed).

.PARAMETER SkipFrontend
  Skip frontend deployment (if already deployed).

.EXAMPLE
  .\deploy.ps1 -KoyebToken "koyeb_xxx" -NeonToken "neon_xxx" -VercelToken "vercel_xxx"
#>

param(
  [Parameter(Mandatory=$true)][string]$KoyebToken,
  [Parameter(Mandatory=$true)][string]$NeonToken,
  [Parameter(Mandatory=$true)][string]$VercelToken,
  [string]$JwtSecret = "",
  [switch]$SkipBackend,
  [switch]$SkipFrontend
)

$ErrorActionPreference = "Stop"
$RootDir = Split-Path -Parent $MyInvocation.MyCommand.Path

if (-not $JwtSecret) {
  $JwtSecret = -join ((65..90) + (97..122) + (48..57) | Get-Random -Count 32 | ForEach-Object { [char]$_ })
}

Write-Host "=== Lead Pipeline Deployment ===" -ForegroundColor Cyan
Write-Host ""

# ── 1. Create Neon PostgreSQL database ──────────────────────────
Write-Host "[1/4] Creating Neon PostgreSQL database..." -ForegroundColor Yellow
$neonHeaders = @{ Authorization = "Bearer $NeonToken"; "Content-Type" = "application/json" }

# Check if project already exists
$existing = try { Invoke-RestMethod -Uri "https://console.neon.tech/api/v2/projects" -Headers $neonHeaders -Method Get -ErrorAction SilentlyContinue } catch { $null }
$project = $existing.projects | Where-Object { $_.name -eq "lead-pipeline" } | Select-Object -First 1

if (-not $project) {
  $body = @{
    project = @{
      name = "lead-pipeline"
      region_id = "aws-ap-south-1"
    }
  } | ConvertTo-Json -Depth 10
  $result = Invoke-RestMethod -Uri "https://console.neon.tech/api/v2/projects" -Headers $neonHeaders -Method Post -Body $body
  $project = $result.project
  
  # Wait for DB to be ready
  Start-Sleep -Seconds 10
  $result2 = Invoke-RestMethod -Uri "https://console.neon.tech/api/v2/projects/$($project.id)" -Headers $neonHeaders -Method Get
  $project = $result2.project
}

$connectionUri = ($project.connection_uris | Select-Object -First 1).connection_uri
if (-not $connectionUri) {
  # Create a database
  $dbBody = @{ database = @{ name = "lead_pipeline" } } | ConvertTo-Json -Depth 10
  Invoke-RestMethod -Uri "https://console.neon.tech/api/v2/projects/$($project.id)/databases" -Headers $neonHeaders -Method Post -Body $dbBody | Out-Null
  $connResult = Invoke-RestMethod -Uri "https://console.neon.tech/api/v2/projects/$($project.id)/connection_uri" -Headers $neonHeaders -Method Get
  $connectionUri = $connResult.connection_uri
}

$databasesUrl = "https://console.neon.tech/api/v2/projects/$($project.id)/databases"
$databases = (Invoke-RestMethod -Uri $databasesUrl -Headers $neonHeaders -Method Get).databases
$mainDb = $databases | Select-Object -First 1
$connectionUri = $mainDb.host ? "postgresql://$($mainDb.owner_name):$($mainDb.password)@$($mainDb.host):5432/$($mainDb.name)?sslmode=require" : $connectionUri

Write-Host "  Database: $($project.id)" -ForegroundColor Green

# ── 2. Deploy backend to Koyeb ─────────────────────────────────
if (-not $SkipBackend) {
  Write-Host "[2/4] Deploying backend to Koyeb..." -ForegroundColor Yellow
  $koyebHeaders = @{ Authorization = "Bearer $KoyebToken"; "Content-Type" = "application/json" }

  # Create app
  $koyebAppBody = @{
    app = @{ name = "lead-pipeline" }
  } | ConvertTo-Json
  try {
    Invoke-RestMethod -Uri "https://app.koyeb.com/v1/apps" -Headers $koyebHeaders -Method Post -Body $koyebAppBody -ErrorAction SilentlyContinue | Out-Null
  } catch { Write-Host "  App may already exist, continuing..." -ForegroundColor DarkYellow }

  # Build and push the Docker image (using Koyeb's builder)
  # Koyeb can deploy directly from a GitHub repo
  Write-Host "  Deploying from GitHub repository..." -ForegroundColor Yellow
  Write-Host "  Make sure your repo is pushed to GitHub first!" -ForegroundColor DarkYellow

  # Create service
  $serviceBody = @{
    service = @{
      app_name = "lead-pipeline"
      definition = @{
        name = "lead-pipeline"
        docker = @{
          image = ""  # Use buildpacks
          command = ""
          args = @()
        }
        git = @{
          repository = "https://github.com/mahasubramanyam/Lead_Generation_pipeline"
          branch = "main"
          build_command = "npm install"
          run_command = "node server.js"
        }
        instance_type = "free"
        ports = @(@{
          port = 5000
          protocol = "http"
        })
        env = @(
          @{ key = "DEMO_MODE"; value = "true" }
          @{ key = "ALLOW_NETWORK"; value = "true" }
          @{ key = "DATABASE_URL"; value = $connectionUri }
          @{ key = "JWT_SECRET"; value = $JwtSecret }
          @{ key = "NODE_VERSION"; value = "20" }
        )
        regions = @("was")
        scalings = @{
          min = 1
          max = 1
        }
      }
    }
  } | ConvertTo-Json -Depth 10

  try {
    $koyebService = Invoke-RestMethod -Uri "https://app.koyeb.com/v1/services" -Headers $koyebHeaders -Method Post -Body $serviceBody
    Write-Host "  Backend deploying..." -ForegroundColor Green
    
    # Wait and get the public URL
    Start-Sleep -Seconds 30
    $serviceStatus = Invoke-RestMethod -Uri "https://app.koyeb.com/v1/services" -Headers $koyebHeaders -Method Get
    $svc = $serviceStatus.services | Where-Object { $_.definition.name -eq "lead-pipeline" } | Select-Object -First 1
    if ($svc) {
      $backendUrl = "https://$($svc.id)-$($svc.app_id).koyeb.app"
    }
  } catch {
    Write-Host "  Backend deployment failed: $_" -ForegroundColor Red
    Write-Host "  You can deploy manually via Koyeb dashboard > Create App > Deploy from GitHub" -ForegroundColor DarkYellow
    $backendUrl = "https://lead-pipeline.koyeb.app"
  }
} else {
  Write-Host "[2/4] Skipping backend deployment" -ForegroundColor DarkGray
  $backendUrl = "https://lead-pipeline.koyeb.app"
}

# ── 3. Set up VITE_API_URL ─────────────────────────────────────
if (-not $backendUrl) {
  # Prompt user
  $backendUrl = Read-Host "  Enter your Koyeb backend URL (e.g. https://lead-pipeline.koyeb.app)"
}
Write-Host "  Backend URL: $backendUrl" -ForegroundColor Cyan

# ── 4. Deploy frontend to Vercel ───────────────────────────────
if (-not $SkipFrontend) {
  Write-Host "[3/4] Deploying frontend to Vercel..." -ForegroundColor Yellow
  
  # Use Vercel CLI
  $env:VERCEL_TOKEN = $VercelToken
  
  # Check if Vercel CLI is installed
  $vercelCli = Get-Command "vercel" -ErrorAction SilentlyContinue
  if (-not $vercelCli) {
    Write-Host "  Installing Vercel CLI..." -ForegroundColor Yellow
    npm install -g vercel | Out-Null
  }
  
  # Deploy
  Push-Location $RootDir
  try {
    # Link project (or create new one)
    $projectJson = @{ project = "lead-pipeline"; orgId = "" } | ConvertTo-Json
    New-Item -Path ".vercel" -ItemType Directory -Force | Out-Null
    
    # Set VITE_API_URL and deploy
    $env:VITE_API_URL = $backendUrl
    
    $deployResult = vercel deploy --token $VercelToken --yes --prod --build-env VITE_API_URL=$backendUrl 2>&1
    Write-Host $deployResult -ForegroundColor Gray
    
    # Extract URL from output
    $frontendUrl = ($deployResult | Select-String "https://[a-z0-9-]+\.vercel\.app").Matches.Value
    if (-not $frontendUrl) {
      $frontendUrl = ($deployResult | Select-String "https://[a-z0-9-]+\.vercel\.app").Matches.Value
    }
  } finally {
    Pop-Location
  }
} else {
  Write-Host "[3/4] Skipping frontend deployment" -ForegroundColor DarkGray
}

# ── Summary ────────────────────────────────────────────────────
Write-Host ""
Write-Host "=== Deployment Complete ===" -ForegroundColor Cyan
Write-Host ""
Write-Host "  Backend URL:  $backendUrl" -ForegroundColor Green
Write-Host "  Frontend URL: $frontendUrl" -ForegroundColor Green
Write-Host ""
Write-Host "  Environment Variables (set these in Koyeb if manual):" -ForegroundColor Yellow
Write-Host "    DEMO_MODE=true" -ForegroundColor Gray
Write-Host "    ALLOW_NETWORK=true" -ForegroundColor Gray
Write-Host "    DATABASE_URL=$connectionUri" -ForegroundColor Gray
Write-Host "    JWT_SECRET=$JwtSecret" -ForegroundColor Gray
Write-Host "    NODE_VERSION=20" -ForegroundColor Gray
Write-Host ""
Write-Host "  Frontend env (set in Vercel dashboard):" -ForegroundColor Yellow
Write-Host "    VITE_API_URL=$backendUrl" -ForegroundColor Gray
Write-Host ""
Write-Host "  Next steps:" -ForegroundColor White
Write-Host "  1. Open $frontendUrl" -ForegroundColor White
Write-Host "  2. Create an account" -ForegroundColor White
Write-Host "  3. The app auto-seeds 500 sample businesses" -ForegroundColor White
Write-Host "  4. Explore all features in demo mode" -ForegroundColor White
