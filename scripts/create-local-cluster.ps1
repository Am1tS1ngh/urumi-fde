$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path $PSScriptRoot -Parent
$k3d = Join-Path $projectRoot '.local/tools/k3d.exe'
$kubeconfig = Join-Path $projectRoot '.local/kubeconfig'
. (Join-Path $PSScriptRoot 'lib/find-k3d-cluster.ps1')
if (-not (Test-Path -LiteralPath $k3d)) {
    throw 'Run scripts/install-local-tools.ps1 first.'
}
Get-Command docker, kubectl -ErrorAction Stop | Out-Null
& docker info --format '{{.ServerVersion}}'
if ($LASTEXITCODE -ne 0) { throw 'Docker Linux engine must be running first.' }

$clusterJson = & $k3d cluster list -o json
if ($LASTEXITCODE -ne 0) { throw 'Could not inspect existing k3d clusters.' }
$existing = Find-K3dCluster -Json ($clusterJson -join "`n") -Name 'urumi'
if ($existing) {
    Write-Host 'The urumi cluster already exists; preserving it and its data.'
    & $k3d cluster start urumi --wait --timeout 120s
    if ($LASTEXITCODE -ne 0) { throw 'Existing cluster could not start.' }
} else {
    $existingNodes = & docker ps -a --filter 'label=k3d.cluster=urumi' --format '{{.Names}}'
    if ($LASTEXITCODE -ne 0) { throw 'Could not inspect existing cluster containers.' }
    if ($existingNodes) {
        throw 'Existing urumi containers were found but cluster discovery failed. Refusing to create a replacement cluster. Inspect k3d cluster list and Docker context.'
    }
    foreach ($port in @(6550, 8080, 8443)) {
        if (Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue) {
            throw "Port $port is already occupied. Resolve the conflict before creating the cluster."
        }
    }
    # Docker Desktop on some WSL2 kernels still uses cgroup v1, which recent
    # kubelets refuse by default.
    $extraArgs = @()
    if ((& docker info --format '{{.CgroupVersion}}') -eq '1') {
        $extraArgs = @('--k3s-arg', '--kubelet-arg=fail-cgroupv1=false@server:*')
    }
    # One node keeps the local learning environment small. This is not HA.
    # Only loopback ports are published; the LAN cannot connect to these ports.
    & $k3d cluster create urumi @extraArgs `
        --image rancher/k3s:v1.35.5-k3s1 `
        --servers 1 --agents 0 `
        --api-port '127.0.0.1:6550' `
        --port '127.0.0.1:8080:80@loadbalancer' `
        --port '127.0.0.1:8443:443@loadbalancer' `
        --kubeconfig-update-default=false `
        --kubeconfig-switch-context=false `
        --wait --timeout 180s
    if ($LASTEXITCODE -ne 0) { throw 'Cluster creation failed. Inspect k3d output before retrying.' }
}

# Keep cluster-admin credentials in the ignored project directory, never in Git.
# Explicit --kubeconfig commands avoid changing the user's global context.
$configText = & $k3d kubeconfig get urumi
if ($LASTEXITCODE -ne 0) { throw 'Could not read the cluster kubeconfig.' }
[System.IO.File]::WriteAllText($kubeconfig, ($configText -join "`n") + "`n", [System.Text.UTF8Encoding]::new($false))
& kubectl --kubeconfig $kubeconfig wait --for=condition=Ready nodes --all --timeout=120s
if ($LASTEXITCODE -ne 0) { throw 'The Kubernetes node did not become Ready.' }
& kubectl --kubeconfig $kubeconfig get nodes -o wide
if ($LASTEXITCODE -ne 0) { throw 'Could not read cluster nodes.' }
Write-Host 'Cluster ready. Application workloads have not been installed by this script.'
