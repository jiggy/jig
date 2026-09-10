import "@jigging/flow-authoring/typespec";
using FLOW;

@invocation(Input, Result, #{
  outcomes: #{
    blocked: "The Agent cannot draft the requested proposal.",
    limit: "The Agent reaches its execution limit."
  }
})
namespace Drafter;

@minLength(1) @maxLength(64)
scalar Identifier extends string;

@minLength(1) @maxLength(16000)
scalar LongText extends string;

@minLength(1) @maxLength(2048)
scalar EvidenceUrl extends string;

@closed
model Requirement {
  id: Identifier;
  description: LongText;
}

@closed
model Evidence {
  id: Identifier;
  url: EvidenceUrl;
  text: LongText;
}

@closed
model Request {
  objective: LongText;
  @minItems(1) @maxItems(16) requirements: Requirement[];
  @minItems(1) @maxItems(32) evidence: Evidence[];
}

@closed
model Section {
  requirementId: string;
  claim: string;
  @maxItems(32) citationIds: string[];
}

@closed
@agentResponse("./proposal.schema.json")
model Proposal {
  title: string;
  @maxItems(16) sections: Section[];
  @maxItems(16) limitations: string[];
}

@closed
model Input {
  request: Request;
  previous: Proposal | null;
  @maxItems(128) feedback: string[];
}

@closed
model Reason {
  reason: string;
}

@closed
model DoneResult {
  outcome: "done";
  output: Proposal;
}

@closed
model StoppedResult {
  outcome: "blocked" | "limit";
  output: Reason;
}

@oneOf
union Result {
  done: DoneResult,
  stopped: StoppedResult
}
