import { expect, test } from 'bun:test'
import { readFile, rm } from 'node:fs/promises'
import {
  delayedReadinessSupervisor,
  delayedReadyForwardingSupervisor,
  deliberatelySignalledInnerSupervisor,
  heldContinuationSupervisor,
  unavailableDescriptorRestrictionSupervisor,
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
