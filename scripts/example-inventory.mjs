#!/usr/bin/env node
import { lstatSync, readdirSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import {
  discoverRepositoryTests,
  filesForTarget,
  reconcileSuiteInventory,
} from './ci/suite-inventory.mjs'

export const EXAMPLE_HOST_TESTS = Object.freeze({
  'contact-import': ['packages/jig/test/host/installed-contact-import.test.ts'],
  'kitchen-roster': ['packages/jig/test/host/installed-kitchen-roster.test.ts'],
  'photo-organiser': ['packages/jig/test/host/installed-photo-organiser.test.ts'],
  'software-factory': [
    'packages/jig/test/host/installed-software-factory.test.ts',
    'packages/jig/test/host/installed-software-factory-blocked.test.ts',
  ],
  'support-case': ['packages/jig/test/host/installed-support-case.test.ts'],
  'tested-patch': [
    'packages/jig/test/host/root-agent-repair.test.ts',
    'packages/jig/test/host/root-agent-repair-unsuccessful.test.ts',
  ],
})
for (const paths of Object.values(EXAMPLE_HOST_TESTS)) Object.freeze(paths)

export const EXAMPLE_E2E_TEST = 'packages/jig/test/linux-host/example-smoke.test.ts'

/**
 * Checks coverage registration, not execution. Native suites establish their
 * own execution, delivery and cleanup evidence on qualified hosts.
 */
export function exampleInventory(root) {
  root = resolve(root)
  const errors = []
  const requirePath = (path, directory = false) => {
    try {
      const entry = lstatSync(join(root, path))
      if (!(directory ? entry.isDirectory() : entry.isFile()))
        errors.push(`Required regular ${directory ? 'directory' : 'file'}: ${path}`)
    } catch (error) {
      if (error.code !== 'ENOENT') throw error
      errors.push(`Missing example input: ${path}`)
    }
  }
  const refuse = () => {
    if (errors.length) throw new Error([...new Set(errors)].sort().join('\n'))
  }

  requirePath('examples', true)
  refuse()
  const names = []
  for (const entry of readdirSync(join(root, 'examples'), { withFileTypes: true })) {
    if (entry.isSymbolicLink()) {
      errors.push(`Linked example input is unsupported: examples/${entry.name}`)
      continue
    }
    if (!entry.isDirectory()) continue
    names.push(entry.name)
    if (!/^[a-z][a-z0-9-]*$/.test(entry.name))
      errors.push(`Invalid example directory name: ${entry.name}`)
    const directory = `examples/${entry.name}`
    requirePath(`${directory}/package.json`)
    requirePath(`${directory}/jig.ts`)
    requirePath(`${directory}/test`, true)
    if (!Object.hasOwn(EXAMPLE_HOST_TESTS, entry.name))
      errors.push(`No installed-host coverage registered for example: ${entry.name}`)
  }
  names.sort()
  if (!names.length) errors.push('No examples discovered')
  for (const name of Object.keys(EXAMPLE_HOST_TESTS))
    if (!names.includes(name)) errors.push(`Stale example coverage: ${name}`)
  refuse()

  const manifest = JSON.parse(readFileSync(join(root, 'scripts/ci/test-suites.json'), 'utf8'))
  const files = discoverRepositoryTests(root, manifest)
  const inventory = reconcileSuiteInventory(files, manifest)
  errors.push(...inventory.errors)
  refuse()

  const sourceTargets = ['portable', 'portable-linux'].map(
    (profile) => new Set(filesForTarget(files, 'source-applications', manifest, profile)),
  )
  const hostTargets = ['linux', 'macos-x64', 'macos-arm64'].map(
    (target) => new Set(filesForTarget(files, target, manifest)),
  )
  requirePath(EXAMPLE_E2E_TEST)
  if (
    inventory.ownership[EXAMPLE_E2E_TEST] !== 'linux-host' ||
    !hostTargets[0].has(EXAMPLE_E2E_TEST)
  )
    errors.push('Example end-to-end suite is outside the required Linux target')

  const examples = names.map((name) => {
    const directory = `examples/${name}`
    try {
      const packageJson = JSON.parse(readFileSync(join(root, directory, 'package.json'), 'utf8'))
      if (!packageJson || typeof packageJson.name !== 'string' || !packageJson.name)
        errors.push(`Example manifest requires a package name: ${directory}/package.json`)
    } catch (error) {
      if (error instanceof SyntaxError)
        errors.push(`Invalid example manifest: ${directory}/package.json`)
      else throw error
    }

    const sourceTests = inventory.tests.filter((path) => path.startsWith(`${directory}/test/`))
    if (!sourceTests.length) errors.push(`Example has no application tests: ${name}`)
    for (const path of sourceTests)
      if (
        inventory.ownership[path] !== 'applications' ||
        sourceTargets.some((selected) => !selected.has(path))
      )
        errors.push(`Example test is outside the complete application stage: ${path}`)

    const hostTests = EXAMPLE_HOST_TESTS[name]
    for (const path of hostTests) {
      requirePath(path)
      if (
        inventory.ownership[path] !== 'jig-host' ||
        hostTargets.some((selected) => !selected.has(path))
      )
        errors.push(`Example host test is outside required native targets: ${path}`)
    }
    return { name, directory, sourceTests, hostTests: [...hostTests], e2eTest: EXAMPLE_E2E_TEST }
  })
  refuse()
  return examples
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const options = {}
    for (let index = 2; index < process.argv.length; index += 2) {
      const key = process.argv[index]
      const value = process.argv[index + 1]
      if (
        !['--root', '--format'].includes(key) ||
        options[key] !== undefined ||
        !value ||
        value.startsWith('--')
      )
        throw new Error('Unknown, repeated or incomplete example inventory option')
      options[key] = value
    }
    const format = options['--format'] ?? 'names'
    if (!['names', 'json'].includes(format))
      throw new Error('Example inventory format must be names or json')
    const examples = exampleInventory(options['--root'] ?? process.cwd())
    process.stdout.write(
      format === 'json'
        ? `${JSON.stringify(examples)}\n`
        : `${examples.map(({ name }) => name).join('\n')}\n`,
    )
  } catch (error) {
    process.stderr.write(`Example inventory refused: ${error.message}\n`)
    process.exitCode = 1
  }
}
