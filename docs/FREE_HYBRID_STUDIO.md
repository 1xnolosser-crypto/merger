# Autonomous AI Video Studio — Free Hybrid Worker

This branch adds the first safe local-rendering stage to Merger. It deliberately does **not** call KIE, Agnes, OpenRouter, or any paid generation API.

## What is implemented

- A protected studio job queue backed by the existing Turso \`Task\` table (no schema migration required).
- Authenticated worker claim, progress, and completion endpoints.
- A Windows PowerShell worker that renders scene cards or supplied local images with FFmpeg.
- Shorts (9:16) and long-form (16:9) output, 720p by default and optional 1080p.
- Optional narration audio file muxed into the final MP4.
- Finished MP4s remain on the Windows worker computer; the cloud stores only the local path/status.
- Legacy paid image/video tasks are failed without polling KIE, even if they contain an old provider task ID.

## What is not implemented yet

This is a rendering/assembly worker, not a full generative-video engine. It does not yet write scripts with an LLM, synthesize speech, generate images, animate characters, or publish to social networks. A scene without an \`imagePath\` is rendered as a clean text card on a dark background. To use visuals now, provide local image paths in the job payload. The next stages can add local Piper TTS and ComfyUI adapters without paid API calls.

## 1. Set a strong worker token in Vercel Preview

Generate a random token in PowerShell:

\`\`\`powershell
$bytes = New-Object byte[] 32
$rng = [Security.Cryptography.RandomNumberGenerator]::Create()
$rng.GetBytes($bytes)
$token = [Convert]::ToBase64String($bytes)
$token
\`\`\`

Copy the generated value. In Vercel, open the \`merger\` project → Settings → Environment Variables. Add \`STUDIO_WORKER_TOKEN\` with that value for **Preview only**, then redeploy the \`feat/free-hybrid-video-studio\` preview. Do not add it to GitHub or expose it in screenshots.

Use the same token in the local PowerShell session:

\`\`\`powershell
$env:STUDIO_WORKER_TOKEN = 'PASTE_THE_TOKEN_HERE'
\`\`\`

The Studio tab also asks for the token when queueing a job. It is kept only in the current page state and is not written to the repository.

## 2. Install / verify FFmpeg on Windows

The worker expects \`ffmpeg.exe\` on PATH. Verify:

\`\`\`powershell
ffmpeg -version
\`\`\`

If FFmpeg is installed elsewhere, pass its full path with \`-FfmpegPath 'C:\\Tools\\ffmpeg\\bin\\ffmpeg.exe'\`. No GPU or Python package is required for this first rendering stage.

## 3. Start the worker

From a PowerShell window in the repository:

\`\`\`powershell
Set-ExecutionPolicy -Scope Process Bypass -Force
.\\scripts\\windows-studio-worker.ps1 -BaseUrl 'https://merger-git-feat-free-hybrid-video-studio-shin-5c0c.vercel.app'
\`\`\`

Keep that PowerShell window open. It polls the queue every 8 seconds. Press Ctrl+C to stop. The default output folder is \`renders\` in the repository root. The default resolution is 720p to reduce CPU load on older computers; choose 1080p in the Studio tab when desired.

## 4. Create a render job

Open the Studio tab in the Preview app, enter the same worker token, choose Shorts or long-form, and submit scene text (one scene per line). Optionally provide a local narration path such as \`C:\\Media\\narration.wav\`.

For a more visual job, the API also accepts \`imagePath\` for each scene. Example request (the image/audio paths must exist on the Windows worker):

\`\`\`powershell
$body = @{
  title = 'Why Earth rotation feels invisible'
  format = 'shorts'
  resolution = '720p'
  scenes = @(
    @{ text = 'The Earth is rotating beneath your feet.'; durationSeconds = 8; imagePath = 'C:\\Media\\earth-01.jpg' }
    @{ text = 'You and the atmosphere move with it.'; durationSeconds = 8; imagePath = 'C:\\Media\\earth-02.jpg' }
  )
  narrationPath = 'C:\\Media\\narration.wav'
} | ConvertTo-Json -Depth 8
Invoke-RestMethod -Uri 'https://YOUR-PREVIEW-URL/api/studio/jobs' -Method Post -Headers @{ Authorization = "Bearer $env:STUDIO_WORKER_TOKEN" } -ContentType 'application/json' -Body $body
\`\`\`

The result is written under \`renders/<task_id>/shorts.mp4\` or \`long-video.mp4\`. Check the task tracker for its status; the returned \`local_path\` points to the worker computer, not a public download URL.

## Zero-cost guard

- \`withKeyRotation()\` now fails closed and never invokes KIE.
- The KIE key creation endpoint rejects new keys.
- Image/video task refresh never polls KIE, including legacy tasks.
- The local worker only invokes FFmpeg and the protected Merger queue endpoints.
- No paid provider fallback exists. A missing local dependency causes a visible failed task rather than a paid fallback.

The existing video merge endpoint still uploads merged outputs to tmpfiles.org; that external host is separate from generation and has its own availability/retention terms. The new Studio worker does not upload rendered files.
