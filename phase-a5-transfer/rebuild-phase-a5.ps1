# =============================================================================
# rebuild-phase-a5.ps1
# Phase A.5 Patch Reconstruction Script
#
# Purpose:
#   Decodes a Base64-encoded patch file into phase-a5-security-foundation.patch
#   and verifies its integrity via SHA256 checksum and file size.
#
# Usage (PowerShell):
#   .\rebuild-phase-a5.ps1 -InputFile ./phase-a5-security-foundation.patch.b64
#
#   Or simply double-click / run in the same directory as the .b64 file:
#   .\rebuild-phase-a5.ps1
#
# Outputs:
#   phase-a5-security-foundation.patch  (in the same directory as the script)
#
# Safety:
#   This script NEVER applies the patch. It only decodes and verifies.
# =============================================================================

[CmdletBinding()]
param (
    [Parameter(Mandatory = $false)]
    [string]$InputFile = "phase-a5-security-foundation.patch.b64",

    [Parameter(Mandatory = $false)]
    [string]$OutputFile = "phase-a5-security-foundation.patch",

    [Parameter(Mandatory = $false)]
    [string]$ExpectedSha256 = "b0d3cc8cdde0832074d7e44614a03251e10eae61ff6aa4f98e89c91d587c9c32",

    [Parameter(Mandatory = $false)]
    [int]$ExpectedSize = 134331
)

# Determine script directory so relative paths work regardless of CWD
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$inputPath = Join-Path $scriptDir $InputFile
$outputPath = Join-Path $scriptDir $OutputFile

Write-Host "Phase A.5 Patch Reconstruction Script"
Write-Host "======================================"
Write-Host "Input file : $inputPath"
Write-Host "Output file: $outputPath"
Write-Host ""

# -------------------------------------------------------------------------
# Step 1: Verify the input Base64 file exists
# -------------------------------------------------------------------------
if (-not (Test-Path $inputPath)) {
    Write-Error "ERROR: Input Base64 file not found: $inputPath"
    exit 1
}

# -------------------------------------------------------------------------
# Step 2: Read the Base64 content
# -------------------------------------------------------------------------
try {
    $b64Content = Get-Content $inputPath -Raw
}
catch {
    Write-Error "ERROR: Failed to read input file: $inputPath"
    exit 1
}

# Remove any whitespace/newlines that might have been introduced during transfer
$b64Content = $b64Content -replace "\s", ""

if ([string]::IsNullOrWhiteSpace($b64Content)) {
    Write-Error "ERROR: Input Base64 file is empty: $inputPath"
    exit 1
}

# -------------------------------------------------------------------------
# Step 3: Decode Base64 to binary patch
# -------------------------------------------------------------------------
try {
    $patchBytes = [Convert]::FromBase64String($b64Content)
}
catch {
    Write-Error "ERROR: Failed to decode Base64 content. The input file may be corrupt or not valid Base64."
    exit 1
}

# -------------------------------------------------------------------------
# Step 4: Write the decoded patch file
# -------------------------------------------------------------------------
try {
    [System.IO.File]::WriteAllBytes($outputPath, $patchBytes)
}
catch {
    Write-Error "ERROR: Failed to write output file: $outputPath"
    exit 1
}

# -------------------------------------------------------------------------
# Step 5: Verify file size
# -------------------------------------------------------------------------
$actualSize = (Get-Item $outputPath).Length
Write-Host "Decoded file size: $actualSize bytes"
Write-Host "Expected size    : $ExpectedSize bytes"

if ($actualSize -ne $ExpectedSize) {
    Write-Error "ERROR: File size mismatch. Expected $ExpectedSize bytes, got $actualSize bytes."
    exit 1
}

Write-Host "File size verification: PASSED"

# -------------------------------------------------------------------------
# Step 6: Verify SHA256 checksum
# -------------------------------------------------------------------------
try {
    $sha256 = [System.Security.Cryptography.SHA256]::Create()
    $hashBytes = $sha256.ComputeHash([System.IO.File]::ReadAllBytes($outputPath))
    $actualSha256 = ([BitConverter]::ToString($hashBytes) -replace "-", "").ToLower()
}
catch {
    Write-Error "ERROR: Failed to compute SHA256 checksum."
    exit 1
}

Write-Host "Decoded SHA256   : $actualSha256"
Write-Host "Expected SHA256  : $ExpectedSha256"

if ($actualSha256 -ne $ExpectedSha256.ToLower()) {
    Write-Error "ERROR: SHA256 checksum mismatch. Expected $ExpectedSha256, got $actualSha256."
    exit 1
}

Write-Host "SHA256 verification: PASSED"

# -------------------------------------------------------------------------
# Step 7: Success
# -------------------------------------------------------------------------
Write-Host ""
Write-Host "Verification complete. Patch file is ready:"
Write-Host "  $outputPath"
Write-Host ""
Write-Host "To apply the patch (manually, when ready):"
Write-Host "  git apply $OutputFile"
Write-Host ""
Write-Host "WARNING: This script does NOT apply the patch. Apply it manually after review."

exit 0