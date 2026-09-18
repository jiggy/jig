import { OperationError, type ChannelReceiver, type RunContext } from '@jigging/flow'
import { context, identity, type Context } from './context.ts'

export interface Revision {
  readonly revision: number
  readonly context: Readonly<Context>
  readonly reviewNotes: string
}

/** A finite application batch, not a mailbox, queue or native session controller. */
export function revisionFeed(run: RunContext, initial: Readonly<Context>) {
  const endpoint = run.channels.revisions
  if (!endpoint) return undefined
  if (endpoint.direction !== 'receive') throw new TypeError('revisions needs a receiver.')
  const receiver: ChannelReceiver = endpoint
  const stop = new AbortController()
  let wake!: () => void
  const first = new Promise<void>((resolve) => {
    wake = resolve
  })
  const records: Revision[] = []
  let failure: unknown
  let deliveries = 0
  const check = () => {
    if (failure !== undefined) throw failure
  }
  const pump = (async () => {
    try {
      for (;;) {
        const item = await receiver.next({ signal: AbortSignal.any([run.signal, stop.signal]) })
        if (item.done) break
        if (++deliveries > 16) throw new Error('Revision delivery limit exceeded.')
        const value = item.value as Record<string, unknown>
        if (
          !value ||
          Array.isArray(value) ||
          typeof value !== 'object' ||
          Object.keys(value).some(
            (key) => !['revision', 'files', 'laterInstructions', 'reviewNotes'].includes(key),
          ) ||
          !Number.isSafeInteger(value.revision) ||
          (value.revision as number) < 1 ||
          typeof value.reviewNotes !== 'string' ||
          Buffer.byteLength(value.reviewNotes) > 8192 ||
          Buffer.byteLength(JSON.stringify(value)) > 65536
        )
          throw new TypeError('Malformed or oversized context revision.')
        const updated = context({
          ...initial,
          files: value.files,
          laterInstructions: value.laterInstructions,
        })
        const revision: Revision = Object.freeze({
          revision: value.revision as number,
          context: updated,
          reviewNotes: value.reviewNotes,
        })
        const previous = records.find((item) => item.revision === revision.revision)
        if (previous) {
          if (identity(previous) !== identity(revision))
            throw new Error('Conflicting context revision.')
          continue
        }
        const latest = records.at(-1)
        if (records.length >= 8 || revision.revision <= (latest?.revision ?? 0))
          throw new Error('Stale revision or revision limit exceeded.')
        const instructions = latest?.context.laterInstructions ?? initial.laterInstructions
        if (
          instructions.some(
            (instruction, index) =>
              identity(instruction) !== identity(updated.laterInstructions[index] ?? null),
          )
        )
          throw new Error('A revision cannot discard or rewrite accepted instructions.')
        records.push(revision)
        wake()
      }
    } catch (error) {
      if (!(stop.signal.aborted && error instanceof OperationError && error.code === 'CANCELLED'))
        failure = error
    } finally {
      try {
        await receiver.close()
      } catch (error) {
        failure ??= error
      }
      wake()
    }
  })()
  return {
    first,
    records,
    check,
    async complete() {
      await pump
      check()
    },
    async close() {
      stop.abort()
      await pump
      check()
    },
  }
}
