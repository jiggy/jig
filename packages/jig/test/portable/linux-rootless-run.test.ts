import { afterAll, describe, expect, test } from 'bun:test'
import { spawn } from 'node:child_process'
import {
  mkdir,
  mkdtemp,
  open,
  readdir,
  readFile,
  realpath,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { FiniteAcpFrames, fragmentFiniteAcpFrame } from '@jigging/agent-acp/transport'
import type { PrivateAcpAgentRuntime } from '../../src/internal/acp-agent-provider.js'
import { privateCaptureAttachments } from '../../src/internal/file-input.js'
import {
  PRIVATE_FINITE_ACP_CHANNELS,
  runPrivateFiniteAcpResource,
} from '../../src/internal/finite-acp-resource.js'
import { resolvePrivateLinuxHostLoader } from '../../src/internal/linux-host-paths.js'
import {
  PrivateLinuxCgroupBackend,
  PrivateLinuxFenceUnconfirmedError,
  type PrivateLinuxLaunchPlan,
  type PrivateLinuxReadOnlyMount,
  type PrivateLinuxSealedOwnerIdentity,
  releasePrivateLinuxOwnerState,
  requirePrivateLinuxMechanismUnchanged,
} from '../../src/internal/linux-rootless-backend.js'
import type { JsonObject, JsonValue } from '../../src/json.js'
import { ChannelBroker } from '../../src/run/channels.js'
import { RunHostSession } from '../../src/run/session.js'
import { deterministicAcpProgram } from '.././fixtures/deterministic-acp-agent.js'
import { installedBunLocation } from '.././fixtures/installed-bun-location.js'
import {
  childExit,
  collect,
  createFixture,
  delayedReadinessSupervisor,
  delayedReadyForwardingSupervisor,
  delegatedCgroup,
  deliberatelySignalledInnerSupervisor,
  HOSTILE,
  type HostConfiguration,
  heldContinuationSupervisor,
  hostConfiguration,
  initialRootlessTemporaryState,
  missing,
  outputDiagnosticSupervisor,
  plan,
  readLine,
  replaceOnce,
  rootlessTemporaryEntry,
  runtimeMounts,
  unavailableDescriptorRestrictionSupervisor,
  waitForFence,
  waitForMissing,
  waitForNoRunCgroups,
  waitForPresent,
} from '.././linux-rootless-run.fixture.js'

test('constructs the delayed-supervisor fixture from current trusted source', async () => {
  const fixture = await delayedReadinessSupervisor('/tmp/entry-entered', '/tmp/entry-settled')
  try {
    const source = await readFile(fixture.path, 'utf8')
    expect(() => new Bun.Transpiler({ loader: 'ts' }).transformSync(source)).not.toThrow()
    expect(source).toContain('await Bun.sleep(20_000)')
    expect(source).toContain('forced child-close failure')
  } finally {
    await rm(fixture.root, { recursive: true, force: true })
  }
})
test('constructs the delayed-ready-forwarding fixture from current trusted source', async () => {
  const fixture = await delayedReadyForwardingSupervisor()
  try {
    const source = await readFile(fixture.path, 'utf8')
    expect(() => new Bun.Transpiler({ loader: 'ts' }).transformSync(source)).not.toThrow()
    expect(source).toContain('await Promise.race([childExit, Bun.sleep(1_000)])')
  } finally {
    await rm(fixture.root, { recursive: true, force: true })
  }
})
test('constructs the held-continuation fixture from current trusted source', async () => {
  const fixture = await heldContinuationSupervisor('/tmp/gate-waiting', '/tmp/payload-launch')
  try {
    const source = await readFile(fixture.path, 'utf8')
    expect(() => new Bun.Transpiler({ loader: 'ts' }).transformSync(source)).not.toThrow()
    expect(source).toContain('while (stopReason === undefined) await Bun.sleep(10)')
    expect(source).toContain('"/tmp/gate-waiting"')
    expect(source).toContain('"/tmp/payload-launch"')
  } finally {
    await rm(fixture.root, { recursive: true, force: true })
  }
})
test('constructs the unavailable-descriptor-restriction fixture from current trusted source', async () => {
  const fixture = await unavailableDescriptorRestrictionSupervisor()
  try {
    const source = await readFile(fixture.path, 'utf8')
    expect(() => new Bun.Transpiler({ loader: 'ts' }).transformSync(source)).not.toThrow()
    expect(source).toContain('if (-1 !== 0)')
  } finally {
    await rm(fixture.root, { recursive: true, force: true })
  }
})
test('constructs bounded private output diagnostic and fault fixtures', async () => {
  const root = await mkdtemp(join(tmpdir(), 'jig-rootless-diagnostic-'))
  try {
    for (const fault of ['projection', 'custody'] as const) {
      const fixture = await outputDiagnosticSupervisor(join(root, fault), fault)
      try {
        const source = await readFile(fixture.path, 'utf8')
        expect(source).toContain('diagnosticBytes')
        expect(new Bun.Transpiler({ loader: 'ts' }).transformSync(source)).toContain(
          'diagnosticBytes',
        )
      } finally {
        await rm(fixture.root, { recursive: true, force: true })
      }
    }
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
test('constructs the deliberately signalled inner fixture from current trusted source', async () => {
  const fixture = await deliberatelySignalledInnerSupervisor()
  try {
    const source = await readFile(fixture.path, 'utf8')
    expect(() => new Bun.Transpiler({ loader: 'ts' }).transformSync(source)).not.toThrow()
    expect(source).toContain("console.error('fixture: inner deliberately raising SIGSEGV')")
    expect(source).toContain("process.kill(process.pid, 'SIGSEGV')")
  } finally {
    await rm(fixture.root, { recursive: true, force: true })
  }
})
