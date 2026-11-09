#!/usr/bin/env bun
// Reusable orchestrator to bump and qualify a new Bun runtime across the workspace.
import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { readdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'

const root = resolve(import.meta.dir, '../..')
const [newVersion, explicitRevision] = process.argv.slice(2)

if (!newVersion || !/^\d+\.\d+\.\d+$/.test(newVersion)) {
  console.error('Usage: bun scripts/ci/bump-qualified-bun.ts <version> [revision]')
  console.error('Example: bun scripts/ci/bump-qualified-bun.ts 1.4.5')
  process.exit(1)
}

// 1. Resolve git commit revision for the Bun tag if not explicitly supplied
let revision = explicitRevision
if (!revision) {
  console.log(`Resolving commit revision for bun-v${newVersion}...`)
  try {
    const stdout = execFileSync(
      'git',
      ['ls-remote', 'https://github.com/oven-sh/bun.git', `refs/tags/bun-v${newVersion}`],
      { encoding: 'utf8' },
    ).trim()
    const match = stdout.match(/^([0-9a-f]{40})\s+refs\/tags\/bun-v/)
    if (!match) throw new Error(`Tag refs/tags/bun-v${newVersion} not found`)
    revision = match[1]
    console.log(`Resolved revision: ${revision}`)
  } catch (error) {
    console.error(`Failed to resolve Bun revision: ${(error as Error).message}`)
    console.error('Supply the commit SHA explicitly as the second argument.')
    process.exit(1)
  }
}

// 2. Read current metadata from single source of truth
const specPath = join(root, 'scripts/ci/qualified-bun.json')
const currentSpec = JSON.parse(await readFile(specPath, 'utf8'))
const oldVersion = currentSpec.version as string
const oldRevision = currentSpec.revision as string

console.log(`Updating qualified Bun from ${oldVersion} (${oldRevision.slice(0, 8)}) to ${newVersion} (${revision.slice(0, 8)})...`)

// Update scripts/ci/qualified-bun.json
currentSpec.version = newVersion
currentSpec.revision = revision
await writeFile(specPath, JSON.stringify(currentSpec, null, 2) + '\n')

// 3. Update packages/jig/package.json (@oven/bun-* dependencies)
const jigPkgPath = join(root, 'packages/jig/package.json')
const jigPkg = JSON.parse(await readFile(jigPkgPath, 'utf8'))
let updatedDeps = 0
for (const [dep, ver] of Object.entries(jigPkg.dependencies || {})) {
  if (dep.startsWith('@oven/bun-') && ver === oldVersion) {
    jigPkg.dependencies[dep] = newVersion
    updatedDeps++
  }
}
await writeFile(jigPkgPath, JSON.stringify(jigPkg, null, 2) + '\n')
console.log(`Updated ${updatedDeps} @oven/bun dependencies in packages/jig/package.json`)

// Helper to replace text in files
async function replaceInFile(path: string, search: string | RegExp, replacement: string) {
  if (!existsSync(path)) return false
  const content = await readFile(path, 'utf8')
  const updated = content.replace(search, replacement)
  if (content !== updated) {
    await writeFile(path, updated)
    return true
  }
  return false
}

// 4. Update packages/jig/src/internal/installed-bun-support.ts
const installedBunSupportPath = join(root, 'packages/jig/src/internal/installed-bun-support.ts')
await replaceInFile(installedBunSupportPath, new RegExp(`version: '${oldVersion}'`, 'g'), `version: '${newVersion}'`)
await replaceInFile(installedBunSupportPath, new RegExp(`revision: '${oldRevision}'`, 'g'), `revision: '${revision}'`)

// 5. Update justfiles
await replaceInFile(
  join(root, 'packages/jig/justfile'),
  `['${oldVersion}', '${oldRevision}']`,
  `['${newVersion}', '${revision}']`,
)
await replaceInFile(
  join(root, 'packages/display-tui/justfile'),
  `['${oldVersion}', '${oldRevision}']`,
  `['${newVersion}', '${revision}']`,
)

// 6. Update shell.nix
await replaceInFile(join(root, 'shell.nix'), `assert bun.version == "${oldVersion}";`, `assert bun.version == "${newVersion}";`)
await replaceInFile(join(root, 'shell.nix'), new RegExp(`/bun-v${oldVersion}/`, 'g'), `/bun-v${newVersion}/`)

// 7. Update .github/workflows/*.yml
const workflowsDir = join(root, '.github/workflows')
for (const entry of await readdir(workflowsDir)) {
  if (!entry.endsWith('.yml') && !entry.endsWith('.yaml')) continue
  const workflowPath = join(workflowsDir, entry)
  await replaceInFile(workflowPath, new RegExp(`bun-version: "${oldVersion}"`, 'g'), `bun-version: "${newVersion}"`)
  await replaceInFile(workflowPath, new RegExp(`bun-version: ${oldVersion}`, 'g'), `bun-version: ${newVersion}`)
  await replaceInFile(workflowPath, new RegExp(`bun-v${oldVersion}`, 'g'), `bun-v${newVersion}`)
  await replaceInFile(workflowPath, new RegExp(oldRevision, 'g'), revision)
}

// 8. Update documentation
await replaceInFile(join(root, 'CONTRIBUTING.md'), new RegExp(`Bun ${oldVersion}`, 'g'), `Bun ${newVersion}`)
await replaceInFile(join(root, 'RELEASING.md'), new RegExp(`Bun ${oldVersion}`, 'g'), `Bun ${newVersion}`)
await replaceInFile(join(root, 'RELEASING.md'), new RegExp(oldRevision, 'g'), revision)
await replaceInFile(join(root, 'docs/jig/build/dependencies.md'), new RegExp(`Bun ${oldVersion}`, 'g'), `Bun ${newVersion}`)
await replaceInFile(join(root, 'docs/jig/examples/index.md'), new RegExp(`Bun ${oldVersion}`, 'g'), `Bun ${newVersion}`)

// 9. Update fixture directories and test-suites.json
const oldFixtureDir = join(root, `scripts/ci/fixtures/bun-${oldVersion}-linux`)
const newFixtureDir = join(root, `scripts/ci/fixtures/bun-${newVersion}-linux`)
if (existsSync(oldFixtureDir) && !existsSync(newFixtureDir)) {
  await rename(oldFixtureDir, newFixtureDir)
  console.log(`Renamed fixture directory: bun-${oldVersion}-linux -> bun-${newVersion}-linux`)
}
await replaceInFile(
  join(root, 'scripts/ci/test-suites.json'),
  new RegExp(`fixtures/bun-${oldVersion}-linux`, 'g'),
  `fixtures/bun-${newVersion}-linux`,
)

// 10. Write or update changeset covering all candidate packages
const changesetSlug = `qualify-bun-${newVersion.replace(/\./g, '-')}`
const changesetPath = join(root, `.changeset/${changesetSlug}.md`)
const changesetContent = `---
"@jigging/jig": patch
"@jigging/agent-method": patch
"@jigging/agent-acp": patch
"@jigging/display-model": patch
"@jigging/display-tui": patch
"@jigging/display-web": patch
"@jigging/reporting": patch
---

Qualify Linux and macOS runtimes to Bun ${newVersion} revision ${revision} and enforce pure evaluation in shell.nix.
`
await writeFile(changesetPath, changesetContent)
console.log(`Created changeset: .changeset/${changesetSlug}.md`)

console.log('\nBump completed successfully!')
console.log('Next step: run `just qualify-check` to verify candidate contracts in ~20 seconds.')
