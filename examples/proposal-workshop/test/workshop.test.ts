import { describe, expect, test } from "bun:test";
import type { FlowCall, JsonValue, RunResult } from "@jigging/flow";
import fixture from "../fixtures/library-pilot.json";
import { checkProposal, parseRequest, workshop, type Proposal } from "../flows/workshop/workshop.ts";
import { draft } from "../flows/drafter/draft.ts";
import { review } from "../flows/reviewer/review.ts";

const request = parseRequest(fixture);
const proposal = (): Proposal => ({
  title: "Eight-week library pilot",
  sections: [
    { requirementId: "schedule", claim: "Propose a two-hour Tuesday evening pilot for eight weeks; day preference remains uncertain.", citationIds: ["E1", "E3"] },
    { requirementId: "staffing", claim: "Two staff for two hours uses four additional staff-hours weekly, within the eight-hour ceiling; confirm consent and rosters first.", citationIds: ["E2"] },
    { requirementId: "measurement", claim: "Record evening attendance and staff-hours, collect feedback, and present a continuation decision after eight weeks; agree a target before starting.", citationIds: ["E3"] },
  ],
  limitations: ["The records are synthetic. Survey interest is not an attendance forecast; rosters and targets need approval."],
});
const done = (output: JsonValue): RunResult => ({ outcome: "done", output });
const approved = () => done({ verdict: "approve", issues: [] });

function scenario(responses: (RunResult | Error)[]) {
  const calls: FlowCall[] = [];
  return {
    calls,
    run: () => workshop({
      input: fixture,
      callFlow: async (call) => {
        calls.push(call);
        const response = responses.shift();
        if (response === undefined) throw new Error("Unexpected additional child call.");
        if (response instanceof Error) throw response;
        return response;
      },
    }),
  };
}

describe("proposal workshop's mechanical evidence gate", () => {
  test("rejects bogus citations, missing citations, and incomplete requirement coverage", () => {
    const invalid = proposal();
    invalid.sections[0]!.citationIds = ["invented"];
    invalid.sections[1]!.citationIds = [];
    invalid.sections.pop();
    expect(checkProposal(invalid, request)).toEqual([
      "Unknown citation: invented in requirement: schedule.",
      "Missing citation for requirement: staffing.",
      "Missing requirement: measurement.",
    ]);
  });

  test("rejects duplicate requirement sections and ambiguous evidence IDs", () => {
    const invalid = proposal();
    invalid.sections.push(invalid.sections[0]!);
    expect(checkProposal(invalid, request)).toContain("Duplicate requirement: schedule.");
    expect(() => parseRequest({ ...fixture, evidence: [fixture.evidence[0]!, fixture.evidence[0]!] }))
      .toThrow("nonempty, unique IDs");
  });

  test("renders supplied source links only after approving review", async () => {
    const sample = scenario([done(proposal()), approved()]);
    const result = await sample.run();
    expect(result).toMatchObject({ outcome: "done", output: { attempts: 1, review: { verdict: "approve" } } });
    expect((result.output as any).markdown).toContain("[E2](<https://example.org/library-pilot/staffing>)");
    expect(sample.calls.map(({ slot, operationId }) => [slot, operationId]))
      .toEqual([["drafter", "draft-1"], ["reviewer", "review-1"]]);
  });

  test("passes mechanical feedback to the sole revision without reviewing a broken draft", async () => {
    const invalid = proposal();
    invalid.sections[0]!.citationIds = ["invented"];
    const sample = scenario([done(invalid), done(proposal()), approved()]);
    expect(await sample.run()).toMatchObject({ outcome: "done", output: { attempts: 2 } });
    expect(sample.calls.map(({ slot }) => slot)).toEqual(["drafter", "drafter", "reviewer"]);
    expect(sample.calls[1]!.input).toMatchObject({
      previous: invalid,
      feedback: ["Unknown citation: invented in requirement: schedule."],
    });
  });

  test("revises an unapproved review once and retains its feedback", async () => {
    const feedback = ["State that staff consent is still required."];
    const sample = scenario([
      done(proposal()), done({ verdict: "revise", issues: feedback }),
      done(proposal()), approved(),
    ]);
    expect(await sample.run()).toMatchObject({
      outcome: "done", output: { attempts: 2, history: [{ attempt: 1, feedback, verdict: "revise" }, { attempt: 2, feedback: [], verdict: "approve" }] },
    });
    expect(sample.calls[2]!.input).toMatchObject({ feedback });
  });

  test("does not turn exhausted revisions into an approved proposal", async () => {
    const invalid = proposal();
    invalid.sections = [];
    const sample = scenario([done(invalid), done(invalid)]);
    expect(await sample.run()).toMatchObject({ outcome: "limit", output: { attempts: 2, markdown: "", review: null } });
    expect(sample.calls).toHaveLength(2);
  });

  test("stops on blocked drafting and limited reviewing without retry", async () => {
    const blocked = scenario([{ outcome: "blocked", output: { reason: "Evidence is contradictory." } }]);
    expect(await blocked.run()).toMatchObject({ outcome: "blocked", output: { attempts: 1, proposal: null, markdown: "" } });
    expect(blocked.calls).toHaveLength(1);
    const limited = scenario([done(proposal()), { outcome: "limit", output: { reason: "Agent budget exhausted." } }]);
    expect(await limited.run()).toMatchObject({ outcome: "limit", output: { attempts: 1, markdown: "" } });
    expect(limited.calls).toHaveLength(2);
  });

  test("preserves a blocking review and rejects inconsistent approval", async () => {
    const blocked = scenario([done(proposal()), done({ verdict: "blocked", issues: ["The evidence cannot support the required decision."] })]);
    expect(await blocked.run()).toMatchObject({ outcome: "blocked", output: { review: { verdict: "blocked" }, markdown: "" } });
    const inconsistent = scenario([done(proposal()), done({ verdict: "approve", issues: ["An unresolved material problem."] })]);
    await expect(inconsistent.run()).rejects.toThrow("Review issues must agree");
  });

  test("identifies blank external review issues without exposing their content", async () => {
    const blank = scenario([done(proposal()), done({ verdict: "revise", issues: [" "] })]);
    await expect(blank.run()).rejects.toThrow("revise; 1 issues; 1 blank issues");
  });

  test("propagates a failed child call without replay or domain success", async () => {
    const failure = new Error("Possibly dispatched child work is uncertain.");
    const sample = scenario([failure]);
    await expect(sample.run()).rejects.toBe(failure);
    expect(sample.calls).toHaveLength(1);
  });
});

test("specialists select their own call Skill and reviewer configuration", async () => {
  const calls: { input: any; slot: string; method: string }[] = [];
  const callEffect = async (call: any) => {
    calls.push(call);
    return { outcome: "blocked", text: "Deliberate deterministic stop." };
  };
  expect(await draft({ input: { request, previous: null, feedback: [] }, callEffect }))
    .toMatchObject({ outcome: "blocked" });
  expect(await review({ input: { request, proposal: proposal() }, settings: { reviewFocus: "Check the staffing ceiling." }, callEffect }))
    .toMatchObject({ outcome: "blocked" });
  expect(calls.map(({ input }) => input.skills)).toEqual([["grounded-drafting"], ["evidence-review"]]);
  expect(calls[1]!.input.instructions).toContain("Check the staffing ceiling.");
  expect(calls.every(({ slot, method }) => slot === "agent" && method === "run")).toBe(true);
});
