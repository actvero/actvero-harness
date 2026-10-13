---
kind: upgrade-guide
description: "Early ACTVERO desktop builds need encrypted-data migration from display-name keychain identities to the stable applicationId."
---
# ACTVERO encrypted storage identity

English | [中文](guide.zh.md)

## Change

ACTVERO builds use `product.applicationId` as Electron's system-encryption identity. `product.displayName` remains visible branding and no longer selects a keychain namespace. Official DSH builds are unchanged. On macOS, encrypted files from early ACTVERO builds using the package name or display name cannot be read under the new identity without migration. User-data paths and file formats are unchanged.

## Migration

1. Keep `product.id` and `product.applicationId` unchanged in `actvero/product.json` or the selected build configuration. Before replacing an early build, stop the application and retain a private backup of its Electron user-data directory, including `actvero-device-account.enc` and `actvero-capabilities/`. Keep the original system keychain entries.
2. For an affected development profile, have its maintainer explicitly decrypt the known files using that profile's original application key and re-encrypt them with Electron safeStorage under the new `applicationId`. Preserve the original ciphertext first; plaintext stays in memory. Do not clear MCP configuration, copy another application's credentials or remove keychain entries to bypass an error. This is an explicit migration, not an automatic import of the previous desktop's profile.
3. Start the same profile. Confirm the saved account and organization, open My MCP servers and summon a local expert. A changed display name must retain these saved configurations. If migration is unavailable, keep the original encrypted files and previous build available until they can be recovered; signing in again does not recover local MCP credentials.
