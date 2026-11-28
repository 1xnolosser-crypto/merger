#!/usr/bin/env python3
"""ImageKit Media Library client for the local Merger video workflow.

The private key is read only from IMAGEKIT_PRIVATE_KEY. It is never printed,
written to disk, or included in command-line arguments.
"""
from __future__ import annotations

import argparse
import base64
import http.client
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


def api_json(method: str, endpoint: str, payload: dict[str, Any] | None = None) -> Any:
    body = json.dumps(payload, ensure_ascii=False).encode("utf-8") if payload is not None else None
    return request_json(API_BASE + endpoint, method=method, body=body,
                        content_type="application/json" if body is not None else None)


def list_files(limit: int, skip: int, path: str | None, search: str | None,
               file_type: str, asset_type: str = "all") -> Any:
    params: dict[str, str] = {"limit": str(limit), "skip": str(skip), "type": asset_type}
    if path:
        params["path"] = path
    if search:
        params["searchQuery"] = search
    if file_type != "all":
        params["fileType"] = file_type
    url = API_BASE + "/files?" + urllib.parse.urlencode(params)
    return request_json(url)


def file_details(file_id: str) -> Any:
    return api_json("GET", "/files/" + urllib.parse.quote(file_id, safe="") + "/details")


def update_file_details(file_id: str, payload: dict[str, Any]) -> Any:
    allowed = {"tags", "customMetadata", "customCoordinates", "description", "publish"}
    if not payload or not set(payload).issubset(allowed):
        raise ImageKitError("Update accepts only tags, customMetadata, customCoordinates, description, publish.")
    if "publish" in payload and len(payload) != 1:
        raise ImageKitError("ImageKit requires publish to be the only field in an update request.")
    return api_json("PATCH", "/files/" + urllib.parse.quote(file_id, safe="") + "/details", payload)


def delete_file(file_id: str) -> Any:
    return api_json("DELETE", "/files/" + urllib.parse.quote(file_id, safe=""))


def copy_file(source_path: str, destination_path: str, include_versions: bool = False) -> Any:
    if not source_path.startswith("/") or not destination_path.startswith("/"):
        raise ImageKitError("ImageKit file paths must begin with /.")
    return api_json("POST", "/files/copy", {"sourceFilePath": source_path, "destinationPath": destination_path, "includeFileVersions": include_versions})


def move_file(source_path: str, destination_path: str) -> Any:
    if not source_path.startswith("/") or not destination_path.startswith("/"):
        raise ImageKitError("ImageKit file paths must begin with /.")
    return api_json("POST", "/files/move", {"sourceFilePath": source_path, "destinationPath": destination_path})


def rename_file(file_path: str, new_name: str, purge_cache: bool = False) -> Any:
    if not file_path.startswith("/") or not new_name.strip():
        raise ImageKitError("A full file path beginning with / and a new filename are required.")
    return api_json("PUT", "/files/rename", {"filePath": file_path, "newFileName": new_name.strip(), "purgeCache": purge_cache})


def upload_file(file_path: Path, folder: str, tags: list[str], overwrite: bool) -> Any:
    """Stream the video in 1 MiB chunks so large uploads do not consume extra RAM."""
    file_path = file_path.expanduser().resolve()
    if not file_path.is_file():
        raise ImageKitError(f"File not found: {file_path}")
    key, _ = credentials()
    boundary = "----MergerImageKit" + uuid.uuid4().hex
    mime = mimetypes.guess_type(file_path.name)[0] or "application/octet-stream"

    def form_field(name: str, value: str) -> bytes:
        safe_name = name.replace('"', "")
        return (
            f"--{boundary}\r\n"
            f'Content-Disposition: form-data; name="{safe_name}"\r\n\r\n'
            f"{value}\r\n"
        ).encode("utf-8")

    fields = [
        form_field("fileName", file_path.name),
        form_field("useUniqueFileName", "true" if not overwrite else "false"),
        form_field("overwriteFile", "true" if overwrite else "false"),
        form_field("isPrivateFile", "false"),
        form_field("isPublished", "true"),
    ]
    if folder:
        fields.append(form_field("folder", folder))
    if tags:
        fields.append(form_field("tags", json.dumps(tags, ensure_ascii=False)))

    filename = file_path.name.replace('"', "")
    file_header = (
        f"--{boundary}\r\n"
        f'Content-Disposition: form-data; name="file"; filename="{filename}"\r\n'
        f"Content-Type: {mime}\r\n\r\n"
    ).encode("utf-8")
    closing = f"\r\n--{boundary}--\r\n".encode("ascii")
    file_size = file_path.stat().st_size
    content_length = sum(len(item) for item in fields) + len(file_header) + file_size + len(closing)
    auth = base64.b64encode((key + ":").encode("utf-8")).decode("ascii")
    connection = http.client.HTTPSConnection("upload.imagekit.io", timeout=300)
    try:
        connection.putrequest("POST", "/api/v1/files/upload")
        connection.putheader("Authorization", "Basic " + auth)
        connection.putheader("Accept", "application/json")
        connection.putheader("User-Agent", USER_AGENT)
        connection.putheader("Content-Type", f"multipart/form-data; boundary={boundary}")
        connection.putheader("Content-Length", str(content_length))
        connection.endheaders()
        for item in fields:
            connection.send(item)
        connection.send(file_header)
        with file_path.open("rb") as stream:
            while True:
                block = stream.read(1024 * 1024)
                if not block:
                    break
                connection.send(block)
        connection.send(closing)
        response = connection.getresponse()
        raw = response.read()
        text = raw.decode("utf-8", "replace")
        if response.status < 200 or response.status >= 300:
            try:
                payload = json.loads(text)
                detail = str(payload.get("message") or payload.get("help") or text)
            except Exception:
                detail = text
            request_id = response.getheader("x-ik-requestId")
            suffix = f" (request ID: {request_id})" if request_id else ""
            raise ImageKitError(f"ImageKit returned HTTP {response.status}: {detail[:1200]}{suffix}")
        return json.loads(text) if text else {}
    except (OSError, http.client.HTTPException) as exc:
        raise ImageKitError(f"ImageKit upload connection failed: {exc}") from None
    finally:
        connection.close()


def main() -> int:
    parser = argparse.ArgumentParser(description="Manage the ImageKit Media Library.")
    sub = parser.add_subparsers(dest="command", required=True)

    listing = sub.add_parser("list", help="List files in the Media Library.")
    listing.add_argument("--limit", type=int, default=100)
    listing.add_argument("--skip", type=int, default=0)
    listing.add_argument("--path")
    listing.add_argument("--file-type", choices=("all", "image", "non-image"), default="all")
    listing.add_argument("--type", dest="asset_type", choices=("file", "file-version", "folder", "all"), default="all")

    searching = sub.add_parser("search", help="Search the Media Library using ImageKit search syntax.")
    searching.add_argument("query")
    searching.add_argument("--limit", type=int, default=100)
    searching.add_argument("--skip", type=int, default=0)

    uploading = sub.add_parser("upload", help="Upload a local file to the Media Library.")
    uploading.add_argument("file")
    uploading.add_argument("--folder", default="/VYROX")
    uploading.add_argument("--tag", action="append", default=[])
    uploading.add_argument("--overwrite", action="store_true")

    details = sub.add_parser("details", help="Get complete details for a file ID.")
    details.add_argument("file_id")

    updating = sub.add_parser("update", help="Update tags, description metadata, or publication state.")
    updating.add_argument("file_id")
    updating.add_argument("--tags", help="Comma-separated replacement tag list.")
    updating.add_argument("--custom-metadata", help="JSON object for custom metadata fields.")
    updating.add_argument("--description", help="Asset description text.")
    updating.add_argument("--published", choices=("true", "false"), help="Publish or unpublish the asset.")
    updating.add_argument("--include-versions", action="store_true", help="Apply publication status to every version.")

    deleting = sub.add_parser("delete", help="Permanently delete a file and all its versions.")
    deleting.add_argument("file_id")

    copying = sub.add_parser("copy", help="Copy a file to another Media Library folder.")
    copying.add_argument("source_file_path")
    copying.add_argument("destination_path")
    copying.add_argument("--include-versions", action="store_true")

    moving = sub.add_parser("move", help="Move a file to another Media Library folder.")
    moving.add_argument("source_file_path")
    moving.add_argument("destination_path")

    renaming = sub.add_parser("rename", help="Rename a file; old delivery URLs will change.")
    renaming.add_argument("file_path")
    renaming.add_argument("new_file_name")
    renaming.add_argument("--purge-cache", action="store_true")

    args = parser.parse_args()
    try:
        if args.command == "list":
            result = list_files(max(1, min(args.limit, 1000)), max(0, args.skip),
                                args.path, None, args.file_type, args.asset_type)
        elif args.command == "search":
            result = list_files(max(1, min(args.limit, 1000)), max(0, args.skip),
                                None, args.query, "all", "all")
        elif args.command == "upload":
            result = upload_file(Path(args.file), args.folder, args.tag, args.overwrite)
        elif args.command == "details":
            result = file_details(args.file_id)
        elif args.command == "update":
            payload: dict[str, Any] = {}
            if args.tags is not None:
                payload["tags"] = [tag.strip() for tag in args.tags.split(",") if tag.strip()]
            if args.custom_metadata is not None:
                parsed_metadata = json.loads(args.custom_metadata)
                if not isinstance(parsed_metadata, dict):
                    raise ImageKitError("--custom-metadata must be a JSON object.")
                payload["customMetadata"] = parsed_metadata
            if args.description is not None:
                payload["description"] = args.description
            if args.published is not None:
                payload["publish"] = {"isPublished": args.published == "true", "includeFileVersions": args.include_versions}
            result = update_file_details(args.file_id, payload)
        elif args.command == "delete":
            result = delete_file(args.file_id)
        elif args.command == "copy":
            result = copy_file(args.source_file_path, args.destination_path, args.include_versions)
        elif args.command == "move":
            result = move_file(args.source_file_path, args.destination_path)
        else:
            result = rename_file(args.file_path, args.new_file_name, args.purge_cache)
        print(json.dumps(result, ensure_ascii=False, indent=2))
        return 0
    except ImageKitError as exc:
        print("IMAGEKIT_ERROR: " + str(exc), file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
