# Forge setup for Windows: checks prerequisites, installs pinned dependencies.
# -WithTestTools also installs the browser test tools for the quality gates.
param([switch]$WithTestTools)
$ErrorActionPreference = "Stop"
Set-Location (Join-Path $PSScriptRoot "..")
if (-not (Get-Command node -ErrorAction SilentlyContinue)) { Write-Error "Node.js 22+ is required: https://nodejs.org" }
if (-not (Get-Command git -ErrorAction SilentlyContinue)) { Write-Error "Git 2.40+ is required: https://git-scm.com" }
if (Test-Path package-lock.json) { npm ci } else { npm install }
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
# The starter site's own dependencies (Astro), used by forge site --build and the build tests.
Push-Location starters\astro-base
npm ci --no-audit --no-fund
$code = $LASTEXITCODE
Pop-Location
if ($code -ne 0) { exit $code }
if ($WithTestTools) {
  Push-Location tools
  npm ci --no-audit --no-fund
  if ($LASTEXITCODE -eq 0) { npx playwright install chromium }
  $code = $LASTEXITCODE
  Pop-Location
  if ($code -ne 0) { exit $code }
}
if (-not (Test-Path forge.config.json)) { Copy-Item forge.config.example.json forge.config.json }
& node src\cli\index.mjs doctor
exit $LASTEXITCODE
