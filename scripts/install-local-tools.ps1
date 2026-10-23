$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path $PSScriptRoot -Parent
$toolsDir = Join-Path $projectRoot '.local/tools'
$downloadDir = Join-Path $projectRoot '.local/downloads'
New-Item -ItemType Directory -Force -Path $toolsDir, $downloadDir | Out-Null

# Official release assets only. Downloaded binaries are checked before execution.
$k3dVersion = 'v5.9.0'
$k3dBase = "https://github.com/k3d-io/k3d/releases/download/$k3dVersion"
$k3dFile = Join-Path $toolsDir 'k3d.exe'
$checksums = (Invoke-WebRequest "$k3dBase/checksums.txt").Content
if ($checksums -is [byte[]]) { $checksums = [System.Text.Encoding]::UTF8.GetString($checksums) }
$checksumLine = ($checksums -split "`n" | Where-Object { $_ -match '\s+(?:_dist/)?k3d-windows-amd64\.exe\s*$' })
if (-not $checksumLine) { throw 'Could not find the official k3d Windows checksum.' }
$expectedK3d = ($checksumLine.Trim() -split '\s+')[0]
if (-not (Test-Path -LiteralPath $k3dFile)) {
    Invoke-WebRequest "$k3dBase/k3d-windows-amd64.exe" -OutFile $k3dFile
}
if ((Get-FileHash -LiteralPath $k3dFile -Algorithm SHA256).Hash -ne $expectedK3d) {
    throw 'k3d checksum mismatch. Do not execute this file.'
}

$helmVersion = 'v4.3.1'
$helmArchive = Join-Path $downloadDir "helm-$helmVersion-windows-amd64.zip"
$helmUrl = "https://get.helm.sh/helm-$helmVersion-windows-amd64.zip"
$helmChecksums = (Invoke-WebRequest "$helmUrl.sha256sum").Content
if ($helmChecksums -is [byte[]]) { $helmChecksums = [System.Text.Encoding]::UTF8.GetString($helmChecksums) }
$expectedHelm = ($helmChecksums.Trim() -split '\s+')[0]
if (-not (Test-Path -LiteralPath $helmArchive)) {
    Invoke-WebRequest $helmUrl -OutFile $helmArchive
}
if ((Get-FileHash -LiteralPath $helmArchive -Algorithm SHA256).Hash -ne $expectedHelm) {
    throw 'Helm checksum mismatch. Do not extract or execute this archive.'
}
Expand-Archive -LiteralPath $helmArchive -DestinationPath (Join-Path $downloadDir 'helm') -Force
Copy-Item -LiteralPath (Join-Path $downloadDir 'helm/windows-amd64/helm.exe') -Destination (Join-Path $toolsDir 'helm.exe') -Force
& $k3dFile version
if ($LASTEXITCODE -ne 0) { throw 'k3d verification failed.' }
& (Join-Path $toolsDir 'helm.exe') version --short
if ($LASTEXITCODE -ne 0) { throw 'Helm verification failed.' }
