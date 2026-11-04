import type { JsonValue } from '../json.js'
import { ChannelOperationError } from '../run/channels.js'
import {
  type RunHostCall,
  RunHostFatalOperationError,
  type RunHostOperationTerminal,
} from '../run/session.js'
import { readPrivateSettledChildCheckpoint } from './activation-admission-store.js'
import {
  capturePrivateRetainedFlowArtifact,
  type PrivateFlowFileContext,
} from './flow-file-context.js'
import {
  parseChildCheckpointInput,
  PrivateChildCheckpointResultLimitError,
  projectChildCheckpoint,
} from './private-child-checkpoint.js'
import {
  parseRunCheckpointInput,
  PrivateCheckpointRejected,
  type RunCheckpointInput,
  type RunCheckpointReceipt,
} from './private-run-checkpoint.js'

/** One live invocation's control lane and settled direct calls, bounded by Run/0 request IDs. */
export class PrivateInvocationCheckpoints {
  readonly #settledChildren = new Map<string, string>()
  #active = false

  constructor(
    private readonly owner: {
      readonly projectRoot: string
      readonly runId: string
      readonly epoch: number
      readonly operationPath: readonly string[]
      readonly files: PrivateFlowFileContext | undefined
      readonly save: (value: RunCheckpointInput) => Promise<RunCheckpointReceipt>
    },
  ) {}

  /** Call only after the real child controller returns, never after fatal cleanup failure. */
  settledChild(operationId: string, childOperationId: string): void {
    this.#settledChildren.set(operationId, childOperationId)
  }

  async call(
    kind: 'run-checkpoint' | 'child-checkpoint',
    call: RunHostCall,
    signal: AbortSignal,
  ): Promise<RunHostOperationTerminal> {
    if (this.#active)
      return {
        status: 'failed',
        code: 'RESOURCE_EXHAUSTED',
        message: 'the invocation already has an active checkpoint operation',
      }
    if (
      Object.keys(call.channels ?? {}).length !== 0 ||
      Object.keys(call.attachments ?? {}).length !== 0
    )
      return {
        status: 'failed',
        code: 'UNAVAILABLE',
        message: 'checkpoint control does not accept channels or attachment mappings',
      }
    let value: RunCheckpointInput | ReturnType<typeof parseChildCheckpointInput>
    try {
      value =
        kind === 'run-checkpoint'
          ? parseRunCheckpointInput(call.input)
          : parseChildCheckpointInput(call.input)
    } catch {
      return {
        status: 'failed',
        code: 'INVALID_INPUT',
        message: 'checkpoint request exceeds its declared shape or limits',
      }
    }
    if (signal.aborted) return cancelled()
    this.#active = true
    try {
      if (kind === 'run-checkpoint') {
        const receipt = await this.owner.save(value as RunCheckpointInput)
        return {
          status: 'succeeded',
          result: { outcome: 'done', output: receipt as unknown as JsonValue },
        }
      }
      const { operationId } = value as ReturnType<typeof parseChildCheckpointInput>
      const childOperationId = this.#settledChildren.get(operationId)
      if (childOperationId === undefined)
        return {
          status: 'failed',
          code: 'UNAVAILABLE',
          message: 'checkpoint retrieval requires this invocation’s settled direct child call',
        }
      const retained = await readPrivateSettledChildCheckpoint({
        projectRoot: this.owner.projectRoot,
        runId: this.owner.runId,
        epoch: this.owner.epoch,
        callerOperationPath: this.owner.operationPath,
        childOperationId,
      })
      try {
        signal.throwIfAborted()
        // Complete response bounds precede minting any caller-held artifact reference.
        const output = projectChildCheckpoint(retained?.record)
        if (retained === undefined)
          return {
            status: 'succeeded',
            result: { outcome: 'done', output: output as unknown as JsonValue },
          }
        if (this.owner.files === undefined) throw new Error('checkpoint file owner unavailable')
        const reference = await capturePrivateRetainedFlowArtifact(this.owner.files, retained, signal)
        return {
          status: 'succeeded',
          result: {
            outcome: 'done',
            output: output as unknown as JsonValue,
            artifacts: { checkpoint: reference },
          },
        }
      } finally {
        for (const file of retained?.files ?? []) file.bytes.fill(0)
      }
    } catch (error) {
      if (error instanceof RunHostFatalOperationError) throw error
      if (error instanceof PrivateCheckpointRejected)
        return {
          status: 'failed',
          code: error.code,
          message:
            kind === 'run-checkpoint'
              ? 'checkpoint replacement rejected; earlier progress is unchanged'
              : 'checkpoint retrieval requires an active caller within its original lifetime',
        }
      if (
        error instanceof PrivateChildCheckpointResultLimitError ||
        (error instanceof ChannelOperationError && error.code === 'RESOURCE_EXHAUSTED')
      )
        return {
          status: 'failed',
          code: 'RESOURCE_EXHAUSTED',
          message: 'checkpoint operation exceeds the invocation result or root artifact allowance',
        }
      if (signal.aborted) return cancelled()
      return {
        status: 'failed',
        code: kind === 'run-checkpoint' ? 'UNCERTAIN' : 'UNAVAILABLE',
        message:
          kind === 'run-checkpoint'
            ? 'checkpoint acknowledgement unavailable; inspect the original attempt'
            : 'the child checkpoint could not be verified or transferred',
      }
    } finally {
      this.#active = false
    }
  }
}

function cancelled(): RunHostOperationTerminal {
  return { status: 'failed', code: 'CANCELLED', message: 'checkpoint request cancelled' }
}
