import { execFileSync, spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const extensions = ['js', 'jsx', 'mjs', 'cjs', 'ts', 'tsx', 'mts', 'cts']
const files = execFileSync(
  'git',
  [
    'ls-files',
    '-z',
    '--cached',
    '--others',
    '--exclude-standard',
    '--deduplicate',
    '--',
    ...extensions.map((extension) => `*.${extension}`),
  ],
  { encoding: 'utf8' },
)
  .split('\0')
  .filter((path) => path && existsSync(path))
  .map((path) => `./${path}`)
if (!files.length) throw new Error('No repository sources to check for focused Bun tests')

// Select files through Git, independently of the normal lint exclusions.
const temporary = mkdtempSync(join(tmpdir(), 'jig-bun-focus-'))
try {
  const configuration = join(temporary, 'biome.json')
  writeFileSync(configuration, '{}\n')
  const biome = fileURLToPath(import.meta.resolve('@biomejs/biome/bin/biome'))
  const result = spawnSync(
    'xargs',
    [
      '-0',
      process.execPath,
      biome,
      'lint',
      `--config-path=${configuration}`,
      '--only=suspicious/noFocusedTests',
      '--error-on-warnings',
    ],
    { input: files.join('\0') + '\0', stdio: ['pipe', 'inherit', 'inherit'] },
  )
  if (result.error) throw result.error
  process.exitCode = result.status ?? 1
} finally {
  rmSync(temporary, { recursive: true, force: true })
}
