import { expect, test } from 'bun:test'
import {
  chmod,
  lstat,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  readlink,
  rm,
  symlink,
  unlink,
  writeFile,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const repository = resolve(import.meta.dir, '..')
const bash = Bun.which('bash')
if (!bash) throw new Error('Worktree tests require Bash')
const environment = {
  PATH: process.env.PATH,
  GIT_CONFIG_GLOBAL: '/dev/null',
  GIT_CONFIG_NOSYSTEM: '1',
  LC_ALL: 'C',
}
const shared = ['.codex', '.env.local', '.agent-sandbox.env']

async function run(command: string[], cwd: string, extra: NodeJS.ProcessEnv = {}) {
  const child = Bun.spawn(command, {
    cwd,
    env: { ...environment, ...extra },
    stdout: 'pipe',
    stderr: 'pipe',
  })
  const [code, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ])
  return { code, stdout, stderr }
}

async function git(cwd: string, ...args: string[]) {
  const result = await run(['git', ...args], cwd)
  if (result.code !== 0) throw new Error(result.stderr)
  return result.stdout.trim()
}

async function commit(cwd: string) {
  return git(
    cwd,
    '-c',
    'user.name=Worktree fixture',
    '-c',
    'user.email=fixture@example.invalid',
    '-c',
    'commit.gpgsign=false',
    'commit',
    '-qm',
    'Fixture change',
  )
}

async function withWorkspace(work: (workspace: string, main: string) => Promise<void>) {
  const workspace = await mkdtemp(join(tmpdir(), 'jig worktree fixture '))
  const main = join(workspace, 'main')
  try {
    await mkdir(join(main, 'scripts'), { recursive: true })
    await mkdir(join(main, '.agents'))
    for (const path of ['scripts/new-worktree.sh', '.gitignore']) {
      await writeFile(join(main, path), await readFile(join(repository, path)))
    }
    for (const path of ['.envrc', 'shell.nix', '.agents/guide.md']) {
      await writeFile(join(main, path), 'tracked fixture\n')
    }
    await git(main, 'init', '-q', '-b', 'main')
    await git(main, 'add', '.')
    await commit(main)
    for (const name of ['.envrc', 'shell.nix', '.agents']) {
      await symlink(`main/${name}`, join(workspace, name))
    }
    await mkdir(join(workspace, '.codex'))
    for (const name of ['.env.local', '.agent-sandbox.env']) {
      await writeFile(join(workspace, name), 'TEST_ONLY=original\n')
    }
    for (const name of shared) await symlink(`../${name}`, join(main, name))
    await mkdir(join(main, 'node_modules'))
    await mkdir(join(main, '.direnv'))
    await mkdir(join(main, '.tmp'))
    await writeFile(join(main, '.env'), 'TEST_ONLY=local\n')
    await work(workspace, main)
  } finally {
    await rm(workspace, { recursive: true, force: true })
  }
}

function create(workspace: string, main: string, ...args: string[]) {
  return run([bash as string, join(main, 'scripts/new-worktree.sh'), ...args], workspace)
}

test('worktrees preserve both link directions, shared updates, and independent source and indexes', async () => {
  await withWorkspace(async (workspace, main) => {
    const originalHead = await git(main, 'rev-parse', 'HEAD')
    expect((await create(workspace, main, 'work/first', 'first')).code).toBe(0)
    await git(main, 'branch', 'second')
    expect((await create(workspace, main, 'second')).code).toBe(0)
    for (const name of ['first', 'second']) {
      const checkout = join(workspace, name)
      expect(await git(checkout, 'status', '--porcelain')).toBe('')
      for (const entry of shared) expect(await readlink(join(checkout, entry))).toBe(`../${entry}`)
      for (const entry of ['.envrc', 'shell.nix', '.agents']) {
        expect((await lstat(join(checkout, entry))).isSymbolicLink()).toBe(false)
        expect(await readlink(join(workspace, entry))).toBe(`main/${entry}`)
      }
      const entries = await readdir(checkout)
      for (const entry of ['.claude', '.env', 'node_modules', '.direnv', '.tmp']) {
        expect(entries).not.toContain(entry)
      }
    }
    expect(await readdir(workspace)).not.toContain('.claude')
    await writeFile(join(workspace, '.env.local'), 'TEST_ONLY=updated\n')
    for (const name of ['main', 'first', 'second']) {
      expect(await readFile(join(workspace, name, '.env.local'), 'utf8')).toBe(
        'TEST_ONLY=updated\n',
      )
    }
    await writeFile(join(workspace, 'first/.envrc'), 'first checkout edit\n')
    await git(join(workspace, 'first'), 'add', '.envrc')
    expect(await git(join(workspace, 'first'), 'diff', '--cached', '--name-only')).toBe('.envrc')
    expect(await git(main, 'status', '--porcelain')).toBe('')
    expect(await git(join(workspace, 'second'), 'status', '--porcelain')).toBe('')
    await commit(join(workspace, 'first'))
    expect(await git(main, 'rev-parse', 'HEAD')).toBe(originalHead)
    expect(await git(join(workspace, 'second'), 'rev-parse', 'HEAD')).toBe(originalHead)
    expect(await readFile(join(workspace, '.envrc'), 'utf8')).toBe('tracked fixture\n')
  })
})

test('bad arguments and occupied destinations do not create branches or unfinished worktrees', async () => {
  await withWorkspace(async (workspace, main) => {
    await symlink('missing-target', join(workspace, 'dangling'))
    const beforeEntries = await readdir(workspace)
    const beforeTrees = await git(main, 'worktree', 'list', '--porcelain')
    const beforeRefs = await git(main, 'show-ref')
    for (const args of [
      [],
      [''],
      ['bad..branch', 'invalid'],
      ['work/name'],
      ['safe', '../escaped'],
      ['safe', '/absolute'],
      ['safe', '.'],
      ['safe', ''],
      ['safe', 'directory', 'extra'],
      ['safe', 'main'],
      ['safe', 'dangling'],
      ['main', 'already-checked-out'],
    ]) {
      const result = await create(workspace, main, ...args)
      expect(result.code).not.toBe(0)
      expect(await readdir(workspace)).toEqual(beforeEntries)
      expect(await git(main, 'worktree', 'list', '--porcelain')).toBe(beforeTrees)
      expect(await git(main, 'show-ref')).toBe(beforeRefs)
    }
  })
})

test('broken shared links fail before creation without manufacturing replacement state', async () => {
  await withWorkspace(async (workspace, main) => {
    await unlink(join(workspace, '.agent-sandbox.env'))
    const result = await create(workspace, main, 'broken')
    expect(result.code).not.toBe(0)
    expect(result.stderr).toContain('Shared entry must exist')
    expect(await readdir(workspace)).not.toContain('broken')
    expect(await readdir(workspace)).not.toContain('.agent-sandbox.env')
  })
})

test('an existing branch with a tracked shared path is preserved and refused before creation', async () => {
  await withWorkspace(async (workspace, main) => {
    const authoring = join(workspace, 'authoring')
    await git(main, 'worktree', 'add', '-b', 'conflict', authoring)
    await writeFile(join(authoring, '.codex'), 'tracked branch content\n')
    await git(authoring, 'add', '-f', '.codex')
    await commit(authoring)
    await git(main, 'worktree', 'remove', authoring)
    const beforeRefs = await git(main, 'show-ref')
    const result = await create(workspace, main, 'conflict')
    expect(result.code).not.toBe(0)
    expect(result.stderr).toContain('Target branch tracks .codex')
    expect(await readdir(workspace)).not.toContain('conflict')
    expect(await git(main, 'show-ref')).toBe(beforeRefs)
    expect(await git(main, 'show', 'conflict:.codex')).toBe('tracked branch content')
  })
})

test('a late link failure reports the retained checkout without deleting source', async () => {
  await withWorkspace(async (workspace, main) => {
    const tools = join(workspace, 'tools')
    await mkdir(tools)
    await writeFile(join(tools, 'ln'), '#!/bin/sh\nexit 23\n', { mode: 0o755 })
    const result = await run(
      [bash as string, join(main, 'scripts/new-worktree.sh'), 'link-failure'],
      workspace,
      { PATH: `${tools}:${process.env.PATH}` },
    )
    expect(result.code).toBe(23)
    expect(result.stderr).toContain('Setup incomplete; worktree retained for inspection:')
    expect(await git(join(workspace, 'link-failure'), 'branch', '--show-current')).toBe(
      'link-failure',
    )
    expect(await readFile(join(workspace, 'link-failure/.envrc'), 'utf8')).toBe('tracked fixture\n')
    expect(await git(main, 'status', '--porcelain')).toBe('')
  })
})

test.skipIf(process.getuid?.() === 0)(
  'an unwritable workspace fails without a fallback location',
  async () => {
    await withWorkspace(async (workspace, main) => {
      const before = await readdir(workspace)
      await chmod(workspace, 0o555)
      try {
        const result = await create(workspace, main, 'unwritable')
        expect(result.code).not.toBe(0)
        expect(result.stderr).toContain('Workspace is not writable')
        expect(await readdir(workspace)).toEqual(before)
        expect(await git(main, 'branch', '--list', 'unwritable')).toBe('')
      } finally {
        await chmod(workspace, 0o755)
      }
    })
  },
)
