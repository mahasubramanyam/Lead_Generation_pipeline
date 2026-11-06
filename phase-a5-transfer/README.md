# Phase A.5 Security Foundation — Transfer Package

This directory contains files to transfer the complete Phase A.5 security implementation from the Cline Cloud sandbox to your Windows machine.

## Files in This Directory

| File | Description |
|------|-------------|
| `phase-a5-security-foundation.patch` | Git patch containing all Phase A.5 implementation changes (14 files, ~134 KB) |
| `rebuild-phase-a5.ps1` | PowerShell script to reconstruct and verify the patch on Windows |
| `README.md` | This file |

## Original Patch Metadata

| Property | Value |
|----------|-------|
| Original patch SHA256 | `b0d3cc8cdde0832074d7e44614a03251e10eae61ff6aa4f98e89c91d587c9c32` |
| Original patch size | 134,331 bytes |
| Base commit | `73a4bf7` (`feature/global-lead-saas`) |
| Number of files changed | 14 |

## How to Download from GitHub

These files are committed to the `feature/phase-a5-transfer` branch on GitHub.

**Repository:** `https://github.com/mahasubramanyam/Lead_Generation_pipeline`

**Transfer branch:** `feature/phase-a5-transfer`

**Branch URL:** `https://github.com/mahasubramanyam/Lead_Generation_pipeline/tree/feature/phase-a5-transfer`

**Direct download links:**

- Patch: `https://github.com/mahasubramanyam/Lead_Generation_pipeline/raw/feature/phase-a5-transfer/phase-a5-transfer/phase-a5-security-foundation.patch`
- PowerShell script: `https://github.com/mahasubramanyam/Lead_Generation_pipeline/raw/feature/phase-a5-transfer/phase-a5-transfer/rebuild-phase-a5.ps1`
- README: `https://github.com/mahasubramanyam/Lead_Generation_pipeline/raw/feature/phase-a5-transfer/phase-a5-transfer/README.md`

To download individual files, click the links above or use the GitHub web interface to download the entire branch as a ZIP.

## How to Verify and Reconstruct on Windows

### Prerequisites
- Windows PowerShell 5.1 or later
- Git installed (for applying the patch)

### Step 1: Download the Files

Download `phase-a5-security-foundation.patch.b64` and `rebuild-phase-a5.ps1` from the GitHub links above, OR download the raw patch file directly:

```
https://github.com/mahasubramanyam/Lead_Generation_pipeline/raw/feature/phase-a5-transfer/phase-a5-transfer/phase-a5-security-foundation.patch
```

### Step 2: Reconstruct the Patch (using the PS1 script)

If you downloaded the Base64-encoded file:

```powershell
# Run from the same directory as the .b64 file
.\rebuild-phase-a5.ps1 -InputFile ./phase-a5-security-foundation.patch.b64
```

The script will:
1. Decode the Base64 content into `phase-a5-security-foundation.patch`
2. Verify the decoded file size is exactly 134,331 bytes
3. Verify the SHA256 checksum matches `b0d3cc8cdde0832074d7e44614a03251e10eae61ff6aa4f98e89c91d587c9c32`
4. Stop with a clear error if either verification fails

### Step 3: Verify the Patch

After reconstruction, verify the patch file:

```powershell
# Verify SHA256
Get-FileHash phase-a5-security-foundation.patch -Algorithm SHA256
# Expected: B0D3CC8CDDE0832074D7E44614A03251E10EAE61FF6AA4F98E89C91D587C9C32

# Verify size
(Get-Item phase-a5-security-foundation.patch).Length
# Expected: 134331 bytes
```

### Step 4: Apply the Patch (Manual Step Only)

The patch must be applied to base commit `73a4bf7` of `feature/global-lead-saas`.

```powershell
# On your Windows machine, in the Lead_Generation_pipeline repository:
git checkout feature/global-lead-saas
git apply phase-a5-security-foundation.patch
```

**Important:** The script does NOT apply the patch automatically. You must apply it manually after reviewing the changes.

## Patch Contents Summary

The patch adds the following Phase A.5 components:

1. **AES-256-GCM credential encryption** — `encryptCredential` / `decryptCredential` helpers with per-tenant AAD binding
2. **Versioned encryption keys + rotation** — HKDF key derivation, key versioning, `encryption_keys` table
3. **Tenant-scoped credential storage** — `tenant_credentials` table, `/api/credentials/*` API endpoints
4. **Provider credential validation** — `/api/credentials/:id/validate` endpoint with SSRF protection
5. **Complete RBAC + membership lifecycle** — `tenant_memberships` table, `/api/tenants/:tenantId/members/*` API
6. **Tenant invitations** — `tenant_invitations` table, `/api/tenants/:tenantId/invitations/*` and `/api/invitations/*` API
7. **Secret-safe audit logging** — `audit_log` table, `sanitizeMetadata` helper for secret redaction
8. **CI test database isolation** — `lead_pipeline_test` database, ephemeral test secrets
9. **Fail-closed test configuration** — `NODE_ENV=test` guard preventing production DB access
10. **Correct server startup** — `isMainModule` detection replacing `NODE_ENV !== "test"` guard

## Important Notes

- **Base commit:** The patch must be applied to commit `73a4bf7` of `feature/global-lead-saas`.
- **Do not apply on `main`:** This branch is based on `feature/global-lead-saas`, not `main`.
- **No secrets included:** No production credentials or secrets are included in this transfer package.
- **Patch only:** This transfer branch contains only the three transfer files. It does not contain the full Phase A.5 implementation source code.
- **Manual application required:** The reconstruction script verifies the patch but does not apply it. You must run `git apply` manually after review.
