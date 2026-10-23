$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path $PSScriptRoot -Parent
$helm = Join-Path $projectRoot '.local/tools/helm.exe'
$kubeconfig = Join-Path $projectRoot '.local/kubeconfig'
$chart = Join-Path $projectRoot 'charts/store'
$values = Join-Path $chart 'values-local.yaml'
$secretFile = Join-Path $projectRoot '.local/store-database.env'
if (-not (Test-Path -LiteralPath $helm) -or -not (Test-Path -LiteralPath $kubeconfig)) {
    throw 'Run the local tool and cluster setup scripts first.'
}

function New-LocalPassword {
    $bytes = New-Object byte[] 32
    $generator = [System.Security.Cryptography.RandomNumberGenerator]::Create()
    try { $generator.GetBytes($bytes) } finally { $generator.Dispose() }
    return [Convert]::ToBase64String($bytes)
}

& $helm lint $chart -f $values
if ($LASTEXITCODE -ne 0) { throw 'Helm lint failed.' }
$namespace = & kubectl --kubeconfig $kubeconfig --request-timeout=5s get namespace urumi -o name --ignore-not-found
if ($LASTEXITCODE -ne 0) {
    throw 'Cannot connect to local Kubernetes. Open Docker Desktop and wait for Engine running, then run .\scripts\create-local-cluster.ps1 before retrying. Do not delete the cluster or its volumes.'
}
if (-not $namespace) {
    & kubectl --kubeconfig $kubeconfig create namespace urumi
    if ($LASTEXITCODE -ne 0) { throw 'Namespace creation failed.' }
}

# The setup Job needs the store admin and the adapter's API key.
& (Join-Path $PSScriptRoot 'create-local-secrets.ps1')

$existing = & kubectl --kubeconfig $kubeconfig -n urumi get secret store-database -o name --ignore-not-found
if ($LASTEXITCODE -ne 0) { throw 'Cannot inspect the database Secret.' }
if (-not $existing) {
    # Generate once and reuse. Changing a Secret does not rotate an initialized
    # MySQL user's password: the database must be updated separately.
    if (-not (Test-Path -LiteralPath $secretFile)) {
        $contents = "mysql-password=$(New-LocalPassword)`nmysql-root-password=$(New-LocalPassword)`n"
        [System.IO.File]::WriteAllText($secretFile, $contents, [System.Text.UTF8Encoding]::new($false))
    }
    & kubectl --kubeconfig $kubeconfig -n urumi create secret generic store-database --from-env-file=$secretFile
    if ($LASTEXITCODE -ne 0) { throw 'Secret creation failed.' }
} else {
    Write-Host 'Reusing the existing database Secret; credentials were not rotated.'
}

# Validate against the running API before changing application resources.
& $helm upgrade --install store $chart --kubeconfig $kubeconfig -n urumi -f $values --dry-run=server | Out-Null
if ($LASTEXITCODE -ne 0) { throw 'Kubernetes rejected the rendered chart.' }

& $helm upgrade --install store $chart --kubeconfig $kubeconfig -n urumi -f $values --wait --timeout 8m
if ($LASTEXITCODE -ne 0) { throw 'Store rollout failed. Inspect pods and events; do not delete the PVCs.' }
& kubectl --kubeconfig $kubeconfig -n urumi get deployments,pvc,services,ingress
if ($LASTEXITCODE -ne 0) { throw 'Could not inspect the store resources.' }
Write-Host 'Open http://store.localhost:8080. The setup Job installed WooCommerce; an existing store keeps its content.'
