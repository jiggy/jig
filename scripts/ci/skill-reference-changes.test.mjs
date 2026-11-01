import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import {
  prepareSkillChanges,
  skillChangesTree,
  validateSkillChanges,
} from './skill-reference-changes.mjs'

const repository = new URL('../../', import.meta.url)
const identity = { runId: '17', runAttempt: '2' }
const git = (root, ...args) =>
  execFileSync('git', ['-C', root, ...args], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim()

async function put(root, path, content) {
  await mkdir(dirname(join(root, path)), { recursive: true })
  await writeFile(join(root, path), content)
}

async function fixture(t) {
  await mkdir(new URL('.tmp/', repository), { recursive: true })
  const root = await mkdtemp(new URL('.tmp/skill-changes-', repository).pathname)
  t.after(() => rm(root, { recursive: true, force: true }))
  git(root, 'init', '-q')
  git(root, 'config', 'user.name', 'Test Author')
  git(root, 'config', 'user.email', 'test@example.invalid')
  await put(root, 'skills/jig/SKILL.md', '# Authored skill\n')
  await put(root, 'skills/jig/reference/guide/start.md', '# Old source\n')
  await put(root, 'skills/jig/reference/old.md', '# Removed reference\n')
  await put(root, 'README.md', '# Unrelated source\n')
  git(root, 'add', '--all')
  git(root, 'commit', '-qm', 'base')
  const source = git(root, 'rev-parse', 'HEAD')
  await put(root, 'skills/jig/reference/guide/start.md', '# Updated source\n')
  await put(root, 'skills/jig/reference/spec/machine.json', '{"type":"object"}\n')
  await rm(join(root, 'skills/jig/reference/old.md'))
  git(root, 'add', '--', 'skills/jig/reference')
  return { root, source, identity }
}

test('transfers additions, edits, and removals without executing or overwriting the PR checkout', async (t) => {
  const options = await fixture(t)
  const expected = git(options.root, 'write-tree')
  const prepared = await prepareSkillChanges(options)
  assert.equal(prepared.files.length, 3)
  assert.ok(prepared.files.some((file) => file.content === null))
  await put(options.root, 'README.md', 'Retain unstaged author changes\n')
  await put(options.root, 'skills/jig/reference/untracked.md', 'Retain untracked work\n')
  const indexBefore = await readFile(join(options.root, '.git/index'))
  const tree = await skillChangesTree({ ...options, prepared })
  assert.equal(tree, expected)
  assert.deepEqual(await readFile(join(options.root, '.git/index')), indexBefore)
  assert.equal(
    await readFile(join(options.root, 'README.md'), 'utf8'),
    'Retain unstaged author changes\n',
  )
  assert.equal(
    await readFile(join(options.root, 'skills/jig/reference/untracked.md'), 'utf8'),
    'Retain untracked work\n',
  )
  assert.equal(git(options.root, 'show', `${tree}:skills/jig/SKILL.md`), '# Authored skill')
})

test('refuses stale identities, unrelated paths, changed bases, duplicate files, and corrupt encodings', async (t) => {
  const options = await fixture(t)
  const prepared = await prepareSkillChanges(options)
  const variants = [
    { ...prepared, sourceRevision: '1'.repeat(40) },
    { ...prepared, runId: '18' },
    { ...prepared, runAttempt: '3' },
    { ...prepared, extra: true },
    { ...prepared, files: [] },
    { ...prepared, files: [...prepared.files, prepared.files[0]] },
    { ...prepared, files: [{ ...prepared.files[0], path: 'README.md' }] },
    { ...prepared, files: [{ ...prepared.files[0], path: 'skills/jig/reference/../../SKILL.md' }] },
    { ...prepared, files: [{ ...prepared.files[0], path: 'skills/jig/reference/x\nREADME.md' }] },
    { ...prepared, files: [{ ...prepared.files[0], before: '1'.repeat(40) }] },
    { ...prepared, files: [{ ...prepared.files[0], content: 'broken base64' }] },
    {
      ...prepared,
      files: [{ path: 'skills/jig/reference/absent.md', before: null, content: null }],
    },
  ]
  const indexBefore = await readFile(join(options.root, '.git/index'))
  for (const variant of variants) {
    assert.throws(() => validateSkillChanges({ ...options, prepared: variant }))
    await assert.rejects(skillChangesTree({ ...options, prepared: variant }))
  }
  assert.deepEqual(await readFile(join(options.root, '.git/index')), indexBefore)
})

test('refuses generator changes outside generated references and nonregular outputs', async (t) => {
  const options = await fixture(t)
  await put(options.root, 'README.md', '# Unexpected staged change\n')
  git(options.root, 'add', 'README.md')
  await assert.rejects(prepareSkillChanges(options), /outside regular generated references/)
  git(options.root, 'reset', '-q', 'HEAD', '--', 'README.md')
  await symlink('../../SKILL.md', join(options.root, 'skills/jig/reference/link.md'))
  git(options.root, 'add', '--', 'skills/jig/reference/link.md')
  await assert.rejects(prepareSkillChanges(options), /outside regular generated references/)
})

test('refuses generated paths through a source symlink without touching its target', async (t) => {
  const options = await fixture(t)
  git(options.root, 'reset', '--hard', '-q', options.source)
  await symlink('../../../../outside', join(options.root, 'skills/jig/reference/link'))
  git(options.root, 'add', '--', 'skills/jig/reference/link')
  git(options.root, 'commit', '-qm', 'linked ancestor')
  const source = git(options.root, 'rev-parse', 'HEAD')
  const prepared = {
    version: 1,
    sourceRevision: source,
    ...identity,
    files: [
      {
        path: 'skills/jig/reference/link/escape.md',
        before: null,
        content: Buffer.from('escape').toString('base64'),
      },
    ],
  }
  await assert.rejects(skillChangesTree({ ...options, source, prepared }), /non-directory ancestor/)
})

test('the trusted CLI prepares, validates, and reconstructs a tree with exact attempt binding', async (t) => {
  const options = await fixture(t)
  const script = fileURLToPath(new URL('skill-reference-changes.mjs', import.meta.url))
  const path = join(options.root, 'prepared.json')
  const env = {
    ...process.env,
    GITHUB_RUN_ID: '99',
    GITHUB_RUN_ATTEMPT: '4',
    SKILL_REFERENCE_RUN_ID: identity.runId,
    SKILL_REFERENCE_RUN_ATTEMPT: identity.runAttempt,
  }
  const invoke = (command, selectedEnv = env) =>
    execFileSync(process.execPath, [script, command, options.root, options.source, path], {
      env: selectedEnv,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    }).trim()
  assert.equal(invoke('prepare'), '3')
  assert.equal(invoke('validate'), '')
  assert.equal(invoke('tree'), git(options.root, 'write-tree'))
  assert.throws(
    () => invoke('validate', { ...env, SKILL_REFERENCE_RUN_ATTEMPT: '3' }),
    /mismatched source\/run identity/,
  )
})

test('generated commits are direct children and the branch lease preserves concurrent updates and resets', async (t) => {
  const options = await fixture(t)
  const bare = join(options.root, 'remote.git')
  execFileSync('git', ['init', '--bare', '-q', bare])
  git(options.root, 'remote', 'add', 'origin', bare)
  git(options.root, 'push', '-q', 'origin', `${options.source}:refs/heads/feature`)
  const prepared = await prepareSkillChanges(options)
  const tree = await skillChangesTree({ ...options, prepared })
  const commit = git(
    options.root,
    'commit-tree',
    tree,
    '-p',
    options.source,
    '-m',
    'generated references',
  )
  assert.equal(git(options.root, 'rev-parse', `${commit}^`), options.source)
  git(
    options.root,
    'push',
    '-q',
    `--force-with-lease=refs/heads/feature:${options.source}`,
    'origin',
    `${commit}:refs/heads/feature`,
  )
  const newer = git(
    options.root,
    'commit-tree',
    tree,
    '-p',
    commit,
    '-m',
    'concurrent author update',
  )
  git(options.root, 'push', '-q', 'origin', `${newer}:refs/heads/feature`)
  const stale = git(
    options.root,
    'commit-tree',
    tree,
    '-p',
    commit,
    '-m',
    'stale generated references',
  )
  assert.throws(() =>
    git(
      options.root,
      'push',
      '-q',
      `--force-with-lease=refs/heads/feature:${commit}`,
      'origin',
      `${stale}:refs/heads/feature`,
    ),
  )
  assert.equal(git(bare, 'rev-parse', 'refs/heads/feature'), newer)
  git(bare, 'update-ref', 'refs/heads/feature', options.source, newer)
  assert.throws(() =>
    git(
      options.root,
      'push',
      '-q',
      `--force-with-lease=refs/heads/feature:${commit}`,
      'origin',
      `${stale}:refs/heads/feature`,
    ),
  )
  assert.equal(git(bare, 'rev-parse', 'refs/heads/feature'), options.source)
})
