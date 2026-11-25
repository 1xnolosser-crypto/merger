#!/usr/bin/env python3
"""ImageKit Media Library client for the local Merger video workflow.

The private key is read only from IMAGEKIT_PRIVATE_KEY. It is never printed,
written to disk, or included in command-line arguments.
"""
from __future__ import annotations

import argparse
import base64
import json
import mimetypes
import os
import sys
import urllib.error
import urllib.parse
import urllib.request
import uuid
from pathlib import Path
from typing import Any

API_BASE = "https://api.imagekit.io/v1"
UPLOAD_URL = "https://upload.imagekit.io/api/v1/files/upload"
USER_AGENT = "Merger-ImageKit-Media-Library/1.0"


class ImageKitError(RuntimeError):
    pass


def credentials() -> tuple[str, str]:
    key = os.environ.get("IMAGEKIT_PRIVATE_KEY", "").strip()
    if not key:
        raise ImageKitError(
            "IMAGEKIT_PRIVATE_KEY is not configured. Run scripts\\setup-imagekit.ps1 once."
        )
    if not key.startswith("private_"):
        raise ImageKitError("IMAGEKIT_PRIVATE_KEY does not look like an ImageKit private key.")
    return key, "Basic " + base64.b64encode((key + ":").encode("utf-8")).decode("ascii")


def request_json(url: str, method: str = "GET", body: bytes | None = None,
                 content_type: str | None = None) -> Any:
    _, auth = credentials()
    headers = {"Authorization": auth, "Accept": "application/json", "User-Agent": USER_AGENT}
    if content_type:
        headers["Content-Type"] = content_type
    request = urllib.request.Request(url, data=body, headers=headers, method=method)
    try:
        with urllib.request.urlopen(request, timeout=180) as response:
            raw = response.read()
            return json.loads(raw.decode("utf-8")) if raw else {}
    except urllib.error.HTTPError as exc:
        detail = exc.read().decode("utf-8", "replace")
        try:
            parsed = json.loads(detail)
            detail = str(parsed.get("message") or parsed.get("help") or detail)
        except Exception:
            pass
        raise ImageKitError(f"ImageKit returned HTTP {exc.code}: {detail[:1200]}") from None
    except urllib.error.URLError as exc:
        raise ImageKitError(f"ImageKit request failed: {exc.reason}") from None


def list_files(limit: int, skip: int, path: str | None, search: str | None,
               file_type: str) -> Any:
    params: dict[str, str] = {"limit": str(limit), "skip": str(skip), "type": "file"}
    if path:
        params["path"] = path
    if search:
        params["searchQuery"] = search
    if file_type != "all":
        params["fileType"] = file_type
    url = API_BASE + "/files?" + urllib.parse.urlencode(params)
    return request_json(url)


def upload_file(file_path: Path, folder: str, tags: list[str], overwrite: bool) -> Any:
    file_path = file_path.expanduser().resolve()
    if not file_path.is_file():
        raise ImageKitError(f"File not found: {file_path}")
    boundary = "----MergerImageKit" + uuid.uuid4().hex
    chunks: list[bytes] = []

    def field(name: str, value: str) -> None:
        chunks.extend([
            f"--{boundary}\r\n".encode(),
            f'Content-Disposition: form-data; name="{name}"\r\n\r\n'.encode(),
            value.encode("utf-8"),
            b"\r\n",
        ])

    mime = mimetypes.guess_type(file_path.name)[0] or "application/octet-stream"
    field("fileName", file_path.name)
    field("useUniqueFileName", "true" if not overwrite else "false")
    field("overwriteFile", "true" if overwrite else "false")
    if folder:
        field("folder", folder)
    for tag in tags:
        field("tags[]", tag)
    chunks.extend([
        f"--{boundary}\r\n".encode(),
        f'Content-Disposition: form-data; name="file"; filename="{file_path.name}"\r\n'.encode(),
        f"Content-Type: {mime}\r\n\r\n".encode(),
    ])
    with file_path.open("rb") as stream:
        while True:
            block = stream.read(1024 * 1024)
            if not block:
                break
            chunks.append(block)
    chunks.extend([b"\r\n", f"--{boundary}--\r\n".encode()])
    body = b"".join(chunks)
    return request_json(
        UPLOAD_URL, method="POST", body=body,
        content_type=f"multipart/form-data; boundary={boundary}",
    )


def main() -> int:
    parser = argparse.ArgumentParser(description="Manage the ImageKit Media Library.")
    sub = parser.add_subparsers(dest="command", required=True)

    listing = sub.add_parser("list", help="List files in the Media Library.")
    listing.add_argument("--limit", type=int, default=100)
    listing.add_argument("--skip", type=int, default=0)
    listing.add_argument("--path")
    listing.add_argument("--file-type", choices=("all", "image", "non-image"), default="all")

    searching = sub.add_parser("search", help="Search the Media Library using ImageKit search syntax.")
    searching.add_argument("query")
    searching.add_argument("--limit", type=int, default=100)
    searching.add_argument("--skip", type=int, default=0)

    uploading = sub.add_parser("upload", help="Upload a local file to the Media Library.")
    uploading.add_argument("file")
    uploading.add_argument("--folder", default="/VYROX")
    uploading.add_argument("--tag", action="append", default=[])
    uploading.add_argument("--overwrite", action="store_true")

    args = parser.parse_args()
    try:
        if args.command == "list":
            result = list_files(max(1, min(args.limit, 1000)), max(0, args.skip),
                                args.path, None, args.file_type)
        elif args.command == "search":
            result = list_files(max(1, min(args.limit, 1000)), max(0, args.skip),
                                None, args.query, "all")
        else:
            result = upload_file(Path(args.file), args.folder, args.tag, args.overwrite)
        print(json.dumps(result, ensure_ascii=False, indent=2))
        return 0
    except ImageKitError as exc:
        print("IMAGEKIT_ERROR: " + str(exc), file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
