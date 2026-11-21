// Merge service: takes an ordered list of video URLs, downloads each to a
// temporary directory, concatenates with ffmpeg (re-encoding to a common
// H.264/AAC profile when codecs differ), uploads the result to a public
// file host (tmpfiles.org), and returns the public URL.
//
// The temp files are deleted immediately after upload. Only the final URL
// is stored in the database — never the merged media itself.
//
// Serverless-friendly: the ffmpeg binary is resolved from the bundled
// @ffmpeg-installer/ffmpeg package (present on Vercel via
// outputFileTracingIncludes), an FFMPEG_PATH env override, or the system
// PATH (local development). Stream properties are parsed from
// `ffmpeg -i` output — no ffprobe binary required.

import { spawn } from 'child_process'
import { mkdir, rm, writeFile, stat } from 'fs/promises'
import { join } from 'path'
import { tmpdir } from 'os'
import { randomUUID } from 'crypto'
import { createWriteStream } from 'fs'
import { Readable } from 'stream'

const TMPFILES_ENDPOINT = 'https://tmpfiles.org/api/v1/upload'

interface UploadResult {
  url: string // direct download URL
}

interface ProbeResult {
  codec: string
  width: number
  height: number
  pixFmt: string
  audioCodec: string
  fps: number
  duration: number
}

// ─── ffmpeg binary resolution ───────────────────────────────────────────────

let cachedFfmpegPath: string | null | undefined

async function resolveFfmpegPath(): Promise<string> {
  if (cachedFfmpegPath !== undefined) return cachedFfmpegPath
  // 1) explicit env override
  if (process.env.FFMPEG_PATH) {
    cachedFfmpegPath = process.env.FFMPEG_PATH
    return cachedFfmpegPath
  }
  // 2) bundled static binary (works on Vercel where PATH has no ffmpeg)
  try {
    const mod = (await import('@ffmpeg-installer/ffmpeg')) as {
      path?: string
      default?: { path?: string }
    }
    const p = mod?.path || mod?.default?.path
    if (p) {
      cachedFfmpegPath = p
      return p
    }
  } catch {
    // package not installed — fall through
  }
  // 3) system PATH (local dev / self-hosted)
  cachedFfmpegPath = 'ffmpeg'
  return cachedFfmpegPath
}

// ─── stream probing via `ffmpeg -i` ─────────────────────────────────────────

const VIDEO_CODECS_OK = new Set(['h264', 'hevc', 'vp8', 'vp9', 'av1', 'mpeg4', 'mpeg2video'])

interface ParsedStreams {
  codec: string
  width: number
  height: number
  pixFmt: string
  fps: number
  audioCodec: string
  duration: number
}

function parseStreamInfo(stderr: string): ParsedStreams {
  let codec = 'unknown'
  let width = 0
  let height = 0
  let pixFmt = 'yuv420p'
  let fps = 30
  let audioCodec = 'none'
  let duration = 0

  const durM = stderr.match(/Duration:\s*(\d+):(\d+):([\d.]+)/)
  if (durM) {
    duration = Number(durM[1]) * 3600 + Number(durM[2]) * 60 + Number(durM[3])
  }

  // Video stream lines, e.g.:
  // Stream #0:0(und): Video: h264 (High) (avc1 / 0x31637661), yuv420p(progressive), 1920x1080 [SAR 1:1 DAR 16:9], 2000 kb/s, 30 fps, 30 tbr
  const videoRe = /Video:\s*([a-z0-9_]+)/gi
  let m: RegExpExecArray | null
  while ((m = videoRe.exec(stderr)) !== null) {
    const c = m[1]
    if (VIDEO_CODECS_OK.has(c)) {
      codec = c
      // Grab the same line for pixel format + dimensions + fps.
      const lineStart = stderr.lastIndexOf('Stream', m.index)
      const lineEnd = stderr.indexOf('\n', m.index)
      const line = stderr.slice(lineStart >= 0 ? lineStart : m.index, lineEnd > 0 ? lineEnd : undefined)
      const dim = line.match(/,\s*([a-z0-9_]+)(?:\([a-z_]+\))?,\s*(\d+)x(\d+)/i)
      if (dim) {
        pixFmt = dim[1].toLowerCase()
        width = Number(dim[2])
        height = Number(dim[3])
      }
      const fpsM = line.match(/([\d.]+)\s*fps/i) || line.match(/([\d.]+)\s*tbr/i)
      if (fpsM) fps = Math.round(Number(fpsM[1])) || 30
      break
    }
  }

  const audioM = stderr.match(/Audio:\s*([a-z0-9_]+)/i)
  if (audioM) audioCodec = audioM[1].toLowerCase()

  return { codec, width, height, pixFmt, fps, audioCodec, duration }
}

async function probeVideo(path: string, ffmpegBin: string): Promise<ProbeResult> {
  const out = await new Promise<string>((resolve) => {
    const proc = spawn(ffmpegBin, ['-hide_banner', '-i', path, '-f', 'null', '-'], {
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let err = ''
    proc.stderr.on('data', (d) => (err += d.toString()))
    proc.on('error', () => resolve(err))
    proc.on('close', () => resolve(err))
  })
  const parsed = parseStreamInfo(out)
  if (parsed.codec === 'unknown') {
    throw new Error(`ffmpeg probe failed for ${path}: no video stream detected`)
  }
  return parsed
}

function runFFmpeg(
  bin: string,
  args: string[],
): Promise<{ stdout: string; stderr: string; code: number }> {
  return new Promise((resolve) => {
    const proc = spawn(bin, ['-y', '-hide_banner', '-loglevel', 'error', ...args], {
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let out = ''
    let err = ''
    proc.stdout.on('data', (d) => (out += d.toString()))
    proc.stderr.on('data', (d) => (err += d.toString()))
    proc.on('error', () => resolve({ stdout: out, stderr: err, code: -1 }))
    proc.on('close', (code) => resolve({ stdout: out, stderr: err, code }))
  })
}

async function downloadTo(url: string, destPath: string): Promise<number> {
  const res = await fetch(url, { redirect: 'follow' })
  if (!res.ok || !res.body) {
    throw new Error(`download failed: HTTP ${res.status} for ${url}`)
  }
  // Node 18+ fetch returns a web ReadableStream; convert to Node stream.
  const nodeReadable = Readable.fromWeb(res.body as unknown as import('stream/web').ReadableStream)
  const ws = createWriteStream(destPath)
  await new Promise<void>((resolve, reject) => {
    nodeReadable.pipe(ws)
    nodeReadable.on('error', reject)
    ws.on('error', reject)
    ws.on('finish', () => resolve())
  })
  const st = await stat(destPath)
  return st.size
}

async function uploadToHost(
  filePath: string,
  filename: string,
): Promise<string> {
  const fileBuf = await import('fs/promises').then((m) => m.readFile(filePath))

  // multipart/form-data built manually for tmpfiles.org
  const boundary = `----mcpboundary${randomUUID().replace(/-/g, '')}`
  const parts: Buffer[] = []

  const fileHeader =
    `--${boundary}\r\n` +
    `Content-Disposition: form-data; name="file"; filename="${filename}"\r\n` +
    `Content-Type: application/octet-stream\r\n\r\n`
  parts.push(Buffer.from(fileHeader, 'utf8'))
  parts.push(fileBuf)
  parts.push(Buffer.from(`\r\n--${boundary}--\r\n`, 'utf8'))

  const body = Buffer.concat(parts)

  const res = await fetch(TMPFILES_ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type': `multipart/form-data; boundary=${boundary}`,
      'Content-Length': String(body.length),
      'User-Agent': 'mcp-media-gen/1.0',
    },
    body,
  })

  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`upload failed: HTTP ${res.status} ${text.slice(0, 200)}`)
  }

  // Response shape: {"status":"success","data":{"url":"https://tmpfiles.org/<id>/<filename>"}}
  let json: { status?: string; data?: { url?: string } }
  try {
    json = await res.json()
  } catch {
    const text = await res.text().catch(() => '')
    throw new Error(`upload: bad response ${text.slice(0, 200)}`)
  }
  if (json.status !== 'success' || !json.data?.url) {
    throw new Error(`upload: ${JSON.stringify(json).slice(0, 200)}`)
  }

  // tmpfiles.org/<id>/<filename> is the page URL, not the direct file URL.
  // The direct URL is https://tmpfiles.org/dl/<id>/<filename> — but it requires
  // a per-upload hash. We scrape it from the page's HTML.
  const pageUrl = json.data.url
  const directUrl = await scrapeDirectUrl(pageUrl).catch(() => pageUrl)
  return directUrl
}

async function scrapeDirectUrl(pageUrl: string): Promise<string> {
  // pageUrl: https://tmpfiles.org/<id>/<filename>
  // Fetch the page, find the canonical direct link in the HTML.
  const res = await fetch(pageUrl, {
    headers: { 'User-Agent': 'mcp-media-gen/1.0' },
  })
  if (!res.ok) throw new Error(`page fetch HTTP ${res.status}`)
  const html = await res.text()
  // Look for the direct download URL with the embedded hash.
  // tmpfiles pages contain a meta refresh or anchor with /dl/<hash>/...
  const m = html.match(/https?:\/\/tmpfiles\.org\/dl\/[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+/)
  if (m) return m[0]
  // Fallback: construct /dl/<id>/<filename> without the hash (works for some files)
  const fallback = pageUrl.replace(/^(https:\/\/tmpfiles\.org)\//, '$1/dl/')
  return fallback
}

export interface MergeOptions {
  urls: string[]
  outName?: string
  onProgress?: (p: { stage: string; progress: number; message?: string }) => void
}

export interface MergeResult {
  url: string
  sizeBytes: number
  durationSeconds: number
}

/**
 * Concatenate videos in the given order and return a public URL.
 *
 * Strategy:
 *  1. Download each URL into a temp dir.
 *  2. Probe each via `ffmpeg -i` output parsing.
 *  3. If all videos share codec/resolution/fps, use concat demuxer (no re-encode).
 *  4. Otherwise, normalize each to H.264 yuv420p AAC 30fps, then concat.
 *  5. Upload merged file to tmpfiles.org.
 *  6. Delete temp files.
 */
export async function mergeVideos(opts: MergeOptions): Promise<MergeResult> {
  const { urls, outName } = opts
  if (!urls || urls.length === 0) {
    throw new Error('NO_INPUT_URLS')
  }
  if (urls.length === 1) {
    throw new Error('NEED_AT_LEAST_TWO_VIDEOS')
  }

  const ffmpegBin = await resolveFfmpegPath()

  const jobDir = join(tmpdir(), `mcp-merge-${randomUUID()}`)
  await mkdir(jobDir, { recursive: true })

  const tempFiles: string[] = []
  try {
    // 1. Download all
    for (let i = 0; i < urls.length; i++) {
      opts.onProgress?.({
        stage: 'downloading',
        progress: Math.round((i / urls.length) * 20),
        message: `تنزيل المقطع ${i + 1} من ${urls.length}`,
      })
      const ext = guessExt(urls[i])
      const dest = join(jobDir, `src-${String(i + 1).padStart(3, '0')}.${ext}`)
      await downloadTo(urls[i], dest)
      tempFiles.push(dest)
    }

    // 2. Probe all
    opts.onProgress?.({ stage: 'probing', progress: 25, message: 'تحليل خصائص المقاطع' })
    const probes = await Promise.all(tempFiles.map((p) => probeVideo(p, ffmpegBin)))

    // 3. Decide strategy
    const first = probes[0]
    const allSame = probes.every(
      (p) =>
        p.codec === first.codec &&
        p.width === first.width &&
        p.height === first.height &&
        p.pixFmt === first.pixFmt &&
        Math.abs(p.fps - first.fps) < 1,
    )

    const listFile = join(jobDir, 'concat-list.txt')

    if (allSame) {
      opts.onProgress?.({
        stage: 'concat-fast',
        progress: 35,
        message: 'الدمج السريع (بدون إعادة ترميز)',
      })
      // concat demuxer requires single-quote escaping
      await writeFile(
        listFile,
        tempFiles.map((f) => `file '${f.replace(/'/g, "'\\''")}'`).join('\n') + '\n',
        'utf8',
      )

      const outFile = join(jobDir, `${outName || 'merged'}.mp4`)
      const result = await runFFmpeg(ffmpegBin, [
        '-f', 'concat', '-safe', '0',
        '-i', listFile,
        '-c', 'copy',
        '-movflags', '+faststart',
        outFile,
      ])
      if (result.code !== 0) {
        throw new Error(`ffmpeg concat-copy failed: ${result.stderr.slice(0, 400)}`)
      }
      return await finalize(outFile, outName, probes, opts)
    } else {
      opts.onProgress?.({
        stage: 'normalize',
        progress: 35,
        message: 'تطبيع المقاطع قبل الدمج (H.264/AAC)',
      })
      // Re-encode each to a normalized intermediate
      const normalized: string[] = []
      const targetH = Math.max(...probes.map((p) => p.height))
      const targetW = Math.round((targetH * 16) / 9)
      for (let i = 0; i < tempFiles.length; i++) {
        const out = join(jobDir, `norm-${String(i + 1).padStart(3, '0')}.mp4`)
        const r = await runFFmpeg(ffmpegBin, [
          '-i', tempFiles[i],
          '-vf', `scale=${targetW}:${targetH}:force_original_aspect_ratio=decrease,pad=${targetW}:${targetH}:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=30`,
          '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20',
          '-pix_fmt', 'yuv420p',
          '-c:a', 'aac', '-b:a', '128k', '-ar', '48000', '-ac', '2',
          '-r', '30',
          out,
        ])
        if (r.code !== 0) {
          throw new Error(`ffmpeg normalize failed for clip ${i + 1}: ${r.stderr.slice(0, 400)}`)
        }
        normalized.push(out)
        opts.onProgress?.({
          stage: 'normalize',
          progress: 35 + Math.round(((i + 1) / tempFiles.length) * 30),
          message: `تطبيع المقطع ${i + 1} من ${tempFiles.length}`,
        })
      }

      await writeFile(
        listFile,
        normalized.map((f) => `file '${f.replace(/'/g, "'\\''")}'`).join('\n') + '\n',
        'utf8',
      )

      const outFile = join(jobDir, `${outName || 'merged'}.mp4`)
      const result = await runFFmpeg(ffmpegBin, [
        '-f', 'concat', '-safe', '0',
        '-i', listFile,
        '-c', 'copy',
        '-movflags', '+faststart',
        outFile,
      ])
      if (result.code !== 0) {
        throw new Error(`ffmpeg concat-final failed: ${result.stderr.slice(0, 400)}`)
      }
      return await finalize(outFile, outName, probes, opts)
    }
  } finally {
    // Always clean up
    await rm(jobDir, { recursive: true, force: true }).catch(() => {})
  }
}

async function finalize(
  outFile: string,
  outName: string | undefined,
  probes: ProbeResult[],
  opts: MergeOptions,
): Promise<MergeResult> {
  opts.onProgress?.({ stage: 'uploading', progress: 80, message: 'رفع النتيجة' })
  const st = await stat(outFile)
  if (st.size === 0) {
    throw new Error('merged file is empty')
  }
  const url = await uploadToHost(outFile, `${outName || 'merged'}.mp4`)
  opts.onProgress?.({ stage: 'done', progress: 100, message: 'اكتمل الدمج' })
  const uploadResult: UploadResult = { url }
  void uploadResult
  return {
    url,
    sizeBytes: st.size,
    durationSeconds: probes.reduce((a, p) => a + p.duration, 0),
  }
}

function guessExt(url: string): string {
  const m = url.split('?')[0].match(/\.(mp4|mov|mkv|webm|avi|m4v|ts|flv)(?:$)/i)
  if (m) return m[1].toLowerCase()
  return 'mp4'
}
