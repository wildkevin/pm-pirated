import { rename, rm, writeFile } from 'node:fs/promises'

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

/** Writes via a temp file + rename so a crash never leaves a half-written file. */
export async function writeFileAtomic(file: string, data: string): Promise<void> {
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`
  await writeFile(tmp, data, 'utf8')
  // Windows: antivirus or the file watcher can briefly lock the target; retry a few times.
  for (let attempt = 0; ; attempt++) {
    try {
      await rename(tmp, file)
      return
    } catch (e) {
      const code = (e as NodeJS.ErrnoException).code
      if (attempt < 5 && (code === 'EPERM' || code === 'EBUSY' || code === 'EACCES')) {
        await sleep(50 * (attempt + 1))
        continue
      }
      await rm(tmp, { force: true })
      throw e
    }
  }
}
