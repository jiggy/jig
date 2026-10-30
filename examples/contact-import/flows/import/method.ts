import type { RunContext, RunResult } from '@jigging/flow'
import type { Reporter } from '@jigging/reporting'
import {
  type ContactPreview,
  contactPreviewOptions,
  contactPreviewView,
  type ImportState,
} from './dashboard.ts'

export async function runMethod(
  run: Pick<RunContext, 'input' | 'attachments' | 'signal' | 'call'>,
  reporter?: Reporter,
): Promise<RunResult> {
  let view = reporter?.view('reading', { title: 'Contact preview' })
  let state: ImportState = { phase: 'reading' }
  const show = (phase: ImportState['phase']) => {
    state = { ...state, phase }
    view?.update(contactPreviewView(state))
  }
  show('reading')
  try {
    run.signal.throwIfAborted()
    const captured = await run.call({
      operationId: 'read-contacts',
      slot: 'reader',
      intent: 'Read and validate the source CSV',
      input: {},
    })
    run.signal.throwIfAborted()
    if (captured.outcome !== 'done') throw new TypeError('The CSV reader did not complete.')
    const { headers, rows } = captured.output as { headers: string[]; rows: string[][] }
    state = { ...state, headers, records: rows.length }
    view?.retire()
    view = reporter?.view('contacts', contactPreviewOptions(headers, rows))

    show('mapping')
    const proposal = await run.call({
      operationId: 'map-columns',
      slot: 'mapper',
      intent: 'Choose name, email and organization columns',
      input: { headers },
    })
    run.signal.throwIfAborted()
    if (proposal.outcome === 'blocked' || proposal.outcome === 'limit') {
      state = { ...state, reason: (proposal.output as { reason: string }).reason }
      show(proposal.outcome)
      reporter?.notice(
        'Column mapping could not complete. No preview is ready; inspect the reported cause.',
        'error',
      )
      return proposal
    }
    if (proposal.outcome !== 'done') throw new TypeError('Unexpected mapping outcome.')
    const { mapping } = proposal.output as { mapping: ContactPreview['mapping'] }

    show('checking')
    const converted = await run.call({
      operationId: 'convert-rows',
      slot: 'converter',
      intent: 'Validate column selection and contact rows',
      input: { headers, rows, mapping },
    })
    run.signal.throwIfAborted()
    if (converted.outcome !== 'done') throw new TypeError('The row converter did not complete.')
    const preview = converted.output as ContactPreview
    state = { ...state, preview }

    show('exporting')
    const exported = await run.call({
      operationId: 'export-preview',
      slot: 'exporter',
      intent: 'Write the complete checked contact preview',
      input: converted.output,
      attachments: { files: { create: true } },
    })
    run.signal.throwIfAborted()
    if (exported.outcome !== 'done') throw new TypeError('The preview exporter did not complete.')
    const output = exported.output as {
      file: string
      status: string
      accepted: number
      rejected: number
    }
    if (
      output.file !== 'preview.json' ||
      output.status !== preview.status ||
      output.accepted !== preview.accepted.length ||
      output.rejected !== preview.rejected.length
    ) {
      throw new TypeError('The exported preview metadata does not match the checked records.')
    }
    const artifact = exported.artifacts?.files
    if (!artifact) throw new TypeError('The preview exporter returned no immutable files artifact.')
    state = { ...state, file: 'preview.json' }
    show('ready')
    if (preview.status === 'needs_mapping')
      reporter?.notice(
        'Choose three distinct existing columns before contacts can be previewed.',
        'warning',
      )
    else if (preview.rejected.length)
      reporter?.notice(
        `${preview.rejected.length} records need correction. Review their reasons in the contact preview.`,
        'warning',
      )
    return {
      outcome: converted.outcome,
      output: converted.output,
      artifactResults: { preview: artifact },
    }
  } catch (error) {
    state = {
      ...state,
      reason:
        'No complete preview is confirmed. Inspect the final diagnostic and any delivered files; no contacts were imported.',
    }
    show(run.signal.aborted ? 'cancelled' : 'failed')
    throw error
  }
}
