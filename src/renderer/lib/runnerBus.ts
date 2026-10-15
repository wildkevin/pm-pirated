import type { MockEvent } from '../../shared/mock'
import type { CaptureEvent, RunnerEvent } from '../../shared/ipc'

// One IPC listener per event type for the whole app; views subscribe/unsubscribe here.
function bus<E>(attach: (cb: (e: E) => void) => void) {
  const listeners = new Set<(e: E) => void>()
  let attached = false
  return (fn: (e: E) => void): (() => void) => {
    if (!attached) {
      attached = true
      attach((e) => listeners.forEach((l) => l(e)))
    }
    listeners.add(fn)
    return () => listeners.delete(fn)
  }
}

export const onRunnerEvent = bus<RunnerEvent>((cb) => window.api.onRunnerEvent(cb))
export const onMockEvent = bus<MockEvent>((cb) => window.api.onMockEvent(cb))
export const onCaptureEvent = bus<CaptureEvent>((cb) => window.api.onCaptureEvent(cb))
