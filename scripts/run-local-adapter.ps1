param([switch]$Smoke, [switch]$WriteChecks)
$ErrorActionPreference = 'Stop'
if ($WriteChecks -and -not $Smoke) { throw 'Use -WriteChecks only with -Smoke.' }
$projectRoot = Split-Path $PSScriptRoot -Parent
$certificate = Join-Path $projectRoot '.local/tls/ca.crt'
if (-not (Test-Path -LiteralPath $certificate)) { throw 'Run scripts/setup-local-https.ps1 first.' }
if (-not (Test-Path -LiteralPath (Join-Path $projectRoot '.env'))) { throw 'Save real store credentials to the ignored .env file first.' }
$previousCa = $env:NODE_EXTRA_CA_CERTS
$previousWrites = $env:SMOKE_WRITE_CHECKS
try {
    # Node reads this at process startup, before application code loads.
    $env:NODE_EXTRA_CA_CERTS = $certificate
    if ($WriteChecks) { $env:SMOKE_WRITE_CHECKS = '1' } else { $env:SMOKE_WRITE_CHECKS = '0' }
    Push-Location $projectRoot
    try {
        $entry = 'src/main.ts'
        if ($Smoke) { $entry = 'scripts/smoke-live-store.ts' }
        & node --env-file=.env --import tsx $entry
        if ($LASTEXITCODE -ne 0) { throw 'Adapter command failed. See the controlled error above.' }
    } finally { Pop-Location }
} finally {
    $env:NODE_EXTRA_CA_CERTS = $previousCa
    $env:SMOKE_WRITE_CHECKS = $previousWrites
}
