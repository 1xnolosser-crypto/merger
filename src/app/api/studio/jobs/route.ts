import { NextResponse } from 'next/server'
import { randomUUID } from 'crypto'
import { db } from '@/lib/db'
import { isAuthorizedStudioRequest } from '@/lib/studio-auth'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

interface SceneInput {
  text: string
  durationSeconds: number
  imagePath?: string
}

export async function POST(req: Request) {
  if (!isAuthorizedStudioRequest(req)) {
    return NextResponse.json({ error: 'Unauthorized. Configure STUDIO_WORKER_TOKEN.' }, { status: 401 })
  }

  let body: {
    title?: string
    format?: 'shorts' | 'long'
    resolution?: '720p' | '1080p'
    scenes?: SceneInput[]
    narrationPath?: string
  }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 })
  }

  const title = typeof body.title === 'string' ? body.title.trim() : ''
  const format = body.format
  const scenes = body.scenes
  if (!title || title.length > 180) {
    return NextResponse.json({ error: 'title is required (max 180 characters).' }, { status: 400 })
  }
  if (format !== 'shorts' && format !== 'long') {
    return NextResponse.json({ error: 'format must be shorts or long.' }, { status: 400 })
  }
  const resolution = body.resolution === '1080p' ? '1080p' : '720p'
  if (!Array.isArray(scenes) || scenes.length < 1 || scenes.length > 60) {
    return NextResponse.json({ error: 'Provide between 1 and 60 scenes.' }, { status: 400 })
  }

  let totalSeconds = 0
  const safeScenes: SceneInput[] = []
  for (const scene of scenes) {
    if (!scene || typeof scene.text !== 'string' || !scene.text.trim() || scene.text.length > 600) {
      return NextResponse.json({ error: 'Each scene needs text (max 600 characters).' }, { status: 400 })
    }
    if (!Number.isFinite(scene.durationSeconds) || scene.durationSeconds < 2 || scene.durationSeconds > 60) {
      return NextResponse.json({ error: 'Scene duration must be between 2 and 60 seconds.' }, { status: 400 })
    }
    if (scene.imagePath !== undefined && (typeof scene.imagePath !== 'string' || scene.imagePath.length > 500)) {
      return NextResponse.json({ error: 'Invalid scene imagePath.' }, { status: 400 })
    }
    totalSeconds += scene.durationSeconds
    safeScenes.push({
      text: scene.text.trim(),
      durationSeconds: Math.round(scene.durationSeconds),
      ...(scene.imagePath ? { imagePath: scene.imagePath } : {}),
    })
  }

  if (format === 'shorts' && totalSeconds > 90) {
    return NextResponse.json({ error: 'Shorts render duration cannot exceed 90 seconds.' }, { status: 400 })
  }
  if (format === 'long' && totalSeconds > 1800) {
    return NextResponse.json({ error: 'Long video render duration cannot exceed 30 minutes.' }, { status: 400 })
  }

  const id = `studio_${randomUUID().replace(/-/g, '').slice(0, 24)}`
  const params = {
    title,
    format,
    resolution,
    scenes: safeScenes,
    ...(typeof body.narrationPath === 'string' && body.narrationPath.length <= 500
      ? { narrationPath: body.narrationPath }
      : {}),
    totalSeconds,
    renderMode: 'local-ffmpeg',
  }

  await db.task.create({
    data: {
      id,
      type: 'studio_render',
      status: 'queued',
      progress: 0,
      params: JSON.stringify(params),
    },
  })
  await db.taskLog.create({
    data: { taskId: id, level: 'info', message: 'Local studio render queued.', internal: false },
  })

  return NextResponse.json({ task_id: id, status: 'queued', format, total_seconds: totalSeconds }, { status: 201 })
}
