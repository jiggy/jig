import type { JsonValue, RunContext, RunResult } from "@jigging/flow";

export type Request = {
  objective: string;
  requirements: { id: string; description: string }[];
  evidence: { id: string; url: string; text: string }[];
};
export type Proposal = {
  title: string;
  sections: { requirementId: string; claim: string; citationIds: string[] }[];
  limitations: string[];
};
type Review = { verdict: "approve" | "revise" | "blocked"; issues: string[] };

export async function workshop(run: Pick<RunContext, "input" | "callFlow">): Promise<RunResult> {
  const request = parseRequest(run.input);
  let proposal: Proposal | null = null;
  let review: Review | null = null;
  let feedback: string[] = [];
  const history: { attempt: number; feedback: string[]; verdict: string }[] = [];
  const finish = (outcome: string, reason: string): RunResult => ({
    outcome,
    output: {
      reason, proposal, review, attempts: history.length, history,
      markdown: outcome === "done" && proposal !== null ? renderProposal(proposal, request) : "",
    },
  });

  // One initial draft and at most one revision. Errors are never retried here.
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    review = null;
    const drafted = await run.callFlow({
      operationId: `draft-${attempt}`,
      slot: "drafter",
      input: { request, previous: proposal, feedback },
    });
    if (drafted.outcome === "blocked" || drafted.outcome === "limit") {
      history.push({ attempt, feedback: [reason(drafted.output)], verdict: drafted.outcome });
      return finish(drafted.outcome, "The drafting specialist stopped before completing this attempt.");
    }
    if (drafted.outcome !== "done") throw new Error("The drafter returned an unexpected outcome.");
    proposal = parseProposal(drafted.output);
    feedback = checkProposal(proposal, request);
    if (feedback.length === 0) {
      const reviewed = await run.callFlow({
        operationId: `review-${attempt}`,
        slot: "reviewer",
        input: { request, proposal },
      });
      if (reviewed.outcome === "blocked" || reviewed.outcome === "limit") {
        history.push({ attempt, feedback: [reason(reviewed.output)], verdict: reviewed.outcome });
        return finish(reviewed.outcome, "The review specialist stopped before completing its review.");
      }
      if (reviewed.outcome !== "done") throw new Error("The reviewer returned an unexpected outcome.");
      review = parseReview(reviewed.output);
      feedback = review.issues;
      history.push({ attempt, feedback, verdict: review.verdict });
      if (review.verdict === "approve") return finish("done", "The proposal passed mechanical checks and review.");
      if (review.verdict === "blocked") return finish("blocked", "The reviewer identified a blocking evidence gap.");
    } else {
      history.push({ attempt, feedback, verdict: "mechanical-check-failed" });
    }
  }
  return finish("limit", "The proposal remains unapproved after the one permitted revision.");
}

export function checkProposal(proposal: Proposal, request: Request): string[] {
  const issues: string[] = [];
  if (proposal.title.trim() === "") issues.push("The proposal title is empty.");
  const requirements = new Set(request.requirements.map(({ id }) => id));
  const sources = new Set(request.evidence.map(({ id }) => id));
  const seen = new Set<string>();
  for (const section of proposal.sections) {
    const id = section.requirementId;
    if (!requirements.has(id)) issues.push(`Unknown requirement: ${id}.`);
    if (seen.has(id)) issues.push(`Duplicate requirement: ${id}.`);
    seen.add(id);
    if (section.claim.trim() === "") issues.push(`Empty claim for requirement: ${id}.`);
    if (section.citationIds.length === 0) issues.push(`Missing citation for requirement: ${id}.`);
    if (new Set(section.citationIds).size !== section.citationIds.length) {
      issues.push(`Duplicate citations for requirement: ${id}.`);
    }
    for (const citation of section.citationIds) {
      if (!sources.has(citation)) issues.push(`Unknown citation: ${citation} in requirement: ${id}.`);
    }
  }
  for (const { id } of request.requirements) {
    if (!seen.has(id)) issues.push(`Missing requirement: ${id}.`);
  }
  return issues.length <= 128 ? issues : [
    ...issues.slice(0, 127),
    "Additional mechanical issues omitted; every requirement and citation must pass the checks.",
  ];
}

function renderProposal(proposal: Proposal, request: Request): string {
  const evidence = new Map(request.evidence.map((item) => [item.id, item]));
  const requirements = new Map(request.requirements.map((item) => [item.id, item]));
  return [
    `# ${markdownText(proposal.title)}`,
    ...proposal.sections.map((section) => [
      `## ${markdownText(requirements.get(section.requirementId)!.description)}`,
      `${markdownText(section.claim)} ${section.citationIds.map((id) =>
        `[${markdownText(id)}](<${new URL(evidence.get(id)!.url).href.replaceAll(">", "%3E").replaceAll("<", "%3C")}>)`
      ).join(" ")}`,
    ].join("\n\n")),
    "## Limitations",
    proposal.limitations.length === 0
      ? "No additional limitations were reported by the drafter. Review does not establish factual correctness."
      : proposal.limitations.map((item) => `- ${markdownText(item)}`).join("\n"),
  ].join("\n\n");
}

function markdownText(value: string): string {
  return value.replace(/[\r\n]+/g, " ").replace(/[\\`*_{}\[\]<>#]/g, "\\$&");
}

export function parseRequest(value: JsonValue): Request {
  const input = object(value);
  const request: Request = {
    objective: string(input.objective),
    requirements: array(input.requirements).map((item) => {
      const requirement = object(item);
      return { id: string(requirement.id), description: string(requirement.description) };
    }),
    evidence: array(input.evidence).map((item) => {
      const evidence = object(item);
      const url = string(evidence.url);
      if (!["https:", "http:"].includes(new URL(url).protocol)) {
        throw new TypeError("Evidence links must use HTTP or HTTPS.");
      }
      return { id: string(evidence.id), url, text: string(evidence.text) };
    }),
  };
  for (const values of [request.requirements, request.evidence]) {
    if (values.length === 0 || values.some(({ id }) => id.trim() === "") ||
        new Set(values.map(({ id }) => id)).size !== values.length) {
      throw new TypeError("Requirements and evidence need nonempty, unique IDs.");
    }
  }
  return request;
}

function parseProposal(value: JsonValue): Proposal {
  const proposal = object(value);
  return {
    title: string(proposal.title),
    sections: array(proposal.sections).map((item) => {
      const section = object(item);
      return {
        requirementId: string(section.requirementId),
        claim: string(section.claim),
        citationIds: array(section.citationIds).map(string),
      };
    }),
    limitations: array(proposal.limitations).map(string),
  };
}

function parseReview(value: JsonValue): Review {
  const review = object(value);
  const verdict = review.verdict;
  if (verdict !== "approve" && verdict !== "revise" && verdict !== "blocked") {
    throw new TypeError("The reviewer returned an invalid verdict.");
  }
  const issues = array(review.issues).map(string);
  const blankIssueCount = issues.filter((item) => item.trim() === "").length;
  if ((verdict === "approve") !== (issues.length === 0) || blankIssueCount !== 0) {
    throw new TypeError(`Review issues must agree with the verdict (${verdict}; ${issues.length} issues; ${blankIssueCount} blank issues).`);
  }
  return { verdict, issues };
}

function reason(value: JsonValue): string { return string(object(value).reason); }
function object(value: JsonValue | undefined): Record<string, JsonValue> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) throw new TypeError("Expected an object.");
  return value as Record<string, JsonValue>;
}
function array(value: JsonValue | undefined): readonly JsonValue[] {
  if (!Array.isArray(value)) throw new TypeError("Expected an array.");
  return value;
}
function string(value: JsonValue | undefined): string {
  if (typeof value !== "string") throw new TypeError("Expected a string.");
  return value;
}
