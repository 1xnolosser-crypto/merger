// In-process event bus for task progress.
//
// task-worker emits progress updates here; the WebSocket mini-service
// (mini-services/ws-bus) ALSO polls the DB as a fallback for missed events
// across process boundaries.

type Listener = (progress: number, status: string) => void

const listeners = new Map<string, Set<Listener>>()

export function emitProgress(taskId: string, progress: number, status: string) {
  const set = listeners.get(taskId)
  if (!set) return
  for (const fn of set) {
    try {
      fn(progress, status)
    } catch {
      // ignore
    }
  }
}

export function subscribeProgress(taskId: string, fn: Listener): () => void {
  let set = listeners.get(taskId)
  if (!set) {
    set = new Set()
    listeners.set(taskId, set)
  }
  set.add(fn)
  return () => {
    const s = listeners.get(taskId)
    if (!s) return
    s.delete(fn)
    if (s.size === 0) listeners.delete(taskId)
  }
}
