param([string]$Python = 'python')
$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path $PSScriptRoot -Parent
$kubeconfig = Join-Path $projectRoot '.local/kubeconfig'
& kubectl --kubeconfig $kubeconfig --request-timeout=5s -n urumi get namespace urumi -o name
if ($LASTEXITCODE -ne 0) { throw 'Start Docker and the existing local cluster first.' }
& $Python (Join-Path $PSScriptRoot 'create-local-certificates.py')
if ($LASTEXITCODE -ne 0) { throw 'Certificate generation failed. Python needs the cryptography package.' }
$certificate = Join-Path $projectRoot '.local/tls/server.crt'
$privateKey = Join-Path $projectRoot '.local/tls/server.key'
# Only filenames enter process arguments. Private key bytes are never logged.
$secret = & kubectl --kubeconfig $kubeconfig -n urumi create secret tls store-local-tls --cert=$certificate --key=$privateKey --dry-run=client -o json
if ($LASTEXITCODE -ne 0) { throw 'Could not prepare the local TLS Secret.' }
$secret | & kubectl --kubeconfig $kubeconfig -n urumi apply -f -
if ($LASTEXITCODE -ne 0) { throw 'Could not provision the local TLS Secret.' }
& (Join-Path $projectRoot '.local/tools/helm.exe') upgrade --install store (Join-Path $projectRoot 'charts/store') --kubeconfig $kubeconfig -n urumi -f (Join-Path $projectRoot 'charts/store/values-local.yaml') --wait --timeout 5m
if ($LASTEXITCODE -ne 0) { throw 'Helm upgrade failed; inspect the existing resources.' }
Write-Host 'Local API endpoint: https://localhost:8443. The adapter must trust .local/tls/ca.crt.'
