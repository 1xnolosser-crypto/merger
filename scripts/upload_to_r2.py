#!/usr/bin/env python3
"""Upload a finished Merger MP4 to Cloudflare R2 using the S3-compatible API.

Required environment variables:
  R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY,
  R2_BUCKET_NAME, R2_PUBLIC_BASE_URL

The public base URL must point to a public R2 bucket/custom domain.
No credentials are stored in this repository or written to logs.
"""
from __future__ import annotations

import argparse
import mimetypes
import os
import sys
from pathlib import Path
from urllib.parse import quote

def required(name: str) -> str:
    value = os.environ.get(name, "").strip()
    if not value:
        raise SystemExit(f"Missing environment variable: {name}")
    return value

def main() -> int:
    parser = argparse.ArgumentParser(description="Upload a Merger MP4 to Cloudflare R2.")
    parser.add_argument("video", type=Path, help="Path to the finished MP4")
    parser.add_argument("--prefix", default="videos", help="Object key prefix (default: videos)")
    args = parser.parse_args()

    video = args.video.expanduser().resolve()
    if not video.is_file() or video.suffix.lower() != ".mp4":
        raise SystemExit(f"Expected an existing .mp4 file: {video}")
    size = video.stat().st_size
    if size <= 0:
        raise SystemExit("Video file is empty.")

    account = required("R2_ACCOUNT_ID")
    access = required("R2_ACCESS_KEY_ID")
    secret = required("R2_SECRET_ACCESS_KEY")
    bucket = required("R2_BUCKET_NAME")
    base = required("R2_PUBLIC_BASE_URL").rstrip("/")

    try:
        import boto3
        from botocore.config import Config
    except ImportError:
        raise SystemExit("Missing boto3. Install with: py -3.12 -m pip install --user boto3")

    endpoint = f"https://{account}.r2.cloudflarestorage.com"
    # Use a stable object name; quote path segments but preserve separators.
    prefix = args.prefix.strip("/")
    key = "/".join(part for part in (prefix, video.name) if part)
    content_type = mimetypes.guess_type(video.name)[0] or "video/mp4"

    client = boto3.client(
        "s3",
        endpoint_url=endpoint,
        aws_access_key_id=access,
        aws_secret_access_key=secret,
        region_name="auto",
        config=Config(signature_version="s3v4", retries={"max_attempts": 3}),
    )
    print(f"Uploading {video.name} ({size:,} bytes) to R2...")
    client.upload_file(
        str(video), bucket, key,
        ExtraArgs={"ContentType": content_type, "CacheControl": "public, max-age=86400"},
    )
    encoded_key = "/".join(quote(part, safe="") for part in key.split("/"))
    url = f"{base}/{encoded_key}"
    print("UPLOAD_SUCCESS")
    print(f"PUBLIC_URL={url}")
    return 0

if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as exc:
        print(f"Upload failed: {type(exc).__name__}: {exc}", file=sys.stderr)
        raise SystemExit(1)
