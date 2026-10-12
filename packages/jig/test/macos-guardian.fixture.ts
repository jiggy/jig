import { expect } from 'bun:test'
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const accountingFaults = [
  'transient',
  'between-samples',
  'sustained',
  'final',
  'final-between-samples',
] as const
async function accountingSupervisor(root: string, fault: (typeof accountingFaults)[number]) {
  const source = new URL('../src/internal/', import.meta.url)
  const directory = fileURLToPath(source)
  const controls = join(root, `${fault}-controls.ts`)
  const state = join(root, `${fault}-state.ts`)
  const scope = join(root, `${fault}-scope.ts`)
  const supervisor = join(root, `${fault}-supervisor.ts`)
  const controlsSource = await readFile(new URL('macos-process-controls.ts', source), 'utf8')
  const marker = '      const after = usage(owner.coalition)\n'
  expect(controlsSource.split(marker)).toHaveLength(2)
  const declaration = '  const control: PrivateMacosCoalitionControl'
  expect(controlsSource.split(declaration)).toHaveLength(2)
  const replaceLocal = (text: string, name: string, path: string) => {
    const from = `from './${name}.js'`
    expect(text.split(from)).toHaveLength(2)
    return text.replace(from, `from '${path}'`)
  }
  const final = fault.startsWith('final')
  const between = fault.endsWith('between-samples')
  // Copy the trusted control/state pair together to preserve its private brand.
  // Only CPU observations are falsified; kernel membership, identity and fencing
  // remain real. These faults do not claim to reproduce a particular host log.
  await writeFile(
    controls,
    replaceLocal(
      controlsSource
        .replace(
          declaration,
          '  let observedPayload = false, injected = false\n  const control: PrivateMacosCoalitionControl',
        )
        .replace(
          marker,
          `${marker}
      if (after.active > 1n) observedPayload = true
      if (${final ? 'observedPayload && after.active === 1n' : between ? 'after.active > 1n && !injected && complete && before.active === after.active && after.active === BigInt(observedMembers + 1)' : `after.active > 1n${fault === 'transient' ? ' && !injected' : ''}`}) {
        injected = true
        ${between ? 'before.cpuNanoseconds = 0n; after.cpuNanoseconds = 1n' : 'after.cpuNanoseconds = 0n'}
      }
`,
        ),
      'macos-owner-state',
      state,
    ).replaceAll("from './", `from '${directory}`),
  )
  await writeFile(
    state,
    replaceLocal(
      await readFile(new URL('macos-owner-state.ts', source), 'utf8'),
      'macos-process-controls',
      controls,
    ).replaceAll("from './", `from '${directory}`),
  )
  await writeFile(
    scope,
    replaceLocal(
      await readFile(new URL('macos-scope-execution.ts', source), 'utf8'),
      'macos-process-controls',
      controls,
    ).replaceAll("from './", `from '${directory}`),
  )
  await writeFile(
    supervisor,
    replaceLocal(
      replaceLocal(
        replaceLocal(
          await readFile(new URL('macos-native-supervisor.ts', source), 'utf8'),
          'macos-process-controls',
          controls,
        ),
        'macos-scope-execution',
        scope,
      ),
      'macos-owner-state',
      state,
    ).replaceAll("from './", `from '${directory}`),
  )
  return supervisor
}

export { accountingFaults, accountingSupervisor }
