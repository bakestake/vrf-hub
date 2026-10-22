param(
    [switch]$SkipSbf
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$repoRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$expectedProgramId = '3AUyfXanEHxaFDGviynnoJAHgVLKxBAQP81YB3SMfJkd'
$binaryPath = Join-Path $repoRoot 'target\deploy\bakeland_vrf_hub.so'
$idlPath = Join-Path $repoRoot 'target\idl\bakeland_vrf_hub.json'
$sourcePath = Join-Path $repoRoot 'programs\bakeland-vrf-hub\src\lib.rs'
$anchorConfigPath = Join-Path $repoRoot 'Anchor.toml'
$anchorCli = if ($env:ANCHOR_CLI) { $env:ANCHOR_CLI } else { (Get-Command anchor -ErrorAction Stop).Source }

Push-Location $repoRoot
try {
    cargo test -p bakeland-vrf-hub
    if ($LASTEXITCODE -ne 0) { throw 'Rust tests failed.' }

    cargo clippy -p bakeland-vrf-hub --all-targets -- -D warnings
    if ($LASTEXITCODE -ne 0) { throw 'Strict Clippy validation failed.' }

    if (-not $SkipSbf) {
        cargo build-sbf --manifest-path (Join-Path $repoRoot 'programs\bakeland-vrf-hub\Cargo.toml') --sbf-out-dir (Join-Path $repoRoot 'target\deploy') --optimize-size
        if ($LASTEXITCODE -ne 0) { throw 'Optimized SBF build failed.' }
        & $anchorCli idl build -p bakeland_vrf_hub -o $idlPath
        if ($LASTEXITCODE -ne 0) { throw 'Anchor IDL build failed.' }
    }

    $source = Get-Content -LiteralPath $sourcePath -Raw
    $anchorConfig = Get-Content -LiteralPath $anchorConfigPath -Raw
    if ($source -notmatch [regex]::Escape("declare_id!(`"$expectedProgramId`")")) {
        throw "Source program ID does not match $expectedProgramId."
    }
    if ($anchorConfig -notmatch [regex]::Escape("bakeland_vrf_hub = `"$expectedProgramId`"")) {
        throw "Anchor.toml program ID does not match $expectedProgramId."
    }

    if ($env:PROGRAM_KEYPAIR) {
        $keypairProgramId = (solana-keygen pubkey $env:PROGRAM_KEYPAIR).Trim()
        if ($keypairProgramId -ne $expectedProgramId) {
            throw "Deployment program keypair mismatch: expected $expectedProgramId, got $keypairProgramId"
        }
    }

    if (-not $SkipSbf) {
        if (-not (Test-Path -LiteralPath $binaryPath)) { throw 'SBF binary was not produced.' }
        if (-not (Test-Path -LiteralPath $idlPath)) { throw 'Anchor IDL was not produced.' }
    }

    Write-Host 'Bakeland VRF Hub validation passed.' -ForegroundColor Green
    Write-Host "Program ID: $expectedProgramId"
    if (-not $SkipSbf) {
        Write-Host "Binary: $binaryPath"
        Write-Host "IDL: $idlPath"
    }
}
finally {
    Pop-Location
}
