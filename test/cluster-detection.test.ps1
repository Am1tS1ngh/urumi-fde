$ErrorActionPreference = 'Stop'
. (Join-Path (Split-Path $PSScriptRoot -Parent) 'scripts/lib/find-k3d-cluster.ps1')

$cases = @(
    @{ Json = '[]'; Expected = $null },
    @{ Json = '[{"name":"urumi","serversCount":1}]'; Expected = 'urumi' },
    @{ Json = '[{"name":"other"},{"name":"urumi"},{"name":"third"}]'; Expected = 'urumi' },
    @{ Json = '[{"name":"other"}]'; Expected = $null }
)
foreach ($case in $cases) {
    $found = Find-K3dCluster -Json $case.Json -Name 'urumi'
    if ($case.Expected -eq $null) {
        if ($null -ne $found) { throw 'Incorrectly detected a nonexistent urumi cluster.' }
    } elseif ($null -eq $found -or $found.name -ne $case.Expected) {
        throw 'Failed to detect the existing urumi cluster.'
    }
}
Write-Host "PASS: 4 cluster detection cases in PowerShell $($PSVersionTable.PSVersion)"
