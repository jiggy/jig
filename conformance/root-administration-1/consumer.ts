import type {
  RootAdministration,
  RootRunStatus,
  StartRootRunRequest,
} from "@jigging/jig/administration";

export interface AwaitRootRunOptions {
  readonly administration: RootAdministration;
  readonly request: StartRootRunRequest;
  /** Host-side consumer-owned wait policy; Root Administration/1 has no watch API. */
  readonly wait: () => Promise<void>;
  readonly signal?: AbortSignal;
}

export type TerminalRootRunStatus = Extract<RootRunStatus, { readonly state: "terminal" }>;

/** One deliberately ordinary consumer of the complete Root Administration/1 surface. */
export async function awaitRootRun(options: AwaitRootRunOptions): Promise<TerminalRootRunStatus> {
  if (options.signal?.aborted) throw options.signal.reason;
  const receipt = await options.administration.startRun(options.request);
  for (;;) {
    if (options.signal?.aborted) throw options.signal.reason;
    const status = await options.administration.runStatus(receipt);
    if (status.state === "terminal") return status;
    await options.wait();
  }
}
