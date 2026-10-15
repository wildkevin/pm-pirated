import type { RunnerEvent } from '../../shared/ipc'

// One IPC listener for the whole app; views subscribe/unsubscribe here.
const listeners = new Set<(e: RunnerEvent) => void>()
let attached = false

export function onRunnerEvent(fn: (e: RunnerEvent) => void): () => void {
  if (!attached) {
    attached = true
    window.api.onRunnerEvent((e) => listeners.forEach((l) => l(e)))
  }
  listeners.add(fn)
  return () => listeners.delete(fn)
}
