import { readFileSync } from 'node:fs'
import { mkdir } from 'node:fs/promises'
import { dirname } from 'node:path'
import { stableStringify } from '../shared/format/stableJson'
import { writeFileAtomic } from './workspace/fsAtomic'

export interface Settings {
  recentWorkspaces: string[]
}

function load(file: string): Settings {
  try {
    const d = JSON.parse(readFileSync(file, 'utf8'))
    const recent = Array.isArray(d.recentWorkspaces) ? d.recentWorkspaces : []
    return { recentWorkspaces: recent.filter((s: unknown): s is string => typeof s === 'string') }
  } catch {
    return { recentWorkspaces: [] }
  }
}

/** App-level settings in %APPDATA%/pm-local/settings.json. */
export class AppSettings {
  private data: Settings

  constructor(private file: string) {
    this.data = load(file)
  }

  get(): Settings {
    return this.data
  }

  async rememberWorkspace(dir: string): Promise<void> {
    this.data.recentWorkspaces = [dir, ...this.data.recentWorkspaces.filter((d) => d !== dir)].slice(0, 10)
    await mkdir(dirname(this.file), { recursive: true })
    await writeFileAtomic(this.file, stableStringify(this.data))
  }
}
