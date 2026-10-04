import { expect, test } from 'bun:test'
import { privateExecutionLocations } from '../src/internal/execution-backend.js'
import {
  type PrivateExecutionIntent,
  privateExecutionPath,
} from '../src/internal/execution-intent.js'
import {
  privateLinuxExecutionPlan,
  privateMacosExecutionPlan,
} from '../src/internal/execution-plan.js'
import type { PrivateMacosOwnerStateAllocationIdentity } from '../src/internal/macos-backend-state.js'
import { requirePrivateMacosGuardianStorage } from '../src/internal/macos-guardian-storage.js'

// Pure lowering requires no live allocation authority; sealing authenticates it later.
const allocation = {
  kind: 'private-macos-owner-state-allocation/1',
  directory: '/owner',
} as PrivateMacosOwnerStateAllocationIdentity
const intent: PrivateExecutionIntent = {
  runId: 'test',
  limits: {
    memoryBytes: 256 * 1024 * 1024,
    pids: 16,
    cpuQuotaMicros: 100_000,
    cpuPeriodMicros: 100_000,
    deadlineUnixMs: 123456,
    cancellationGraceMs: 1000,
    cleanupTimeoutMs: 5000,
  },
  command: [
    privateExecutionPath('/runtime/bun'),
    privateExecutionPath('/package/main.ts'),
    '/package/literal',
    '/tmp/literal',
  ],
  projections: [
    { source: '/installed/bun', destination: '/runtime/bun', kind: 'file' },
    { source: '/retained/package', destination: '/package', kind: 'tree' },
  ],
  storageBytes: 512 * 1024 * 1024,
  maxOutputBytes: 16 * 1024 * 1024,
}

test('one intent lowers to distinct host mechanisms without relocating literal arguments', () => {
  const linux = privateLinuxExecutionPlan(intent)
  const mac = privateMacosExecutionPlan(intent, allocation)
  expect(linux.command).toEqual([
    '/runtime/bun',
    '/package/main.ts',
    '/package/literal',
    '/tmp/literal',
  ])
  expect(mac.command).toEqual([
    '/installed/bun',
    '/retained/package/main.ts',
    '/package/literal',
    '/tmp/literal',
  ])
  expect(linux.limits.deadlineUnixMs).toBe(123456)
  expect(mac.limits.deadlineUnixMs).toBe(123456)
  expect(mac.files.readOnlyFiles).toEqual(['/installed/bun'])
  expect(mac.files.readOnlyTrees).toEqual(['/retained/package'])
  expect(mac.files.protectedRoots).toEqual(['/owner/control'])
  expect(mac.files.network).toBe('isolated')
  expect(mac.storage?.collect).toBeNull()
  expect(intent.command[0]).toEqual({ path: '/runtime/bun' })
})

test('empty input roots remain read-only and invocation locations match the lowered plan', () => {
  const mac = privateMacosExecutionPlan(
    { ...intent, inputDirectories: ['/jig-input/empty'], output: true },
    allocation,
  )
  const locations = privateExecutionLocations(allocation)
  expect(mac.inputDirectories).toEqual(['empty'])
  expect(mac.capturedInputs).toEqual([])
  expect(mac.files.readOnlyTrees).toContain('/owner/data/inputs')
  expect(mac.files.writableTrees).not.toContain('/owner/data/inputs')
  expect(mac.cwd).toBe(locations.scratch)
  expect(locations.attachment('empty', 'read')).toBe('/owner/data/inputs/empty')
  expect(locations.attachment('result', 'read-write')).toBe('/owner/data/output')
  expect(mac.storage?.collect).toBe('output')
  expect(mac.files.writableTrees).toContain(locations.attachment('result', 'read-write'))
})

test('declared path relocation respects component boundaries and most-specific projections', () => {
  const mac = privateMacosExecutionPlan(
    {
      ...intent,
      projections: [
        ...intent.projections,
        { source: '/special', destination: '/package/nested', kind: 'tree' },
      ],
      command: [
        privateExecutionPath('/runtime/bun'),
        privateExecutionPath('/package/nested/main.ts'),
        privateExecutionPath('/package-sibling/main.ts'),
      ],
    },
    allocation,
  )
  expect(mac.command).toEqual(['/installed/bun', '/special/main.ts', '/package-sibling/main.ts'])
  expect(() =>
    privateMacosExecutionPlan({ ...intent, inputDirectories: ['/elsewhere/input'] }, allocation),
  ).toThrow('outside the input root')
})

test('network and native environment projection carry only selected authority', () => {
  const request = {
    ...intent,
    network: 'inherited' as const,
    environment: { ARGV: '["/runtime/bun","/tmp/config"]', LITERAL: 'value' },
    relocateEnvironment: true,
    relocatedEnvironment: { WORK: '/work' },
  }
  expect(privateLinuxExecutionPlan(request).readOnlyMounts).toContainEqual({
    source: '/etc/resolv.conf',
    destination: '/etc/resolv.conf',
  })
  expect(privateLinuxExecutionPlan(intent).readOnlyMounts).not.toContainEqual({
    source: '/etc/resolv.conf',
    destination: '/etc/resolv.conf',
  })
  expect(privateLinuxExecutionPlan(request).environment).toEqual(request.environment)
  const mac = privateMacosExecutionPlan(request, allocation)
  expect(mac.environment).toEqual({
    ARGV: '["/installed/bun","/owner/data/tmp/config"]',
    LITERAL: 'value',
    WORK: '/owner/data/work',
    TMPDIR: '/owner/data/tmp',
  })
  expect(mac.files.network).toBe('inherited')
})

test('native environment paths relocate once without corrupting physical paths or JSON', () => {
  const executable = '/private/tmp/native-tools/codex'
  const argv = [
    '/runtime/bun',
    '/package/main.ts',
    '/tmp/config',
    '/tmp',
    '/runtime/bun-sibling',
    '/private/tmp/unrelated/file',
    'text /tmp/literal',
  ]
  const request = {
    ...intent,
    projections: [
      { source: '/private/tmp/tools/bun', destination: '/runtime/bun', kind: 'file' as const },
      { source: '/private/tmp/package "quoted"', destination: '/package', kind: 'tree' as const },
      { source: executable, destination: executable, kind: 'file' as const },
    ],
    environment: {
      CODEX_PATH: executable,
      ARGV: JSON.stringify(argv),
      CONFIG: JSON.stringify({ log: '/tmp/log', literal: 'text /tmp/literal' }),
    },
    relocateEnvironment: true,
  }
  const mac = privateMacosExecutionPlan(request, allocation)
  expect(mac.environment?.CODEX_PATH).toBe(executable)
  expect(JSON.parse(mac.environment!.ARGV!)).toEqual([
    '/private/tmp/tools/bun',
    '/private/tmp/package "quoted"/main.ts',
    '/owner/data/tmp/config',
    '/owner/data/tmp',
    ...argv.slice(4),
  ])
  expect(JSON.parse(mac.environment!.CONFIG!)).toEqual({
    log: '/owner/data/tmp/log',
    literal: 'text /tmp/literal',
  })
  expect(mac.files.readOnlyFiles).toContain(executable)
  expect(privateLinuxExecutionPlan(request).environment).toEqual(request.environment)
})

test('read-only workers allocate no volume or writable authority', () => {
  const mac = privateMacosExecutionPlan(
    {
      ...intent,
      readOnlyCwd: '/package',
      storageBytes: 0,
      relocatedEnvironment: { SDK: '/package/sdk.js' },
    },
    allocation,
  )
  expect(mac.storage).toBeUndefined()
  expect(mac.files.writableTrees).toEqual([])
  expect(mac.cwd).toBe('/retained/package')
  expect(mac.environment).toEqual({ SDK: '/retained/package/sdk.js' })
})

test('read-only captured workers allocate bounded input storage without write grants', () => {
  const mac = privateMacosExecutionPlan(
    {
      ...intent,
      readOnlyCwd: '/jig-input/evaluator',
      inputDirectories: ['/jig-input/evaluator'],
      storageBytes: 16 * 1024 * 1024,
      relocatedEnvironment: { SDK: '/jig-input/evaluator/sdk.js' },
    },
    allocation,
  )
  expect(mac.storage).toEqual({
    mountPath: '/owner/data',
    bytes: 16 * 1024 * 1024,
    collect: null,
  })
  expect(mac.files.readOnlyTrees).toContain('/owner/data/inputs')
  expect(mac.files.writableTrees).toEqual([])
  expect(mac.cwd).toBe('/owner/data/inputs/evaluator')
  expect(mac.environment).toEqual({ SDK: '/owner/data/inputs/evaluator/sdk.js' })
  expect(() => requirePrivateMacosGuardianStorage(mac.storage!, mac.files, mac.cwd)).not.toThrow()
  expect(() =>
    requirePrivateMacosGuardianStorage(mac.storage!, { ...mac.files, readOnlyTrees: [] }, mac.cwd),
  ).toThrow('outside bounded storage')
  expect(() =>
    requirePrivateMacosGuardianStorage(
      mac.storage!,
      { ...mac.files, writableTrees: ['/owner/data/work'] },
      mac.cwd,
    ),
  ).toThrow('outside bounded storage')
})
