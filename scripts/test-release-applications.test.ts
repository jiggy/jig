import { expect, test } from 'bun:test'
import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

test('complete source applications install frozen candidates with a fresh Bun cache', () => {
  const root = resolve(import.meta.dir, '..')
  const temporary = mkdtempSync(join(tmpdir(), 'jig-application-candidates-'))
  try {
    const node = process.env.FLOW_NODE || Bun.which('node')
    expect(node).toBeTruthy()
    const env = {
      ...process.env,
      FLOW_NODE: node!,
      BUN_INSTALL_CACHE_DIR: join(temporary, 'cache'),
    }
    // This is local source qualification, not a claim about an ambient CI bundle.
    delete env.CI_CANDIDATE_BUNDLE
    delete env.GITHUB_ACTIONS
    delete env.GITHUB_SHA
    const reports = join(temporary, 'reports')
    const result = spawnSync(
      'bash',
      [
        'scripts/test-release.sh',
        '--targets',
        'source-applications',
        '--report-directory',
        reports,
      ],
      { cwd: root, env, encoding: 'utf8', timeout: 120_000, maxBuffer: 16 * 1024 * 1024 },
    )
    expect(result.error, `${result.stdout}\n${result.stderr}`).toBeUndefined()
    expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0)
    const output = `${result.stdout}\n${result.stderr}`
    expect(output.match(/packages installed/g)?.length).toBe(6)
    // The production normalizer verifies copied tests against exact source bytes.
    const report = readFileSync(join(reports, 'source-applications.xml'), 'utf8')
    for (const application of [
      'photo-organiser',
      'tested-patch',
      'software-factory',
      'support-case',
      'contact-import',
      'incident-brief',
    ])
      expect(report).toContain(`${application}/test/`)
  } finally {
    rmSync(temporary, { recursive: true, force: true })
  }
}, 130_000)
