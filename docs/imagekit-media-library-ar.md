# ImageKit Media Library integration (Windows)

This integration connects the local VYROX video workflow to the ImageKit Media Library.

## What it does

- Uploads the finished MP4 directly from Windows to ImageKit.
- Streams the upload in 1 MiB chunks to avoid loading a large video into RAM.
- Supports listing and searching assets from the same client.
- Prints the public CDN URL and ImageKit file ID after a successful upload.
- Keeps the private API key outside the repository.

## One-time account setup

1. In ImageKit, open Developer Options → API Keys.
2. Create a restricted key with **Media management: Read and write**. This is sufficient for uploads and library management; do not grant account-management permissions.
3. Run `scripts/setup-imagekit.ps1` in Windows PowerShell. Enter the private key at the secure prompt. It is saved in the current Windows user's environment variables, not in a project file.
4. Restart any already-open terminal or bridge process if it needs to inherit the saved user environment.

Never paste the private key into ChatGPT, GitHub issues, source files, or logs.

## Commands

List files:

`py -3.12 scripts\imagekit_media_library.py list --limit 100`

List one folder:

`py -3.12 scripts\imagekit_media_library.py list --path /VYROX/Shorts --limit 100`

Search:

`py -3.12 scripts\imagekit_media_library.py search "name:رحلة"`

Upload:

`py -3.12 scripts\imagekit_media_library.py upload "C:\path\video.mp4" --folder "/VYROX/Shorts" --tag VYROX --tag Shorts`

The normal production launcher now uploads the final rendered MP4 automatically after local rendering. If the upload fails, the local MP4 is preserved and the launcher reports the error.

## Free-plan safeguards

The integration does not create or upgrade a subscription. ImageKit may enforce plan-specific file-size, storage, bandwidth, or request limits. A rejected upload is reported and is not retried against a paid service.
