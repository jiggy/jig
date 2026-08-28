import type {
  RunHostEffectCall,
  RunHostEffectOperationTerminal,
} from "../run/session.js";
import type {
  PrivateProjectCoordinator,
  PrivateReacquiredRootExecutionWork,
} from "./activation-admission-store.js";
import { findPrivateActivationCandidateTargetV5 } from "./activation-admission.js";
import {
  executePrivateRootJournalEffect,
} from "./root-journal-effect-controller.js";
import {
  executePrivateRootServiceEffect,
} from "./root-service-effect-controller.js";
import type { PrivateBunServiceMount } from "./private-service-controller.js";
import { PRIVATE_CANONICAL_JOURNAL_CONTRACT } from "../project/package-project.js";

export interface PrivateRootEffectDispatcherInput {
  readonly projectRoot: string;
  readonly packageStoreRoot: string;
  readonly parent: PrivateReacquiredRootExecutionWork;
  readonly coordinator: PrivateProjectCoordinator;
  readonly notifyWorkAvailable: () => void;
  readonly serviceMount?: PrivateBunServiceMount;
}

/**
 * Closed private effect switch. The pinned slot kind selects exactly one
 * controller; errors never fall through to a second implementation.
 */
export async function executePrivateRootEffect(
  input: PrivateRootEffectDispatcherInput & {
    readonly call: RunHostEffectCall;
    readonly signal: AbortSignal;
  },
): Promise<RunHostEffectOperationTerminal> {
  const target = findPrivateActivationCandidateTargetV5(input.parent.candidate, input.parent.run.target);
  if (target === undefined || target.request.digest !== input.parent.intent.requestDigest) {
    return failure("EXECUTION_FAILED", "durable root Run differs from its pinned effect consumer");
  }
  const slot = target.request.slots[input.call.slot];
  if (slot?.kind !== "capability") {
    return failure("UNAVAILABLE", "the requested effect slot is not an admitted capability");
  }
  if (sameCanonicalJournal(slot.contract) && slot.provider.export === "journal") {
    return await executePrivateRootJournalEffect(input);
  }
  return await executePrivateRootServiceEffect(input);
}

function sameCanonicalJournal(value: {
  readonly id: string;
  readonly version: string;
  readonly digest: string;
}): boolean {
  return value.id === PRIVATE_CANONICAL_JOURNAL_CONTRACT.id &&
    value.version === PRIVATE_CANONICAL_JOURNAL_CONTRACT.version &&
    value.digest === PRIVATE_CANONICAL_JOURNAL_CONTRACT.digest;
}

function failure(
  code: "UNAVAILABLE" | "EXECUTION_FAILED",
  message: string,
): RunHostEffectOperationTerminal {
  return Object.freeze({ status: "failed", code, message });
}
