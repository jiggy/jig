#!/usr/bin/env node
import { execFileSync } from 'node:child_process'
import { lstatSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

export const SUITE_PROFILES = Object.freeze([
  'portable',
  'portable-linux',
  'linux',
  'macos-24G830',
  'macos-24H232',
  'macos-23E224',
  'live',
  'experimental',
  'tooling',
])
const TEST_FILE =
  /(?:\.(?:test|spec)|_(?:test|spec))\.[cm]?[jt]sx?$|\.node\.mjs$|(?:^|\/)test_[^/]+\.py$/
const REGULAR_MODES = new Set(['100644', '100755'])

export function isRepositoryTestFile(path) {
  return (
    typeof path === 'string' &&
    path.split('/').every((part) => part && !part.startsWith('.') && part !== 'node_modules') &&
    TEST_FILE.test(path)
  )
}

function safePath(path, directory = false) {
  return (
    typeof path === 'string' &&
    path.length > 0 &&
    !path.includes('\\') &&
    !path.includes('\0') &&
    !path.startsWith('/') &&
    (directory ? path.endsWith('/') : !path.endsWith('/')) &&
    path
      .replace(/\/$/, '')
      .split('/')
      .every((part) => part && part !== '.' && part !== '..')
  )
}

export function validateSuiteOwnership(manifest) {
  const errors = []
  const ids = new Set()
  if (!Array.isArray(manifest.testSuites) || !manifest.testSuites.length)
    return ['Missing whole-file suite ownership']
  for (const suite of manifest.testSuites) {
    if (!suite || !/^[a-z][a-z0-9-]*$/.test(suite.id ?? '') || ids.has(suite.id)) {
      errors.push('Invalid or repeated test suite identity')
      continue
    }
    ids.add(suite.id)
    for (const key of ['roots', 'files', 'excludeRoots', 'excludeFiles']) {
      const paths = suite[key] ?? []
      if (
        !Array.isArray(paths) ||
        new Set(paths).size !== paths.length ||
        paths.some((path) => !safePath(path, key.endsWith('Roots') || key === 'roots'))
      )
        errors.push(`Invalid suite path ownership: ${suite.id}`)
    }
    if (!(suite.roots?.length || suite.files?.length))
      errors.push(`Empty suite path ownership: ${suite.id}`)
    if (
      !Array.isArray(suite.profiles) ||
      !suite.profiles.length ||
      new Set(suite.profiles).size !== suite.profiles.length ||
      suite.profiles.some((profile) => !SUITE_PROFILES.includes(profile))
    )
      errors.push(`Invalid suite applicability profiles: ${suite.id}`)
  }
  for (const target of manifest.targets ?? []) {
    if (
      !Array.isArray(target.suiteIds) ||
      new Set(target.suiteIds).size !== target.suiteIds.length ||
      target.suiteIds.some((id) => !ids.has(id)) ||
      (target.inventoryProfile && !SUITE_PROFILES.includes(target.inventoryProfile))
    )
      errors.push(`Invalid target suite ownership: ${target.id}`)
  }
  for (const path of manifest.fixtureTestRoots ?? [])
    if (!safePath(path, true)) errors.push('Invalid embedded fixture test root')
  return [...new Set(errors)].sort()
}

export function owningSuites(path, manifest) {
  return (manifest.testSuites ?? []).filter(
    (suite) =>
      ((suite.roots ?? []).some((root) => path.startsWith(root)) ||
        (suite.files ?? []).includes(path)) &&
      !(suite.excludeRoots ?? []).some((root) => path.startsWith(root)) &&
      !(suite.excludeFiles ?? []).includes(path),
  )
}

export function reconcileSuiteInventory(files, manifest) {
  const errors = validateSuiteOwnership(manifest)
  for (const file of files)
    if (
      typeof file !== 'string' &&
      isRepositoryTestFile(file.path) &&
      !REGULAR_MODES.has(file.mode)
    )
      errors.push(`Non-regular discovered test cannot establish execution: ${file.path}`)
  const tests = files
    .filter((file) => typeof file === 'string' || REGULAR_MODES.has(file.mode))
    .map((file) => (typeof file === 'string' ? file : file.path))
    .filter(isRepositoryTestFile)
    .filter(
      (path) =>
        !(manifest.externalTestRoots ?? []).some((root) => path.startsWith(root)) &&
        !(manifest.fixtureTestRoots ?? []).some((root) => path.startsWith(root)),
    )
    .sort()
  if (new Set(tests).size !== tests.length) errors.push('Repeated repository test file')
  const ownership = {}
  for (const path of tests) {
    const suites = owningSuites(path, manifest)
    if (suites.length !== 1) {
      errors.push(`${suites.length ? 'Ambiguous' : 'Unowned'} discovered test: ${path}`)
      continue
    }
    ownership[path] = suites[0].id
  }
  return { tests, ownership, errors: [...new Set(errors)].sort() }
}

export function suiteTestFiles(files, suiteIds, manifest, profile) {
  if (profile && !SUITE_PROFILES.includes(profile)) throw new Error('Unknown suite profile')
  const inventory = reconcileSuiteInventory(files, manifest)
  if (inventory.errors.length) throw new Error(inventory.errors.join('\n'))
  const selected = new Set(suiteIds)
  if ([...selected].some((id) => !(manifest.testSuites ?? []).some((suite) => suite.id === id)))
    throw new Error('Unknown test suite identity')
  return inventory.tests.filter((path) => {
    const suite = manifest.testSuites.find((item) => item.id === inventory.ownership[path])
    return selected.has(suite.id) && (!profile || suite.profiles.includes(profile))
  })
}

export function filesForTarget(files, targetId, manifest, profile) {
  const target = manifest.targets.find((item) => item.id === targetId)
  if (!target) throw new Error('Unknown execution target')
  const applicability = profile ?? target.inventoryProfile
  const selected = suiteTestFiles(files, target.suiteIds, manifest, applicability)
  const inventory = reconcileSuiteInventory(files, manifest)
  for (const path of target.inventoryInclude ?? []) {
    if (!inventory.tests.includes(path)) continue
    const suite = manifest.testSuites.find((item) => item.id === inventory.ownership[path])
    if (!applicability || suite.profiles.includes(applicability)) selected.push(path)
  }
  return [...new Set(selected)].sort()
}

// Local regression checks intentionally observe the editable tree; a CI plan
// instead passes pinned Git tree entries through the same pure role mapping.
export function discoverRepositoryTests(root, _manifest) {
  const paths = execFileSync(
    'git',
    ['-C', root, 'ls-files', '-z', '--cached', '--others', '--exclude-standard'],
    { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, timeout: 10_000 },
  )
    .split('\0')
    .filter(isRepositoryTestFile)
  return [...new Set(paths)]
    .filter((path) => {
      try {
        return lstatSync(join(root, path)).isFile()
      } catch (error) {
        if (error.code === 'ENOENT') return false // A deleted tracked source file.
        throw error
      }
    })
    .sort()
}

export function gitRepositoryTests(root, revision) {
  const source = execFileSync(
    'git',
    ['-C', root, 'rev-parse', '--verify', '--end-of-options', `${revision}^{commit}`],
    { encoding: 'utf8' },
  ).trim()
  if (!/^[0-9a-f]{40,64}$/.test(source)) throw new Error('Invalid pinned suite revision')
  return execFileSync('git', ['-C', root, 'ls-tree', '-rz', '--full-tree', source], {
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    timeout: 10_000,
  })
    .split('\0')
    .filter(Boolean)
    .flatMap((entry) => {
      const match = /^(\d+) blob [0-9a-f]+\t([\s\S]+)$/.exec(entry)
      if (!match || !isRepositoryTestFile(match[2])) return []
      if (!REGULAR_MODES.has(match[1])) throw new Error('Pinned test cannot be a symbolic link')
      return [match[2]]
    })
    .sort()
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const options = {}
    const allowed = new Set(['--root', '--target', '--profile', '--revision', '--format'])
    for (let index = 2; index < process.argv.length; index += 2) {
      const key = process.argv[index]
      const value = process.argv[index + 1]
      if (!allowed.has(key) || options[key] !== undefined || !value || value.startsWith('--'))
        throw new Error('Unknown, repeated or incomplete suite inventory option')
      options[key] = value
    }
    const root = resolve(options['--root'] ?? process.cwd())
    const manifest = JSON.parse(readFileSync(new URL('./test-suites.json', import.meta.url)))
    const files = options['--revision']
      ? gitRepositoryTests(root, options['--revision'])
      : discoverRepositoryTests(root, manifest)
    const profile = options['--profile']
    if (!options['--target'] && !profile) throw new Error('Declare a target or suite profile')
    const selected = options['--target']
      ? filesForTarget(files, options['--target'], manifest, profile)
      : suiteTestFiles(
          files,
          manifest.testSuites.map((suite) => suite.id),
          manifest,
          profile,
        )
    if (!selected.length) throw new Error('Selected suite inventory is empty')
    if (selected.some((path) => /[\r\n]/.test(path)))
      throw new Error('Suite paths must be safe literal command arguments')
    if (options['--format'] === 'json') process.stdout.write(`${JSON.stringify(selected)}\n`)
    else if (!options['--format'] || options['--format'] === 'lines')
      process.stdout.write(`${selected.join('\n')}\n`)
    else throw new Error('Suite inventory format must be lines or json')
  } catch (error) {
    process.stderr.write(`Suite inventory refused: ${error.message}\n`)
    process.exitCode = 1
  }
}
