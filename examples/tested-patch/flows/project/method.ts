import type { RunContext, RunResult } from '@jigging/flow'
import type { Reporter } from '@jigging/reporting'
import {
  type CapturedProject,
  type CheckedRepair,
  type PatchState,
  patchReviewView,
} from './dashboard.ts'

export async function repairFiles(run: RunContext, reporter?: Reporter): Promise<RunResult> {
  const request = run.input as { issue: string; editPaths: string[] }
  const view = reporter?.view('repair', { title: 'Patch review', landing: true })
  let state: PatchState = { phase: 'reading', request }
  const show = (phase: PatchState['phase']) => {
    state = { ...state, phase }
    view?.update(patchReviewView(state))
  }
  show('reading')
  try {
    run.signal.throwIfAborted()
    const captured = await run.call({
      operationId: 'read-project',
      slot: 'reader',
      intent: 'Capture source and reviewed acceptance cases',
      input: run.input,
    })
    run.signal.throwIfAborted()
    if (captured.outcome !== 'done') throw new TypeError('The project reader did not complete.')
    const input = captured.output as CapturedProject
    state = { ...state, captured: input }

    show('repairing')
    const progress = run.channels.progress
    const result = await run.call({
      operationId: 'repair',
      slot: 'repair',
      intent: 'Reproduce the defect and propose a checked repair',
      input: captured.output,
      ...(progress ? { channels: { progress } } : {}),
    })
    run.signal.throwIfAborted()

    show('checking')
    const acceptance = await run.call({
      operationId: 'check-repair',
      slot: 'checker',
      intent: 'Validate complete repair evidence against captured originals and expectations',
      input: {
        captured: captured.output,
        result: { outcome: result.outcome, output: result.output },
      },
    })
    run.signal.throwIfAborted()
    if (acceptance.outcome !== 'done')
      throw new TypeError('The repair evidence checker did not complete.')
    const checked = acceptance.output as CheckedRepair
    if (checked.ready !== (result.outcome === 'done'))
      throw new TypeError('Repair acceptance contradicts the reported outcome.')
    state = { ...state, checked }

    show('exporting')
    const exported = await run.call({
      operationId: 'export-patch',
      slot: 'exporter',
      intent: 'Prepare review files from accepted repair evidence',
      input: { issue: input.issue, originals: input.files, checked: acceptance.output },
      attachments: { files: { create: true } },
    })
    run.signal.throwIfAborted()
    if (exported.outcome !== 'done') throw new TypeError('The patch exporter did not complete.')
    const artifact = exported.artifacts?.files
    if (!artifact) throw new TypeError('The patch exporter did not return its immutable files.')
    const output = exported.output as { ready: boolean; files: string[] }
    const expected = [
      'goal.txt',
      'summary.txt',
      ...checked.proposals.map((proposal) => `proposal-${proposal.number}.patch`),
    ]
    if (checked.ready) expected.push('review.patch')
    if (
      output.ready !== checked.ready ||
      output.files.length !== expected.length ||
      new Set(output.files).size !== expected.length ||
      output.files.some((name) => !expected.includes(name))
    ) {
      throw new TypeError('The patch export does not match the accepted review data.')
    }
    state = { ...state, files: output.files.map((name) => `review/${name}`) }
    show('ready')
    if (!checked.ready)
      reporter?.notice(
        'No checked patch is available. The review summary retains the repair cause.',
        'error',
      )
    return {
      outcome: result.outcome,
      output: result.output,
      artifactResults: { deliverables: artifact },
    }
  } catch (error) {
    state = {
      ...state,
      reason:
        'No complete review packet is confirmed. Inspect the final diagnostic and any delivered files; source changes have not been applied.',
    }
    show(run.signal.aborted ? 'cancelled' : 'failed')
    throw error
  }
}
