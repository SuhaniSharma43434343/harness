# Clean-extraction test (acceptance A1 and A14) for Windows.
# Usage: powershell -ExecutionPolicy Bypass -File scripts\clean-extract-test.ps1 path\to\forge-vX.Y.Z.zip
# Extracts the ZIP into a new empty folder, runs setup (npm ci and doctor) and the test suite,
# and keeps a log next to the ZIP. Run it on a machine or account that never held the repo.
param([Parameter(Mandatory = $true)][string]$Zip)
$ErrorActionPreference = 'Stop'
$Zip = (Resolve-Path $Zip).Path
$Log = [IO.Path]::ChangeExtension($Zip, $null).TrimEnd('.') + '-clean-extract.log'
$Work = Join-Path ([IO.Path]::GetTempPath()) ("forge-clean-" + [Guid]::NewGuid().ToString('N').Substring(0, 8))
Start-Transcript -Path $Log | Out-Null
try {
  Write-Output "Clean extraction of $(Split-Path $Zip -Leaf) on Windows $([Environment]::OSVersion.Version), $((Get-Date).ToUniversalTime().ToString('s'))Z"
  Expand-Archive -Path $Zip -DestinationPath $Work
  $Dir = Get-ChildItem $Work -Directory | Select-Object -First 1
  Set-Location $Dir.FullName
  powershell -ExecutionPolicy Bypass -File scripts\setup.ps1
  if ($LASTEXITCODE -ne 0) { throw "setup failed" }
  npm test
  if ($LASTEXITCODE -ne 0) { throw "tests failed" }
  Write-Output "PASS"
} finally {
  Stop-Transcript | Out-Null
  Write-Output "Log: $Log"
}
