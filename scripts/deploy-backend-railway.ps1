# Deploy Gastro Manager FastAPI to Railway (public HTTPS).
# Prerequisites: railway login (or RAILWAY_TOKEN), Docker not required (Railway builds remotely).
# Usage (from repo root):
#   powershell -ExecutionPolicy Bypass -File scripts/deploy-backend-railway.ps1

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$backend = Join-Path $root "backend"

$env:NODE_OPTIONS = if ($env:NODE_OPTIONS) { $env:NODE_OPTIONS } else { "--use-system-ca" }

Write-Host "==> Checking Railway auth..."
railway whoami
if ($LASTEXITCODE -ne 0) {
  Write-Host "Not logged in. Run: railway login"
  exit 1
}

Push-Location $backend
try {
  if (-not (Test-Path ".railway") -and -not $env:RAILWAY_TOKEN) {
    Write-Host "==> Linking / creating project (interactive if needed)..."
    railway init
  }

  Write-Host "==> Setting env vars from backend/.env (names only logged)..."
  if (-not (Test-Path ".env")) {
    throw "Missing backend/.env — copy from .env.example"
  }

  $required = @(
    "OPENAI_API_KEY",
    "SUPABASE_URL",
    "SUPABASE_SERVICE_ROLE_KEY",
    "STRIPE_SECRET_KEY",
    "STRIPE_PUBLISHABLE_KEY"
  )
  $optional = @(
    "STRIPE_WEBHOOK_SECRET",
    "STRIPE_PRICE_TIER1",
    "STRIPE_PRICE_TIER2",
    "STRIPE_PRICE_TOPUP_100",
    "STRIPE_PRICE_TOPUP_500",
    "STRIPE_PRICE_TOPUP_1000",
    "PUBLIC_APP_URL",
    "BILLING_SUCCESS_URL",
    "BILLING_CANCEL_URL",
    "SCRAPER_CREDITS_PER_CHECK",
    "ALLOW_MOCK_BILLING",
    "RESEND_API_KEY",
    "RESEND_FROM_EMAIL",
    "OPENAI_STT_MODEL",
    "OPENAI_CHAT_MODEL",
    "OPENAI_INSPIRATIONS_MODEL",
    "ACCOUNT_KEY"
  )

  $map = @{}
  Get-Content ".env" | ForEach-Object {
    $t = $_.Trim()
    if (-not $t -or $t.StartsWith("#")) { return }
    $i = $t.IndexOf("=")
    if ($i -lt 1) { return }
    $k = $t.Substring(0, $i).Trim()
    $v = $t.Substring($i + 1).Trim()
    $map[$k] = $v
  }

  foreach ($k in $required) {
    if (-not $map.ContainsKey($k) -or [string]::IsNullOrWhiteSpace($map[$k])) {
      throw "Missing required env in backend/.env: $k"
    }
  }

  $pairs = @()
  foreach ($k in ($required + $optional)) {
    if ($map.ContainsKey($k) -and -not [string]::IsNullOrWhiteSpace($map[$k])) {
      $pairs += "${k}=$($map[$k])"
      Write-Host "  set $k (len=$($map[$k].Length))"
    }
  }
  if (-not $map.ContainsKey("ACCOUNT_KEY")) {
    $pairs += "ACCOUNT_KEY=default"
    Write-Host "  set ACCOUNT_KEY=default"
  }
  $pairs += "ALLOW_MOCK_BILLING=false"

  # railway variables set KEY=VAL ...
  & railway variables --set ($pairs -join " ") 2>$null
  if ($LASTEXITCODE -ne 0) {
    Write-Host "Bulk set failed; setting one-by-one..."
    foreach ($p in $pairs) {
      railway variables --set $p
    }
  }

  Write-Host "==> Deploying..."
  railway up --detach
  if ($LASTEXITCODE -ne 0) { throw "railway up failed" }

  Write-Host "==> Domain..."
  railway domain 2>&1
  Write-Host "Done. Health: https://<your-domain>/api/health"
  Write-Host "Then update frontend/.env EXPO_PUBLIC_BACKEND_URL and rebuild APK."
}
finally {
  Pop-Location
}
