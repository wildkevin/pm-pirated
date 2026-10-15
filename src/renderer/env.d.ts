import type { Api, AppEvents } from '../shared/ipc'

declare global {
  interface Window {
    api: Api & AppEvents
  }
}
