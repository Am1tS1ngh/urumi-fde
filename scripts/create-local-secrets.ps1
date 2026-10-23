param(
    # Optional. Saved with the other values, so later runs keep it.
    [string]$LlmApiKey = ''
)
$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path $PSScriptRoot -Parent
$kubeconfig = Join-Path $projectRoot '.local/kubeconfig'
$valuesFile = Join-Path $projectRoot '.local/platform-secrets.env'
if (-not (Test-Path -LiteralPath $kubeconfig)) { throw 'Run scripts/create-local-cluster.ps1 first.' }

function New-RandomHex([int]$Bytes) {
    $buffer = New-Object byte[] $Bytes
    $generator = [System.Security.Cryptography.RandomNumberGenerator]::Create()
    try { $generator.GetBytes($buffer) } finally { $generator.Dispose() }
    return -join ($buffer | ForEach-Object { $_.ToString('x2') })
}

function New-RandomBase64([int]$Bytes) {
    $buffer = New-Object byte[] $Bytes
    $generator = [System.Security.Cryptography.RandomNumberGenerator]::Create()
    try { $generator.GetBytes($buffer) } finally { $generator.Dispose() }
    return [Convert]::ToBase64String($buffer)
}

# Values are generated once and reused. The database keeps its first password and the
# encryption key protects stored credentials, so neither may change on a later run.
$values = [ordered]@{}
if (Test-Path -LiteralPath $valuesFile) {
    foreach ($line in [System.IO.File]::ReadAllLines($valuesFile)) {
        $index = $line.IndexOf('=')
        if ($index -gt 0) { $values[$line.Substring(0, $index)] = $line.Substring($index + 1) }
    }
}
$defaults = [ordered]@{
    POSTGRES_PASSWORD = { New-RandomHex 24 }
    GATEWAY_ENCRYPTION_KEY = { New-RandomBase64 32 }
    ADMIN_PASSWORD = { New-RandomHex 12 }
    MCP_UPSTREAM_TOKEN = { New-RandomHex 32 }
    UTILS_MCP_API_KEY = { New-RandomHex 24 }
    WOOCOMMERCE_CONSUMER_KEY = { 'ck_' + (New-RandomHex 20) }
    WOOCOMMERCE_CONSUMER_SECRET = { 'cs_' + (New-RandomHex 20) }
    STORE_ADMIN_USER = { 'admin' }
    STORE_ADMIN_PASSWORD = { New-RandomHex 12 }
    STORE_ADMIN_EMAIL = { 'admin@urumi.local' }
}
foreach ($name in $defaults.Keys) {
    if (-not $values.Contains($name)) { $values[$name] = & $defaults[$name] }
}
if ($LlmApiKey) { $values['LLM_API_KEY'] = $LlmApiKey }

$lines = foreach ($name in $values.Keys) { "$name=$($values[$name])" }
[System.IO.File]::WriteAllText($valuesFile, ($lines -join "`n") + "`n", [System.Text.UTF8Encoding]::new($false))

function Set-Namespace([string]$Name) {
    $found = & kubectl --kubeconfig $kubeconfig get namespace $Name -o name --ignore-not-found
    if ($LASTEXITCODE -ne 0) { throw 'Cannot reach the cluster.' }
    if (-not $found) {
        & kubectl --kubeconfig $kubeconfig create namespace $Name | Out-Null
        if ($LASTEXITCODE -ne 0) { throw "Could not create namespace $Name." }
    }
}

# Creates the Secret, or updates it in place when it already exists.
function Set-Secret([string]$Namespace, [string]$Name, [System.Collections.IDictionary]$Data) {
    $arguments = @('--kubeconfig', $kubeconfig, '-n', $Namespace, 'create', 'secret', 'generic', $Name, '--dry-run=client', '-o', 'yaml')
    foreach ($key in $Data.Keys) { $arguments += "--from-literal=$key=$($Data[$key])" }
    $manifest = & kubectl @arguments
    if ($LASTEXITCODE -ne 0) { throw "Could not build Secret $Name." }
    $manifest | & kubectl --kubeconfig $kubeconfig apply -f - | Out-Null
    if ($LASTEXITCODE -ne 0) { throw "Could not apply Secret $Name." }
    Write-Host "Secret $Namespace/$Name is up to date."
}

Set-Namespace 'urumi'
Set-Namespace 'urumi-platform'

$gateway = [ordered]@{
    POSTGRES_PASSWORD = $values['POSTGRES_PASSWORD']
    GATEWAY_ENCRYPTION_KEY = $values['GATEWAY_ENCRYPTION_KEY']
    ADMIN_PASSWORD = $values['ADMIN_PASSWORD']
}
if ($values.Contains('LLM_API_KEY')) { $gateway['LLM_API_KEY'] = $values['LLM_API_KEY'] }
Set-Secret 'urumi-platform' 'gateway' $gateway
Set-Secret 'urumi-platform' 'woo-mcp' ([ordered]@{
    WOOCOMMERCE_CONSUMER_KEY = $values['WOOCOMMERCE_CONSUMER_KEY']
    WOOCOMMERCE_CONSUMER_SECRET = $values['WOOCOMMERCE_CONSUMER_SECRET']
    MCP_UPSTREAM_TOKEN = $values['MCP_UPSTREAM_TOKEN']
})
Set-Secret 'urumi-platform' 'utils-mcp' ([ordered]@{ UTILS_MCP_API_KEY = $values['UTILS_MCP_API_KEY'] })
Set-Secret 'urumi' 'store-setup' ([ordered]@{
    'admin-user' = $values['STORE_ADMIN_USER']
    'admin-password' = $values['STORE_ADMIN_PASSWORD']
    'admin-email' = $values['STORE_ADMIN_EMAIL']
    'consumer-key' = $values['WOOCOMMERCE_CONSUMER_KEY']
    'consumer-secret' = $values['WOOCOMMERCE_CONSUMER_SECRET']
})
Write-Host "Saved generated values in $valuesFile. Gateway admin password: ADMIN_PASSWORD in that file."
