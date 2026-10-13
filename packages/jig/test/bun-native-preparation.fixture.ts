import type { spawn } from 'node:child_process'
import { mkdtemp, readdir, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { recoverPrivateBunPreparationOwner } from '../src/internal/bun-native-preparation.js'
import { PrivateLinuxFenceUnconfirmedError } from '../src/internal/linux-rootless-backend.js'

const HOSTILE = process.env.JIG_LINUX_ROOTLESS_HOSTILE === '1'
const MACOS = process.platform === 'darwin' && process.env.JIG_MACOS_PROCESS_TEST === '1'
async function fixture(lockVersion: 1 | 2 = MACOS ? 2 : 1): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'jig-bun-preparation-'))
  await writeFile(
    join(root, 'FLOW.meta.json'),
    JSON.stringify({
      name: 'native-dependency-fixture',
      description: 'Exercises contained Bun dependency preparation.',
    }),
  )
  await writeFile(
    join(root, 'FLOW.ts'),
    [
      'import isOdd from "is-odd";',
      'import { z } from "zod";',
      "export const result = { odd: isOdd(3), parsed: z.string().parse('ok') };",
      '',
    ].join('\n'),
  )
  await writeFile(
    join(root, 'package.json'),
    `${JSON.stringify(
      {
        name: 'jig-native-preparation-fixture',
        private: true,
        scripts: { postinstall: 'touch postinstall-ran' },
        dependencies: { 'is-odd': '3.0.1', zod: '4.1.5' },
      },
      null,
      2,
    )}\n`,
  )
  await writeFile(
    join(root, 'bunfig.toml'),
    ['[install]', 'registry = "https://packages.example.invalid"', ''].join('\n'),
  )
  await writeFile(
    join(root, 'bun.lock'),
    `{
  "lockfileVersion": ${lockVersion},
  "configVersion": 1,
  "workspaces": {
    "": {
      "name": "jig-native-preparation-fixture",
      "dependencies": {
        "is-odd": "3.0.1",
        "zod": "4.1.5",
      },
    },
  },
  "packages": {
    "is-number": ["is-number@6.0.0", "", {}, "sha512-Wu1VHeILBK8KAWJUAiSZQX94GmOE45Rg6/538fKwiloUu21KncEkYGPqob2oSZ5mUT73vLGrHQjKw3KMPwfDzg=="],
    "is-odd": ["is-odd@3.0.1", "", { "dependencies": { "is-number": "^6.0.0" } }, "sha512-CQpnWPrDwmP1+SMHXZhtLtJv90yiyVfluGsX5iNCVkrhQtU3TQHsUWPG9wkdk9Lgd5yNpAg9jQEo90CBaXgWMA=="],
    "zod": ["zod@4.1.5", "", {}, "sha512-rcUUZqlLJgBC33IT3PNMgsCq6TzLQEG/Ei/KTCU0PedSWRMAXoOUN+4t/0H+Q8bdnLPdqUYnvboJT0bn/229qg=="],
  },
}\n`,
  )
  return root
}
function rootlessTemporaryEntry(name: string): boolean {
  return (
    name.startsWith('jig-rootless-control-') ||
    name.startsWith('jig-rootless-owner-') ||
    name.startsWith('jig-rootless-devices-')
  )
}
async function waitForActivePreparation(projectRoot: string): Promise<void> {
  const parent = join(projectRoot, '.jig', 'private-preparation-owners')
  for (let attempt = 0; attempt < 1_000; attempt += 1) {
    try {
      for (const name of await readdir(parent)) {
        try {
          const claim = JSON.parse(await readFile(join(parent, name, 'claim.json'), 'utf8'))
          const owner = JSON.parse(await readFile(join(parent, name, 'owner.json'), 'utf8'))
          if (claim.state === 'active' && typeof owner.runCgroup === 'string') {
            const events = await readFile(join(owner.runCgroup, 'cgroup.events'), 'utf8')
            if (/^populated 1$/m.test(events)) return
          }
        } catch {
          // The exact claim, cgroup, or admitted payload may not exist yet.
        }
      }
    } catch {
      // The protected owner parent may not have been created yet.
    }
    await Bun.sleep(10)
  }
  throw new Error('preparation did not reach active ownership')
}
function childClose(child: ReturnType<typeof spawn>): Promise<{
  readonly code: number | null
  readonly signal: NodeJS.Signals | null
}> {
  return new Promise((resolve, reject) => {
    child.once('error', reject)
    child.once('close', (code, signal) => resolve({ code, signal }))
  })
}
async function collectChild(stream: NodeJS.ReadableStream | null): Promise<string> {
  if (stream === null) return ''
  let result = ''
  for await (const chunk of stream) {
    result += String(chunk)
    if (Buffer.byteLength(result) > 16 * 1024) return 'diagnostic limit exceeded'
  }
  return result
}
async function recoverEventually(
  input: Parameters<typeof recoverPrivateBunPreparationOwner>[0],
): Promise<void> {
  for (let attempt = 0; attempt < 400; attempt += 1) {
    try {
      await recoverPrivateBunPreparationOwner(input)
      return
    } catch (error) {
      if (!(error instanceof PrivateLinuxFenceUnconfirmedError)) throw error
    }
    await Bun.sleep(25)
  }
  const ownerParent = join(input.projectRoot, '.jig', 'private-preparation-owners')
  const owners = await readdir(ownerParent).catch(() => [])
  const evidence = await Promise.all(
    owners.map(async (name) => ({
      name,
      entries: await readdir(join(ownerParent, name)).catch(() => []),
    })),
  )
  throw new Error(
    `preparation cleanup owner did not publish its fence: ${JSON.stringify(evidence)}`,
  )
}
async function rootlessCgroups(): Promise<readonly string[]> {
  const configured = process.env.JIG_ROOTLESS_CGROUP
  if (configured === undefined) return []
  try {
    return (await readdir(configured)).filter((name) => name.startsWith('jig-run-'))
  } catch {
    return []
  }
}
async function waitForCgroups(initial: ReadonlySet<string>): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if ((await rootlessCgroups()).every((name) => initial.has(name))) return
    await Bun.sleep(25)
  }
  throw new Error('contained preparation left a rootless cgroup')
}
async function waitForTemporary(initial: ReadonlySet<string>): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const current = (await readdir(tmpdir())).filter(rootlessTemporaryEntry)
    if (current.every((name) => initial.has(name))) return
    await Bun.sleep(25)
  }
  throw new Error('contained preparation left rootless temporary state')
}

export {
  childClose,
  collectChild,
  fixture,
  HOSTILE,
  MACOS,
  recoverEventually,
  rootlessCgroups,
  rootlessTemporaryEntry,
  waitForActivePreparation,
  waitForCgroups,
  waitForTemporary,
}
