# Forge setup for Windows: checks prerequisites, installs pinned dependencies.
$ErrorActionPreference = "Stop"
Set-Location (Join-Path $PSScriptRoot "..")
if (-not (Get-Command node -ErrorAction SilentlyContinue)) { Write-Error "Node.js 22+ is required: https://nodejs.org" }
if (-not (Get-Command git -ErrorAction SilentlyContinue)) { Write-Error "Git 2.40+ is required: https://git-scm.com" }
if (Test-Path package-lock.json) { npm ci } else { npm install }
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
if (-not (Test-Path forge.config.json)) { Copy-Item forge.config.example.json forge.config.json }
& node src\cli\index.mjs doctor
exit $LASTEXITCODE
