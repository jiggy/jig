import {
  publishCapturedPackage,
  type PackageArtifactRef,
} from "../internal/package-artifact-store.js";
import type { InspectedPackage } from "../package/inspect.js";
import type {
  CapturedFlowSource,
  FlowMemberProvenance,
} from "./flow-source.js";

const retainedInputs = new WeakSet<object>();

export interface RetainedFlowInput {
  readonly provenance: FlowMemberProvenance;
  readonly package: PackageArtifactRef;
  readonly inspected: InspectedPackage;
}

/**
 * Publish every member of one invocation-local Flow source. The caller still
 * owns and must dispose the source. Publication does not imply admission.
 */
export async function retainFlowSourcePackages(
  storeRoot: string,
  source: CapturedFlowSource,
): Promise<readonly RetainedFlowInput[]> {
  const retained: RetainedFlowInput[] = [];
  for (const member of source.members) {
    const value = Object.freeze({
      provenance: member.provenance,
      package: await publishCapturedPackage(storeRoot, member.captured),
      inspected: member.inspected,
    });
    retainedInputs.add(value);
    retained.push(value);
  }
  return Object.freeze(retained);
}

export function requireRetainedFlowInput(value: unknown): RetainedFlowInput {
  if (value === null || typeof value !== "object" || !retainedInputs.has(value)) {
    throw new TypeError("Flow input was not produced by retained Package/1 inspection");
  }
  return value as RetainedFlowInput;
}
