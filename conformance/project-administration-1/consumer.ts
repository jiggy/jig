import type {
  ProjectApplyReceipt,
  ProjectPlanResult,
  ProjectSession,
} from "@jigging/jig/administration";

export type ProjectReviewDecision = (
  subject: Extract<ProjectPlanResult, { readonly state: "applicable" }>,
) => boolean | Promise<boolean>;

export type ReviewedProjectResult =
  | { readonly state: "unchanged" }
  | { readonly state: "declined"; readonly planDigest: string }
  | { readonly state: "applied"; readonly receipt: ProjectApplyReceipt };

/** One finite consumer which never treats display evidence as apply authority. */
export async function reviewAndApplyProject(options: {
  readonly session: ProjectSession;
  readonly approve: ProjectReviewDecision;
}): Promise<ReviewedProjectResult> {
  let result: ReviewedProjectResult | undefined;
  let operationFailed = false;
  let primaryFailure: unknown;
  try {
    const planned = await options.session.plan({ lockMode: "update" });
    if (planned.state === "unchanged") result = { state: "unchanged" };
    else if (!await options.approve(planned)) {
      result = { state: "declined", planDigest: planned.planDigest };
    } else {
      result = {
        state: "applied",
        receipt: await options.session.apply({ planDigest: planned.planDigest }),
      };
    }
  } catch (error) {
    operationFailed = true;
    primaryFailure = error;
  }
  try {
    await options.session.close();
  } catch (closeFailure) {
    if (operationFailed) {
      throw new AggregateError(
        [primaryFailure, closeFailure],
        "project operation and session close both failed",
      );
    }
    throw closeFailure;
  }
  if (operationFailed) throw primaryFailure;
  if (result === undefined) throw new Error("project review produced no result");
  return result;
}
