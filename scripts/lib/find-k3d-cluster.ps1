function Find-K3dCluster {
    param(
        [Parameter(Mandatory = $true)][string]$Json,
        [Parameter(Mandatory = $true)][string]$Name
    )
    # Windows PowerShell 5.1 can emit a JSON array as one pipeline object.
    # Explicit iteration works in both 5.1 and 7, including a single cluster.
    $clusters = ConvertFrom-Json -InputObject $Json -ErrorAction Stop
    foreach ($cluster in $clusters) {
        if ($cluster.name -eq $Name) { return $cluster }
    }
    return $null
}
