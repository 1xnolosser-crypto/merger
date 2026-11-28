#!/usr/bin/env python3
"""Publish VYROX Shorts to YouTube and Facebook Reels using official APIs.

Secrets are stored in the Windows Credential Manager via keyring, except the
Google OAuth client file/token which live in the ignored local secrets folder.
"""
from __future__ import annotations

import argparse
import json
import os
import sys
import time
from pathlib import Path
from datetime import datetime, timedelta, timezone
from typing import Any
from urllib.parse import urlparse

ROOT = Path(__file__).resolve().parents[1]
SECRETS = ROOT / "secrets"
YOUTUBE_CLIENT = SECRETS / "youtube-client-secrets.json"
YOUTUBE_TOKEN = SECRETS / "youtube-token.json"
KEYRING_SERVICE = "VYROX-Social-Publisher"
PAGE_TOKEN_USER = "facebook-page-access-token"
GRAPH_VERSION = "v27.0"


class PublishError(RuntimeError):
    pass


def load_keyring():
    try:
        import keyring
        return keyring
    except ImportError:
        raise PublishError("Missing keyring package. Run setup-social-publishing.ps1 first.") from None


def configure_facebook(page_id: str) -> None:
    import getpass
    try:
        import requests
    except ImportError:
        raise PublishError("requests package is missing. Run setup-social-publishing.ps1.") from None
    keyring = load_keyring()
    print("Create/select your Meta app, then use Graph API Explorer to generate a USER token with:")
    print("pages_show_list, pages_read_engagement, pages_manage_posts")
    app_id = getpass.getpass("Meta App ID (input hidden): ").strip()
    app_secret = getpass.getpass("Meta App Secret (input hidden): ").strip()
    short_token = getpass.getpass("Short-lived USER access token (input hidden): ").strip()
    if not app_id or not app_secret or not short_token:
        raise PublishError("App ID, App Secret, and user token are all required; nothing was saved.")
    exchange = requests.get(
        f"https://graph.facebook.com/{GRAPH_VERSION}/oauth/access_token",
        params={"grant_type": "fb_exchange_token", "client_id": app_id,
                "client_secret": app_secret, "fb_exchange_token": short_token},
        timeout=45,
    )
    if not exchange.ok:
        raise PublishError(f"Meta token exchange failed HTTP {exchange.status_code}: {exchange.text[:900]}")
    long_token = str(exchange.json().get("access_token") or "")
    if not long_token:
        raise PublishError("Meta did not return a long-lived user access token.")
    pages = requests.get(
        f"https://graph.facebook.com/{GRAPH_VERSION}/me/accounts",
        params={"fields": "id,name,access_token", "access_token": long_token},
        timeout=45,
    )
    if not pages.ok:
        raise PublishError(f"Could not retrieve Page access tokens HTTP {pages.status_code}: {pages.text[:900]}")
    matches = [p for p in pages.json().get("data", []) if str(p.get("id")) == str(page_id)]
    if not matches or not matches[0].get("access_token"):
        raise PublishError(
            f"Page {page_id} was not returned. Ensure this user manages the Page and granted "
            "pages_show_list, pages_read_engagement, and pages_manage_posts."
        )
    page_token = str(matches[0]["access_token"])
    keyring.set_password(KEYRING_SERVICE, PAGE_TOKEN_USER, page_token)
    print("FACEBOOK_LONG_LIVED_PAGE_TOKEN_SAVED_TO_WINDOWS_CREDENTIAL_MANAGER")


def facebook_token() -> str:
    token = load_keyring().get_password(KEYRING_SERVICE, PAGE_TOKEN_USER)
    if not token:
        raise PublishError("Facebook Page token is not configured. Run: py -3.12 scripts\\publish_social.py configure-facebook")
    return token


def authorize_youtube() -> None:
    try:
        from google_auth_oauthlib.flow import InstalledAppFlow
    except ImportError:
        raise PublishError("Google OAuth packages are missing. Run setup-social-publishing.ps1.") from None
    if not YOUTUBE_CLIENT.is_file():
        raise PublishError(
            "Missing secrets\\youtube-client-secrets.json. Create a Google OAuth Desktop app "
            "client, download its JSON, and save it at that exact path."
        )
    SECRETS.mkdir(parents=True, exist_ok=True)
    flow = InstalledAppFlow.from_client_secrets_file(
        str(YOUTUBE_CLIENT), ["https://www.googleapis.com/auth/youtube.upload"]
    )
    credentials = flow.run_local_server(
        host="127.0.0.1", port=0, open_browser=True,
        access_type="offline", prompt="consent"
    )
    YOUTUBE_TOKEN.write_text(credentials.to_json(), encoding="utf-8")
    try:
        os.chmod(YOUTUBE_TOKEN, 0o600)
    except OSError:
        pass
    print("YOUTUBE_OAUTH_SAVED")


def youtube_service():
    try:
        from google.auth.transport.requests import Request
        from google.oauth2.credentials import Credentials
        from googleapiclient.discovery import build
    except ImportError:
        raise PublishError("Google API packages are missing. Run setup-social-publishing.ps1.") from None
    if not YOUTUBE_TOKEN.is_file():
        raise PublishError("YouTube is not authorized yet. Run: py -3.12 scripts\\publish_social.py authorize-youtube")
    creds = Credentials.from_authorized_user_file(
        str(YOUTUBE_TOKEN), ["https://www.googleapis.com/auth/youtube.upload"]
    )
    if creds.expired and creds.refresh_token:
        creds.refresh(Request())
        YOUTUBE_TOKEN.write_text(creds.to_json(), encoding="utf-8")
    if not creds.valid:
        raise PublishError("YouTube OAuth token is invalid. Run authorize-youtube again.")
    return build("youtube", "v3", credentials=creds, cache_discovery=False)


def load_package(path: Path) -> dict[str, Any]:
    try:
        payload = json.loads(path.read_text(encoding="utf-8-sig"))
    except Exception as exc:
        raise PublishError(f"Cannot read publish package: {exc}") from None
    if not payload.get("youtubeTitle") or not payload.get("description") or not payload.get("title"):
        raise PublishError("Publish package is missing title or description.")
    video_path = Path(payload.get("localVideoPath") or "")
    if not video_path.is_file():
        raise PublishError(f"Local MP4 is missing: {video_path}")
    if video_path.suffix.lower() != ".mp4":
        raise PublishError("Only MP4 video files are accepted.")
    if video_path.stat().st_size <= 0:
        raise PublishError("Local MP4 is empty.")
    return payload


def state_path(package_path: Path) -> Path:
    return package_path.with_name("publication-state.json")


def read_state(path: Path) -> dict[str, Any]:
    if not path.exists():
        return {"schemaVersion": 1, "platforms": {}}
    try:
        return json.loads(path.read_text(encoding="utf-8-sig"))
    except Exception:
        return {"schemaVersion": 1, "platforms": {}}


def write_state(path: Path, state: dict[str, Any]) -> None:
    temp = path.with_suffix(".json.tmp")
    temp.write_text(json.dumps(state, ensure_ascii=False, indent=2), encoding="utf-8")
    temp.replace(path)


def parse_publish_at(value: str) -> datetime:
    raw = value.strip().replace("Z", "+00:00")
    try:
        result = datetime.fromisoformat(raw)
    except ValueError:
        raise PublishError("Publish time must be ISO 8601 with a timezone offset, e.g. 2026-11-29T10:00:00+02:00.") from None
    if result.tzinfo is None:
        raise PublishError("Publish time must include a timezone offset.")
    result = result.astimezone(timezone.utc)
    now = datetime.now(timezone.utc)
    if result <= now.replace(microsecond=0):
        raise PublishError("Publish time is in the past. No platform upload was started.")
    if result < now + timedelta(minutes=10):
        raise PublishError("Choose a publish time at least 10 minutes from now.")
    if result > now + timedelta(days=75):
        raise PublishError("Choose a publish time within the next 75 days.")
    return result


def publish_youtube(package: dict[str, Any], video_path: Path, publish_at: datetime) -> str:
    from googleapiclient.http import MediaFileUpload
    youtube = youtube_service()
    tags = [str(x)[:100] for x in package.get("tags", []) if str(x).strip()]
    scheduled_iso = publish_at.astimezone(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")
    request_body = {
        "snippet": {
            "title": str(package["youtubeTitle"])[:100],
            "description": str(package["description"])[:5000],
            "tags": tags[:30],
            "categoryId": "28",
        },
        "status": {
            "privacyStatus": "private",
            "publishAt": scheduled_iso,
            "selfDeclaredMadeForKids": False,
        },
    }
    media = MediaFileUpload(str(video_path), mimetype="video/mp4", chunksize=1024 * 1024, resumable=True)
    request = youtube.videos().insert(part="snippet,status", body=request_body, media_body=media)
    response = None
    retries = 0
    while response is None:
        try:
            status, response = request.next_chunk()
            if status:
                print(f"YouTube upload: {int(status.progress() * 100)}%")
            retries = 0
        except Exception as exc:
            retries += 1
            if retries > 5:
                raise PublishError(f"YouTube upload stopped after retries: {exc}") from None
            delay = min(60, 2 ** retries)
            print(f"YouTube temporary upload error; retrying in {delay}s.")
            time.sleep(delay)
    video_id = str(response.get("id") or "")
    if not video_id:
        raise PublishError("YouTube API returned no video ID.")
    deadline = time.time() + 600
    while time.time() < deadline:
        details = youtube.videos().list(part="status,processingDetails", id=video_id).execute()
        items = details.get("items") or []
        if items:
            status = items[0].get("status") or {}
            processing = (items[0].get("processingDetails") or {}).get("processingStatus")
            upload_status = status.get("uploadStatus")
            if upload_status in {"rejected", "failed", "deleted"}:
                raise PublishError(f"YouTube rejected or failed video processing: {upload_status}")
            if (upload_status == "processed" or processing == "succeeded") and status.get("publishAt"):
                if status.get("privacyStatus") != "private":
                    raise PublishError("YouTube upload is not private while awaiting its scheduled release.")
                return "https://www.youtube.com/shorts/" + video_id
        print("Waiting for YouTube processing and scheduled-publication confirmation...")
        time.sleep(20)
    raise PublishError("YouTube accepted the upload but processing/schedule was not confirmed within 10 minutes.")


def publish_facebook(package: dict[str, Any], video_path: Path, page_id: str, publish_at: datetime) -> str:
    try:
        import requests
    except ImportError:
        raise PublishError("requests package is missing. Run setup-social-publishing.ps1.") from None
    token = facebook_token()
    base = f"https://graph.facebook.com/{GRAPH_VERSION}/{page_id}/video_reels"
    start = requests.post(base, data={"upload_phase": "START"}, headers={"Authorization": f"OAuth {token}"}, timeout=60)
    if not start.ok:
        raise PublishError(f"Facebook START failed HTTP {start.status_code}: {start.text[:1000]}")
    start_data = start.json()
    video_id = str(start_data.get("video_id") or "")
    upload_url = str(start_data.get("upload_url") or "")
    if not video_id or not upload_url:
        raise PublishError("Facebook START response did not include video_id and upload_url.")
    parsed = urlparse(upload_url)
    if parsed.scheme != "https" or parsed.hostname not in {"rupload.facebook.com", "graph.facebook.com"}:
        raise PublishError("Facebook returned an unexpected upload host; upload was stopped.")
    size = video_path.stat().st_size
    headers = {
        "Authorization": f"OAuth {token}",
        "offset": "0",
        "file_size": str(size),
        "Content-Type": "application/octet-stream",
    }
    with video_path.open("rb") as stream:
        upload = requests.post(upload_url, headers=headers, data=stream, timeout=(60, 900))
    if not upload.ok:
        raise PublishError(f"Facebook binary upload failed HTTP {upload.status_code}: {upload.text[:1000]}")
    upload_data = upload.json() if upload.text.strip() else {}
    if upload_data.get("success") is False:
        raise PublishError("Facebook rejected the binary upload.")
    scheduled_timestamp = int(publish_at.timestamp())
    finish_data = {
        "upload_phase": "FINISH",
        "video_id": video_id,
        "video_state": "SCHEDULED",
        "scheduled_publish_time": str(scheduled_timestamp),
        "title": str(package["title"])[:255],
        "description": str(package["description"])[:5000],
        "is_ai_generated": "true",
    }
    finish = requests.post(base, data=finish_data, headers={"Authorization": f"OAuth {token}"}, timeout=120)
    if not finish.ok:
        raise PublishError(f"Facebook FINISH failed HTTP {finish.status_code}: {finish.text[:1200]}")
    result = finish.json()
    if result.get("success") is not True or str(result.get("video_id") or video_id) != video_id:
        raise PublishError(f"Facebook did not confirm the scheduled Reel: {result}")
    return f"https://www.facebook.com/reel/{video_id}"


def check_credentials(page_id: str) -> None:
    problems = []
    if not YOUTUBE_CLIENT.is_file():
        problems.append("Google OAuth client JSON missing")
    if not YOUTUBE_TOKEN.is_file():
        problems.append("YouTube OAuth not authorized")
    try:
        if not facebook_token():
            problems.append("Facebook Page token missing")
    except Exception:
        problems.append("Facebook Page token missing from Windows Credential Manager")
    if problems:
        raise PublishError("Credential setup incomplete: " + "; ".join(problems))
    if not page_id.isdigit():
        raise PublishError("Facebook Page ID must contain digits only.")
    print("SOCIAL_CREDENTIALS_PRESENT")


def main() -> int:
    parser = argparse.ArgumentParser(description="Schedule a VYROX video directly from the local MP4 to YouTube Shorts and Facebook Reels.")
    sub = parser.add_subparsers(dest="command", required=True)
    sub.add_parser("authorize-youtube", help="One-time interactive Google OAuth consent.")
    fb = sub.add_parser("configure-facebook", help="Exchange a user token for a long-lived Page token and store it securely.")
    fb.add_argument("--page-id", default="1574613545729181")
    check = sub.add_parser("check", help="Check that local credentials are present.")
    check.add_argument("--page-id", default="1574613545729181")
    pub = sub.add_parser("publish", help="Upload and schedule a prepared local package.")
    pub.add_argument("--package", required=True)
    pub.add_argument("--page-id", default="1574613545729181")
    pub.add_argument("--platforms", default="youtube,facebook")
    pub.add_argument("--publish-at", required=True, help="ISO 8601 date/time with timezone offset.")
    args = parser.parse_args()
    try:
        if args.command == "authorize-youtube":
            authorize_youtube()
        elif args.command == "configure-facebook":
            configure_facebook(args.page_id)
        elif args.command == "check":
            check_credentials(args.page_id)
        else:
            publish_at = parse_publish_at(args.publish_at)
            package_path = Path(args.package).expanduser().resolve()
            package = load_package(package_path)
            video_path = Path(package["localVideoPath"])
            state_file = state_path(package_path)
            state = read_state(state_file)
            state.setdefault("platforms", {})
            requested = [x.strip().lower() for x in args.platforms.split(",") if x.strip()]
            if not requested or any(p not in {"youtube", "facebook"} for p in requested):
                raise PublishError("Platforms must be a comma-separated subset of youtube,facebook.")
            platform_errors: dict[str, str] = {}
            for platform in requested:
                previous = state["platforms"].get(platform, {})
                if previous.get("success") or previous.get("scheduled"):
                    print(platform.upper() + "_ALREADY_HANDLED: " + str(previous.get("url", "")))
                    continue
                print("Scheduling " + platform + " directly from the local MP4...")
                try:
                    if platform == "youtube":
                        url = publish_youtube(package, video_path, publish_at)
                    else:
                        url = publish_facebook(package, video_path, args.page_id, publish_at)
                except Exception as exc:
                    message = str(exc).strip() or exc.__class__.__name__
                    platform_errors[platform] = message
                    state["platforms"][platform] = {
                        "scheduled": False,
                        "success": False,
                        "error": message[:2000],
                        "attemptedAt": datetime.now(timezone.utc).isoformat(timespec="seconds"),
                    }
                    write_state(state_file, state)
                    print(platform.upper() + "_SCHEDULING_FAILED: " + message, file=sys.stderr)
                    # Continue to the other platform. A later retry skips any platform
                    # already confirmed scheduled and retries only failed/incomplete ones.
                    continue
                state["platforms"][platform] = {
                    "scheduled": True,
                    "success": False,
                    "url": url,
                    "scheduledAt": publish_at.isoformat(),
                    "submittedAt": datetime.now(timezone.utc).isoformat(timespec="seconds"),
                }
                write_state(state_file, state)
                print(platform.upper() + "_SCHEDULED: " + url)
            complete = all(
                state["platforms"].get(p, {}).get("scheduled") or state["platforms"].get(p, {}).get("success")
                for p in requested
            )
            state["status"] = "scheduled" if complete else "partial"
            state["scheduledAt"] = publish_at.isoformat()
            state["updatedAt"] = datetime.now(timezone.utc).isoformat(timespec="seconds")
            write_state(state_file, state)
            if not complete:
                error_summary = "; ".join(
                    platform.upper() + ": " + message for platform, message in platform_errors.items()
                )
                if not error_summary:
                    error_summary = "One or more requested platforms did not confirm scheduling."
                raise PublishError(error_summary)
            print("ALL_REQUESTED_PLATFORMS_SCHEDULED")
        return 0
    except PublishError as exc:
        print("PUBLISH_ERROR: " + str(exc), file=sys.stderr)
        return 2
    except Exception as exc:
        print("PUBLISH_ERROR: " + str(exc), file=sys.stderr)
        return 3


if __name__ == "__main__":
    raise SystemExit(main())
