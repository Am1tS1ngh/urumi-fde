$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path $PSScriptRoot -Parent
$helm = Join-Path $projectRoot '.local/tools/helm.exe'
$k3d = Join-Path $projectRoot '.local/tools/k3d.exe'
$kubeconfig = Join-Path $projectRoot '.local/kubeconfig'
$chart = Join-Path $projectRoot 'charts/platform'
$values = Join-Path $chart 'values-local.yaml'
foreach ($path in @($helm, $k3d, $kubeconfig)) {
    if (-not (Test-Path -LiteralPath $path)) { throw 'Run the local tool and cluster setup scripts first.' }
}

& (Join-Path $PSScriptRoot 'create-local-secrets.ps1')

# A new tag per deploy makes Kubernetes roll the pods, and keeps the previous
# images around for a Helm rollback.
$tag = 'local-' + (Get-Date -Format 'yyyyMMdd-HHmmss')
$images = [ordered]@{
    gateway = 'gateway'
    dashboard = 'dashboard'
    'woo-mcp' = '.'
    'utils-mcp' = 'mcp-servers/utils'
    'everything-mcp' = 'mcp-servers/everything'
}
$names = @()
foreach ($image in $images.Keys) {
    $name = "urumi/${image}:$tag"
    & docker build -q -t $name (Join-Path $projectRoot $images[$image])
    if ($LASTEXITCODE -ne 0) { throw "Building $image failed." }
    $names += $name
}
& $k3d image import -c urumi @names
if ($LASTEXITCODE -ne 0) { throw 'Importing images into the cluster failed.' }

$overrides = @(
    '--set', "gateway.image=urumi/gateway:$tag",
    '--set', "dashboard.image=urumi/dashboard:$tag",
    '--set', "upstreams.woo.image=urumi/woo-mcp:$tag",
    '--set', "upstreams.utils.image=urumi/utils-mcp:$tag",
    '--set', "upstreams.everything.image=urumi/everything-mcp:$tag"
)

& $helm lint $chart -f $values @overrides
if ($LASTEXITCODE -ne 0) { throw 'Helm lint failed.' }
& $helm upgrade --install platform $chart --kubeconfig $kubeconfig -n urumi-platform -f $values @overrides --dry-run=server | Out-Null
if ($LASTEXITCODE -ne 0) { throw 'Kubernetes rejected the rendered chart.' }

& $helm upgrade --install platform $chart --kubeconfig $kubeconfig -n urumi-platform -f $values @overrides --wait --timeout 6m
if ($LASTEXITCODE -ne 0) { throw 'Platform rollout failed. Check pods and events, or roll back with helm rollback platform.' }
& kubectl --kubeconfig $kubeconfig -n urumi-platform get pods,services,ingress
Write-Host 'Open http://gateway.localhost:8080 and sign in as admin@urumi.local (password: ADMIN_PASSWORD in .local/platform-secrets.env).'
