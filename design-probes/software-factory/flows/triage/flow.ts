#!/usr/bin/env spindle
// DESIGN PROBE ONLY: hypothetical Spindle authoring, no implementation exists.
// `next()` below sketches control topology only. Until Spindle defines its
// minimal runner-local value/state rule, the research result cannot honestly
// feed build and the three voter results cannot honestly feed synthesis.
import {
  Agent,
  Flow,
  FlowCall,
  Outcome,
  Router,
} from "spindle";

const done = new Outcome("done");
const blocked = new Outcome("blocked");

const research = new FlowCall({
  slot: "reference-research",
  intent: "Research and justify a suitable quality reference for this ticket.",
});
const build = new Agent({
  using: "agent",
  instructions: "Implement the smallest testable version in the workspace.",
});
const review = new Agent({
  using: "agent",
  instructions: "Review the implementation against the request and reference.",
});
const revise = new Agent({
  using: "agent",
  instructions: "Fix the material review findings without unrelated changes.",
});
const verify = new Agent({
  using: "agent",
  instructions: "Run the focused checks and summarize the final evidence.",
});

research.next(build);
build.next(review);
review.next(revise);
revise.next(verify);
verify.next(done);
const gauntlet = new Flow(research);

const voterOne = new Agent({
  using: "agent",
  instructions: "Independently propose the safest implementation approach.",
});
const voterTwo = new Agent({
  using: "agent",
  instructions: "Independently challenge the first-order implementation risks.",
});
const voterThree = new Agent({
  using: "agent",
  instructions: "Independently optimize for the smallest correct change.",
});
const synthesize = new Agent({
  using: "agent",
  instructions: "Synthesize the three views, implement, and verify the result.",
});

voterOne.next(voterTwo);
voterTwo.next(voterThree);
voterThree.next(synthesize);
synthesize.next(done);
const majorityVote = new Flow(voterOne);

const route = new Router({
  using: "choice",
  objective: "Choose the better fixed strategy for the committed ticket.",
});

route.to(
  "gauntlet",
  gauntlet,
  "Use iterative implementation, critique, revision, and verification.",
);
route.to(
  "majority-vote",
  majorityVote,
  "Use several independent approaches before synthesizing one result.",
);
route.onAbstain(blocked);

export default new Flow(route);
