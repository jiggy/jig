import { expect, test } from 'bun:test'
import {
  reservePrivateChildFileDestination,
  settlePrivateChildFileDestination,
} from '../../src/internal/child-file-import.js'
import {
  createPrivateRootFlowFileContext,
  planPrivateChildFlowFiles,
} from '../../src/internal/flow-file-context.js'

test('caller destination history survives child cleanup and permits independent siblings', () => {
  const caller = createPrivateRootFlowFileContext({
    declarations: { photos: 'read-write' },
    captured: [],
  })
  const plan = (directory: string) =>
    planPrivateChildFlowFiles({
      caller,
      declarations: { files: 'read-write' },
      mapping: { files: { into: 'photos', directory } },
    })
  try {
    const copies = reservePrivateChildFileDestination(caller, plan('copies'))!
    const overview = reservePrivateChildFileDestination(caller, plan('overview'))!
    expect(() => reservePrivateChildFileDestination(caller, plan('copies'))).toThrow('active')
    settlePrivateChildFileDestination(copies, 'committed')
    // Claims never consult the visible directory, which the caller may remove.
    expect(() => reservePrivateChildFileDestination(caller, plan('copies'))).toThrow(
      'already received',
    )
    expect(() => settlePrivateChildFileDestination(copies, 'absent')).toThrow('already settled')
    settlePrivateChildFileDestination(overview, 'absent')
    const retry = reservePrivateChildFileDestination(caller, plan('overview'))!
    expect(() => settlePrivateChildFileDestination(overview, 'absent')).toThrow(
      'original reservation',
    )
    settlePrivateChildFileDestination(retry, 'unavailable')
    expect(() => reservePrivateChildFileDestination(caller, plan('overview'))).toThrow(
      'unconfirmed',
    )
  } finally {
    caller.close()
  }
})
test('reservations require the exact live caller and cannot cross invocation lifetimes', () => {
  const caller = createPrivateRootFlowFileContext({
    declarations: { photos: 'read-write' },
    captured: [],
  })
  const other = createPrivateRootFlowFileContext({
    declarations: { photos: 'read-write' },
    captured: [],
  })
  const plan = planPrivateChildFlowFiles({
    caller,
    declarations: { files: 'read-write' },
    mapping: { files: { into: 'photos', directory: 'copies' } },
  })
  try {
    expect(() => reservePrivateChildFileDestination(other, plan)).toThrow('does not belong')
    const reserved = reservePrivateChildFileDestination(caller, plan)!
    expect(() => settlePrivateChildFileDestination({ ...reserved }, 'absent')).toThrow(
      'original reservation',
    )
    settlePrivateChildFileDestination(reserved, 'committed')
    caller.close()
    expect(() => reservePrivateChildFileDestination(caller, plan)).toThrow('unavailable')
    const fresh = planPrivateChildFlowFiles({
      caller: other,
      declarations: { files: 'read-write' },
      mapping: { files: { into: 'photos', directory: 'copies' } },
    })
    expect(reservePrivateChildFileDestination(other, fresh)?.directory).toBe('copies')
  } finally {
    caller.close()
    other.close()
  }
})
