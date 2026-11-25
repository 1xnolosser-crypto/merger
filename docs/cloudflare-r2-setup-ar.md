# Cloudflare R2 upload setup (Merger)

This optional step uploads the locally rendered MP4 to a public Cloudflare R2 bucket so Metricool can fetch it by URL. Video rendering remains local. Agnes, paid generation APIs, and cloud rendering are not used.

## One-time Cloudflare setup

1. Create/sign in to a Cloudflare account and open **R2 Object Storage**.
2. Create a bucket, for example `vyrox-videos`.
3. Create an R2 API token scoped to this bucket with **Object Read & Write**. Copy the Access Key ID and Secret Access Key once; never commit them or send them in chat.
4. Enable public access using an R2.dev URL (if available for the account) or preferably attach a custom domain. Keep the bucket limited to video assets intended for public publication.
5. Note the Account ID, bucket name, and public base URL.

R2 has a free monthly allowance, not an unconditional lifetime guarantee. Check the current Cloudflare pricing/usage page and set budget/usage alerts. Do not enable paid add-ons or exceed free allowances without explicit approval.

## Configure Windows PowerShell

Set these in the current PowerShell session (replace placeholders locally; do not paste secrets into ChatGPT or GitHub):

```powershell
$env:R2_ACCOUNT_ID = "YOUR_ACCOUNT_ID"
$env:R2_ACCESS_KEY_ID = "YOUR_ACCESS_KEY_ID"
$env:R2_SECRET_ACCESS_KEY = "YOUR_SECRET_ACCESS_KEY"
$env:R2_BUCKET_NAME = "vyrox-videos"
$env:R2_PUBLIC_BASE_URL = "https://YOUR_PUBLIC_BUCKET_DOMAIN"
```

Install the small S3 client dependency once:

```powershell
py -3.12 -m pip install --user boto3
```

Upload a finished MP4:

```powershell
py -3.12 scripts/upload_to_r2.py "C:\MergerFreeVideo\media-output\رحلة-قطرة-ماء\رحلة-قطرة-ماء-shorts.mp4"
```

The script prints `PUBLIC_URL=...` only after the upload succeeds. Test that URL in a private browser window; Metricool must be able to fetch it without authentication.

## Security and publishing boundary

- Never commit R2 credentials, put them in project JSON, or include them in logs.
- Use a bucket dedicated to publishable media, not private documents.
- The uploader does not publish or schedule anything by itself. A successful public URL is the input for the connected Metricool scheduling workflow.
- Automatic scheduling from a local Windows process requires an authorized publishing endpoint/connection. The Metricool connected action in ChatGPT can schedule a post from a public media URL; do not assume the free Metricool plan exposes its public API for arbitrary local scripts.
- Verify the video and platform-specific SEO text before scheduling. No post is considered published until Metricool confirms the scheduled/published state.
