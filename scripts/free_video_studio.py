#!/usr/bin/env python3
# Free local video studio: Wikimedia Commons stills + Edge TTS + FFmpeg.
# No image/video-generation API, API key, subscription, or cloud rendering is used.

from __future__ import annotations

import argparse
import asyncio
import html
import json
import re
import shutil
import subprocess
import sys
import textwrap
import time
import urllib.parse
import urllib.request
from pathlib import Path
from typing import Any


COMMONS_API = "https://commons.wikimedia.org/w/api.php"
USER_AGENT = "MergerFreeVideoStudio/1.0 (local Windows video editor)"
VOICE_DEFAULT = "ar-EG-SalmaNeural"
MAX_IMAGE_BYTES = 12 * 1024 * 1024
MAX_SCENES = 12


def clean_html(value: Any) -> str:
    raw = str(value or "")
    raw = re.sub(r"<br\s*/?>", " ", raw, flags=re.I)
    raw = re.sub(r"<[^>]+>", " ", raw)
    return re.sub(r"\s+", " ", html.unescape(raw)).strip()


def meta_value(metadata: dict[str, Any], key: str) -> str:
    item = metadata.get(key) or {}
    return clean_html(item.get("value") if isinstance(item, dict) else item)


def license_is_reusable(name: str) -> bool:
    value = re.sub(r"\s+", " ", name.strip().lower())
    if not value:
        return False
    if value.startswith(("cc0", "public domain", "pd-", "pd ")):
        return True
    if re.match(r"^cc by(?:-sa)?(?:\s|[-0-9])", value):
        return True
    return False


def http_json(url: str) -> dict[str, Any]:
    request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    with urllib.request.urlopen(request, timeout=35) as response:
        return json.loads(response.read().decode("utf-8"))


def commons_candidates(query: str) -> list[dict[str, Any]]:
    params = {
        "action": "query",
        "format": "json",
        "formatversion": "2",
        "generator": "search",
        "gsrsearch": query,
        "gsrnamespace": "6",
        "gsrlimit": "15",
        "prop": "imageinfo",
        "iiprop": "url|mime|size|extmetadata",
        "iiurlwidth": "1600",
    }
    url = COMMONS_API + "?" + urllib.parse.urlencode(params)
    payload = http_json(url)
    return (payload.get("query") or {}).get("pages") or []


def choose_commons_image(query: str, destination: Path) -> dict[str, str]:
    last_error = "No reusable image found."
    for page in commons_candidates(query):
        infos = page.get("imageinfo") or []
        if not infos:
            continue
        info = infos[0]
        mime = str(info.get("thumbmime") or info.get("mime") or "").lower()
        if mime not in {"image/jpeg", "image/png", "image/webp"}:
            continue

        metadata = info.get("extmetadata") or {}
        license_name = meta_value(metadata, "LicenseShortName") or meta_value(metadata, "UsageTerms")
        if not license_is_reusable(license_name):
            continue

        media_url = info.get("thumburl") or info.get("url")
        parsed = urllib.parse.urlparse(str(media_url or ""))
        if parsed.scheme != "https" or parsed.hostname != "upload.wikimedia.org":
            continue

        if int(info.get("size") or 0) > 80 * 1024 * 1024 and not info.get("thumburl"):
            continue

        ext = {"image/jpeg": ".jpg", "image/png": ".png", "image/webp": ".webp"}[mime]
        request = urllib.request.Request(str(media_url), headers={"User-Agent": USER_AGENT})
        try:
            with urllib.request.urlopen(request, timeout=45) as response:
                declared = int(response.headers.get("Content-Length") or 0)
                if declared > MAX_IMAGE_BYTES:
                    last_error = "Image thumbnail exceeds the 12 MB limit."
                    continue
                total = 0
                with destination.open("wb") as output:
                    while True:
                        block = response.read(128 * 1024)
                        if not block:
                            break
                        total += len(block)
                        if total > MAX_IMAGE_BYTES:
                            raise ValueError("Image exceeded the 12 MB download limit.")
                        output.write(block)
            if total < 10_000:
                raise ValueError("Downloaded image is unexpectedly small.")
        except Exception as exc:
            destination.unlink(missing_ok=True)
            last_error = str(exc)
            continue

        title = str(page.get("title") or "").removeprefix("File:")
        description_url = info.get("descriptionurl") or (
            "https://commons.wikimedia.org/wiki/" + urllib.parse.quote(str(page.get("title") or "").replace(" ", "_"))
        )
        return {
            "filename": title,
            "author": meta_value(metadata, "Artist") or meta_value(metadata, "Credit") or "Author not stated",
            "license": license_name,
            "license_url": meta_value(metadata, "LicenseUrl"),
            "source_url": str(description_url),
            "direct_url": str(media_url),
            "local_file": str(destination),
            "mime": mime,
        }

    raise RuntimeError(f"No suitable freely reusable Commons image for '{query}'. {last_error}")


def run_checked(args: list[str], label: str) -> str:
    result = subprocess.run(args, capture_output=True, text=True, encoding="utf-8", errors="replace")
    if result.returncode != 0:
        detail = (result.stderr or result.stdout or "Unknown error").strip()
        raise RuntimeError(f"{label} failed: {detail[-1800:]}")
    return result.stdout.strip()


def ffprobe_duration(ffprobe: str, media: Path) -> float:
    value = run_checked(
        [ffprobe, "-v", "error", "-show_entries", "format=duration",
         "-of", "default=noprint_wrappers=1:nokey=1", str(media)],
        f"Reading audio duration for {media.name}",
    )
    duration = float(value)
    if duration <= 0:
        raise RuntimeError(f"Invalid audio duration for {media.name}")
    return duration


def safe_ass_text(value: str) -> str:
    value = value.replace("\\", r"\\").replace("{", r"\{").replace("}", r"\}")
    lines = textwrap.wrap(value, width=38, break_long_words=False, break_on_hyphens=False)
    return r"\N".join(lines[:5])


def ass_time(seconds: float) -> str:
    centiseconds = max(1, int(round(seconds * 100)))
    hours, rest = divmod(centiseconds, 360000)
    minutes, rest = divmod(rest, 6000)
    whole, fraction = divmod(rest, 100)
    return f"{hours}:{minutes:02d}:{whole:02d}.{fraction:02d}"


def write_ass(path: Path, width: int, height: int, caption: str, duration: float) -> None:
    font_size = 32 if height > width else 30
    content = f"""[Script Info]
ScriptType: v4.00+
PlayResX: {width}
PlayResY: {height}
WrapStyle: 2
ScaledBorderAndShadow: yes

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Default,Arial,{font_size},&H00FFFFFF,&H000000FF,&H00111111,&H88000000,-1,0,0,0,100,100,0,0,3,2,0,2,55,55,58,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
Dialogue: 0,0:00:00.00,{ass_time(duration)},Default,,0,0,0,,{safe_ass_text(caption)}
"""
    path.write_text(content, encoding="utf-8")


def escape_filter_path(path: Path) -> str:
    value = str(path.resolve()).replace("\\", "/")
    value = value.replace(":", r"\:").replace("'", r"\'")
    return value


async def make_voice(text: str, output: Path, voice: str) -> None:
    try:
        import edge_tts
    except ImportError as exc:
        raise RuntimeError(
            "edge-tts is not installed. Run: py -3.12 -m pip install --user -r scripts\\requirements-free-video.txt"
        ) from exc

    communicator = edge_tts.Communicate(text=text, voice=voice, rate="-3%")
    await communicator.save(str(output))


def safe_name(title: str) -> str:
    value = re.sub(r"[^\w\- ]+", "", title, flags=re.UNICODE).strip()
    value = re.sub(r"\s+", "-", value)
    return (value[:60] or "free-video").strip("-")


def main() -> int:
    parser = argparse.ArgumentParser(description="Create an Arabic video locally using reusable Commons images, Edge TTS, and FFmpeg.")
    parser.add_argument("--spec", required=True, help="Path to a UTF-8 JSON video specification.")
    parser.add_argument("--output", default="media-output", help="Output directory (default: media-output).")
    parser.add_argument("--voice", default=VOICE_DEFAULT, help=f"Edge TTS voice (default: {VOICE_DEFAULT}).")
    parser.add_argument("--ffmpeg", default="ffmpeg", help="FFmpeg executable.")
    parser.add_argument("--ffprobe", default="ffprobe", help="FFprobe executable.")
    parser.add_argument("--max-image-mb", type=int, default=12, help="Maximum size of each downloaded image.")
    args = parser.parse_args()

    spec_path = Path(args.spec).expanduser().resolve()
    if not spec_path.is_file():
        raise RuntimeError(f"Specification file not found: {spec_path}")
    spec = json.loads(spec_path.read_text(encoding="utf-8-sig"))
    title = str(spec.get("title") or "").strip()
    scenes = spec.get("scenes")
    if not title or not isinstance(scenes, list) or not scenes or len(scenes) > MAX_SCENES:
        raise RuntimeError(f"Video specification needs a title and 1–{MAX_SCENES} scenes.")
    for index, scene in enumerate(scenes, 1):
        if not isinstance(scene, dict) or not str(scene.get("narration") or "").strip():
            raise RuntimeError(f"Scene {index} needs Arabic narration text.")
        if not str(scene.get("search") or "").strip():
            raise RuntimeError(f"Scene {index} needs English Wikimedia search terms.")

    output_root = Path(args.output).expanduser().resolve()
    job_dir = output_root / safe_name(title)
    assets_dir = job_dir / "assets"
    audio_dir = job_dir / "audio"
    video_dir = job_dir / "segments"
    for folder in (assets_dir, audio_dir, video_dir):
        folder.mkdir(parents=True, exist_ok=True)

    ffmpeg = shutil.which(args.ffmpeg)
    ffprobe = shutil.which(args.ffprobe)
    if not ffmpeg or not ffprobe:
        raise RuntimeError("FFmpeg and FFprobe must be installed and available on PATH.")

    filters = run_checked([ffmpeg, "-hide_banner", "-filters"], "Checking FFmpeg filters")
    has_ass = re.search(r"\bass\s+V->V", filters) is not None
    has_subtitles = re.search(r"\bsubtitles\s+V->V", filters) is not None
    has_drawtext = re.search(r"\bdrawtext\s+V->V", filters) is not None
    if not (has_ass or has_subtitles or has_drawtext):
        raise RuntimeError("This FFmpeg build has no ASS/subtitles/drawtext filter. Install a full FFmpeg build.")

    format_name = str(spec.get("format") or "shorts").lower()
    if format_name not in {"shorts", "landscape"}:
        raise RuntimeError("format must be 'shorts' or 'landscape'.")
    width, height = (720, 1280) if format_name == "shorts" else (1280, 720)
    fps = 25
    credits: list[dict[str, str]] = []
    segments: list[Path] = []

    print(f"Preparing {len(scenes)} scenes: {title}")
    print("Free local workflow: Wikimedia Commons + Edge TTS + FFmpeg. No paid generation API.")

    for index, scene in enumerate(scenes, 1):
        print(f"[{index}/{len(scenes)}] Finding a reusable image: {scene['search']}")
        extension = ".jpg"
        image_path = assets_dir / f"scene-{index:02d}{extension}"
        media = choose_commons_image(str(scene["search"]).strip(), image_path)
        voice_path = audio_dir / f"scene-{index:02d}.mp3"
        print(f"[{index}/{len(scenes)}] Creating Arabic narration...")
        asyncio.run(make_voice(str(scene["narration"]).strip(), voice_path, args.voice))
        voice_duration = ffprobe_duration(ffprobe, voice_path)
        segment_duration = voice_duration + 0.7

        ass_path = audio_dir / f"scene-{index:02d}.ass"
        write_ass(ass_path, width, height, str(scene["narration"]).strip(), segment_duration)
        ass_filter = escape_filter_path(ass_path)
        fonts_dir = Path(r"C:\Windows\Fonts")
        base_vf = (
            f"scale={width}:{height}:force_original_aspect_ratio=increase,"
            f"crop={width}:{height},fps={fps},"
            f"zoompan=z='min(zoom+0.00035,1.045)':d=1:s={width}x{height}:fps={fps}"
        )
        if has_ass:
            vf = base_vf + f",ass=filename='{ass_filter}'"
            if fonts_dir.is_dir():
                vf += f":fontsdir='{escape_filter_path(fonts_dir)}'"
        elif has_subtitles:
            vf = base_vf + f",subtitles=filename='{ass_filter}'"
            if fonts_dir.is_dir():
                vf += f":fontsdir='{escape_filter_path(fonts_dir)}'"
        else:
            # Drawtext fallback; Arabic shaping depends on the FFmpeg build's HarfBuzz support.
            text_path = audio_dir / f"scene-{index:02d}.txt"
            text_path.write_text(str(scene["narration"]).strip(), encoding="utf-8")
            font = Path(r"C:\Windows\Fonts\arial.ttf")
            if not font.is_file():
                raise RuntimeError("Arabic captions need C:\\Windows\\Fonts\\arial.ttf or an FFmpeg build with libass.")
            vf = base_vf + (
                f",drawtext=fontfile='{escape_filter_path(font)}':"
                f"textfile='{escape_filter_path(text_path)}':text_shaping=1:"
                "fontcolor=white:fontsize=32:box=1:boxcolor=black@0.55:"
                "boxborderw=20:x=(w-text_w)/2:y=h-text_h-55"
            )

        segment_path = video_dir / f"scene-{index:02d}.mp4"
        run_checked(
            [
                ffmpeg, "-y", "-hide_banner", "-loglevel", "error",
                "-loop", "1", "-framerate", str(fps), "-i", str(image_path),
                "-i", str(voice_path),
                "-vf", vf,
                "-af", "apad=pad_dur=0.7",
                "-t", f"{segment_duration:.3f}",
                "-r", str(fps),
                "-c:v", "libx264", "-preset", "ultrafast", "-crf", "28",
                "-threads", "2", "-pix_fmt", "yuv420p",
                "-c:a", "aac", "-b:a", "96k",
                "-movflags", "+faststart", str(segment_path),
            ],
            f"Rendering scene {index}",
        )
        segments.append(segment_path)
        credits.append(media)
        print(f"Rendered scene {index}: {segment_path.name}")

    concat_path = job_dir / "concat.txt"
    concat_lines = []
    for segment in segments:
        concat_lines.append("file '" + str(segment.resolve()).replace("\\", "/").replace("'", r"'\''") + "'")
    concat_path.write_text("\n".join(concat_lines) + "\n", encoding="utf-8")

    output_file = job_dir / (safe_name(title) + ("-shorts.mp4" if format_name == "shorts" else "-video.mp4"))
    run_checked(
        [
            ffmpeg, "-y", "-hide_banner", "-loglevel", "error",
            "-f", "concat", "-safe", "0", "-i", str(concat_path),
            "-c", "copy", "-movflags", "+faststart", str(output_file),
        ],
        "Joining video scenes",
    )

    sources_path = job_dir / "sources.json"
    sources_path.write_text(json.dumps(credits, ensure_ascii=False, indent=2), encoding="utf-8")
    description_lines = [
        title,
        "",
        "تم إنشاء الفيديو محليًا باستخدام FFmpeg والتعليق الصوتي Edge TTS.",
        "مصادر الصور وتراخيصها:",
    ]
    for number, item in enumerate(credits, 1):
        description_lines.extend([
            f"{number}. {item['filename']}",
            f"   المؤلف/المصدر: {item['author']}",
            f"   الترخيص: {item['license']}",
            f"   صفحة الملف: {item['source_url']}",
            f"   نص الترخيص: {item['license_url'] or 'راجع صفحة الملف'}",
        ])
    description_path = job_dir / "video-description-and-attribution.txt"
    description_path.write_text("\n".join(description_lines) + "\n", encoding="utf-8")

    print("")
    print("VIDEO CREATED SUCCESSFULLY")
    print(f"Video: {output_file}")
    print(f"Attribution: {description_path}")
    print(f"Sources JSON: {sources_path}")
    print("Copy the attribution text into the video description when publishing.")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except KeyboardInterrupt:
        print("\nCancelled by user.")
        raise SystemExit(130)
    except Exception as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        raise SystemExit(1)
