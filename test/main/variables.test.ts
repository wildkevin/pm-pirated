import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeEach, describe, expect, it } from 'vitest'
import { fakeCrypt } from '../../src/main/crypto'
import { SecretStore } from '../../src/main/secrets'
import { createCollection, initWorkspace } from '../../src/main/workspace/store'
import {
  Variables,
  createEnvironment,
  deleteEnvironment,
  listEnvironments,
  renameEnvironment,
  type VariableRow,
} from '../../src/main/workspace/variables'

let root: string
let secretsFile: string
let vars: Variables

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'pml-var-'))
  await initWorkspace(root)
  secretsFile = join(await mkdtemp(join(tmpdir(), 'pml-sec-')), 'secrets.json')
  vars = new Variables(root, new SecretStore(secretsFile, fakeCrypt))
})

const row = (key: string, initial: string, extra: Partial<VariableRow> = {}): VariableRow => ({
  key,
  type: 'default',
  initial,
  current: initial,
  enabled: true,
  ...extra,
})

describe('initial vs current values', () => {
  it('keeps initial values in the file and current values in .pmlocal', async () => {
    const env = await createEnvironment(root, 'Dev')
    await vars.write(`env:${env}`, [row('base', 'http://dev'), row('user', 'alice', { current: 'bob' })])
    const file = JSON.parse(await readFile(join(root, env), 'utf8'))
    expect(file.values.map((v: { key: string; value: string }) => [v.key, v.value])).toEqual([
      ['base', 'http://dev'],
      ['user', 'alice'],
    ])
    expect(await readFile(join(root, '.pmlocal', 'current-values.json'), 'utf8')).toContain('bob')
    expect((await vars.read(`env:${env}`)).find((r) => r.key === 'user')).toMatchObject({ initial: 'alice', current: 'bob' })
    expect(await vars.effective(`env:${env}`)).toEqual([
      { key: 'base', value: 'http://dev' },
      { key: 'user', value: 'bob' },
    ])
  })

  it('never writes secret values to the workspace', async () => {
    await vars.write('globals', [row('token', 'abc123', { type: 'secret', current: 'xyz789' })])
    const onDisk = await readFile(join(root, 'globals.json'), 'utf8')
    expect(onDisk).not.toContain('abc123')
    expect(onDisk).toContain('"secret"')
    expect(await readFile(join(root, '.pmlocal', 'current-values.json'), 'utf8')).not.toContain('xyz789')
    expect(await readFile(secretsFile, 'utf8')).not.toContain('xyz789')
    const again = new Variables(root, new SecretStore(secretsFile, fakeCrypt))
    expect(await again.read('globals')).toEqual([row('token', 'abc123', { type: 'secret', current: 'xyz789' })])
  })

  it('stores collection variables in collection.json with the disabled flag', async () => {
    const col = await createCollection(root, 'C')
    await vars.write(`col:${col}`, [row('a', '1'), row('b', '2', { enabled: false })])
    const doc = JSON.parse(await readFile(join(root, col, 'collection.json'), 'utf8'))
    expect(doc.variable).toEqual([
      { key: 'a', value: '1', type: 'default' },
      { key: 'b', value: '2', type: 'default', disabled: true },
    ])
    expect(await vars.effective(`col:${col}`)).toEqual([{ key: 'a', value: '1' }])
  })
})

describe('script changes', () => {
  it('turns changed values into current values, adds new keys, removes unset keys, keeps disabled rows', async () => {
    const env = await createEnvironment(root, 'Dev')
    await vars.write(`env:${env}`, [row('token', 'T0'), row('gone', 'x'), row('off', 'o', { enabled: false })])
    await vars.applyChanges(`env:${env}`, [
      { key: 'token', value: 'T1' },
      { key: 'fresh', value: 'F' },
    ])
    expect(await vars.read(`env:${env}`)).toEqual([
      row('token', 'T0', { current: 'T1' }),
      row('off', 'o', { enabled: false }),
      row('fresh', '', { current: 'F' }),
    ])
  })

  it('does not touch files when nothing changed', async () => {
    await vars.write('globals', [row('a', '1')])
    const before = await readFile(join(root, 'globals.json'), 'utf8')
    await writeFile(join(root, 'globals.json'), before.replace('\n', '\n\n'))
    await vars.applyChanges('globals', [{ key: 'a', value: '1' }])
    expect(await readFile(join(root, 'globals.json'), 'utf8')).toBe(before.replace('\n', '\n\n'))
  })
})

describe('environments', () => {
  it('creates, lists, renames (keeping values) and deletes environments', async () => {
    const dev = await createEnvironment(root, 'Dev')
    await createEnvironment(root, 'Prod')
    await vars.write(`env:${dev}`, [row('u', 'a', { current: 'local' }), row('s', 'sec', { type: 'secret' })])
    expect((await listEnvironments(root)).map((e) => e.name)).toEqual(['Dev', 'Prod'])

    const renamed = await renameEnvironment(root, dev, 'Development')
    expect(renamed).toBe('environments/Development.env.json')
    expect(await vars.read(`env:${renamed}`)).toEqual([row('u', 'a', { current: 'local' }), row('s', 'sec', { type: 'secret' })])

    await deleteEnvironment(root, renamed, vars)
    expect((await listEnvironments(root)).map((e) => e.name)).toEqual(['Prod'])
    expect(await readFile(join(root, '.pmlocal', 'current-values.json'), 'utf8')).not.toContain('local')
    expect(await readFile(secretsFile, 'utf8')).toBe('{}\n')
  })

  it('flags a malformed environment and refuses to overwrite it', async () => {
    await createEnvironment(root, 'Dev')
    await writeFile(join(root, 'environments', 'Bad.env.json'), '{ nope')
    expect((await listEnvironments(root)).find((e) => e.id.endsWith('Bad.env.json'))?.error).toMatch(/JSON/)
    await expect(vars.write('env:environments/Bad.env.json', [])).rejects.toThrow(/fix it first/)
    expect(await readFile(join(root, 'environments', 'Bad.env.json'), 'utf8')).toBe('{ nope')
  })

  it('rejects scope ids that point outside the workspace', async () => {
    for (const bad of ['env:../x.env.json', 'env:environments/../../x.env.json', 'col:../x', 'nope']) {
      await expect(vars.read(bad), bad).rejects.toThrow()
    }
  })
})
