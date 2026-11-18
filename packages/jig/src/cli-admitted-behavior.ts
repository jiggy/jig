import { DISPLAY_COMPOSITION_BYTE_LIMIT, type DisplayComposition } from '@jigging/display-model'
import { projectSourceBehavior } from './cli-flow-behavior.js'
import { privateActivationCandidateDigestV5 } from './internal/activation-admission.js'
import { inspectPrivateApprovedProject } from './internal/activation-admission-store.js'
import { prepareAdmittedFlowBehavior } from './internal/flow-behavior/admitted-input.js'

/** Read source only while the exact admitted candidate and store are available. */
export async function readAdmittedCompositionBehavior(
  project: string,
  expectedCandidate: string,
  composition: DisplayComposition,
  signal?: AbortSignal,
): Promise<DisplayComposition> {
  if (composition.state !== 'available') return composition
  let expanded: DisplayComposition = composition
  try {
    await inspectPrivateApprovedProject(
      project,
      undefined,
      undefined,
      false,
      undefined,
      async (candidate, store) => {
        if (privateActivationCandidateDigestV5(candidate) !== expectedCandidate) return
        const { report, nodes } = await prepareAdmittedFlowBehavior(
          store,
          candidate,
          composition,
          signal,
        )
        expanded = { ...composition, sourceBehavior: projectSourceBehavior(report, nodes) }
      },
    )
  } catch {
    // A supplemental source read cannot change approved availability or a Run terminal.
    return composition
  }
  return Buffer.byteLength(JSON.stringify(expanded)) <= DISPLAY_COMPOSITION_BYTE_LIMIT
    ? expanded
    : composition
}
