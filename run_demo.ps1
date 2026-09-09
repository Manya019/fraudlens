# FraudLens Adaptive — Windows PowerShell Runner
# Starts FastAPI backend (port 8000) and Vite frontend (port 5173)

$ErrorActionPreference = "Continue"

$ProjectRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$ServerDir = Join-Path $ProjectRoot "server"
$ClientDir = Join-Path $ProjectRoot "client"
$VenvPython = Join-Path $ServerDir ".venv\Scripts\python.exe"

Write-Host ""
Write-Host "==================================================" -ForegroundColor Cyan
Write-Host "  FraudLens Adaptive -- Starting Services" -ForegroundColor Cyan
Write-Host "==================================================" -ForegroundColor Cyan
Write-Host ""

# Check for uv
$uvPath = Get-Command uv -ErrorAction SilentlyContinue
if (-not $uvPath) {
    Write-Host "ERROR: uv not found. Install via: winget install astral-sh.uv" -ForegroundColor Red
    exit 1
}

# Create venv if needed
if (-not (Test-Path $VenvPython)) {
    Write-Host "[1/3] Creating Python virtual environment..." -ForegroundColor Yellow
    Push-Location $ServerDir
    uv venv .venv --python 3.11
    Pop-Location
}

# Install backend deps
Write-Host "[1/3] Installing backend dependencies..." -ForegroundColor Yellow
Push-Location $ServerDir
uv pip install -r requirements.txt --python .venv\Scripts\python.exe --quiet
Write-Host "[1/3] Backend ready." -ForegroundColor Green
Pop-Location
Write-Host ""

# Install frontend deps
Write-Host "[2/3] Installing frontend dependencies..." -ForegroundColor Yellow
Push-Location $ClientDir
npm install --silent
Write-Host "[2/3] Frontend ready." -ForegroundColor Green
Pop-Location
Write-Host ""

# Launch servers
Write-Host "[3/3] Launching servers..." -ForegroundColor Yellow

# Backend process
$backendArgs = @{
    FilePath = "powershell.exe"
    ArgumentList = @("-NoExit", "-Command", "Set-Location '$ServerDir'; & '$VenvPython' -m uvicorn main:app --host 0.0.0.0 --port 8000 --reload")
    WindowStyle = "Normal"
}
Start-Process @backendArgs

# Frontend process
$frontendArgs = @{
    FilePath = "powershell.exe"
    ArgumentList = @("-NoExit", "-Command", "Set-Location '$ClientDir'; npm run dev")
    WindowStyle = "Normal"
}
Start-Process @frontendArgs

Start-Sleep -Seconds 3

Write-Host ""
Write-Host "==================================================" -ForegroundColor Green
Write-Host "  FraudLens Adaptive is running!" -ForegroundColor Green
Write-Host "==================================================" -ForegroundColor Green
Write-Host ""
Write-Host "  Backend API:   http://localhost:8000" -ForegroundColor Cyan
Write-Host "  Frontend UI:   http://localhost:5173" -ForegroundColor Cyan
Write-Host "  API Docs:      http://localhost:8000/docs" -ForegroundColor Cyan
Write-Host "  Health check:  http://localhost:8000/api/health" -ForegroundColor Cyan
Write-Host ""
Write-Host "  Note: Backend model training takes ~10-15s on first start." -ForegroundColor Yellow
Write-Host "  Two terminal windows have opened for each service." -ForegroundColor Gray
Write-Host ""
