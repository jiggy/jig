---
pageType: home
title: "Put your Agents to work."
description: "Put Agent judgment to work inside your software. Combine it with ordinary code, run useful methods locally, and choose the powers they receive."
---

# Put your Agents to work. Inside your software.

Let your app call on Agent judgment and ordinary code.
Jig runs the work with the access you choose.

[Meet Jig, a local host for code and Agents](guide/understand.md).
[Start building](#start).

<span id="examples-carousel"></span>

## Everyday apps built with Jig

The opening carousel contains Photos, Support, and Kitchen rota examples.
These browser illustrations show app ideas. They do not run a task.

<span id="photo-demo"></span>

### From a photo box to a book to keep.

Start with something familiar. A photo app, built with Jig.

The Photo box illustration follows six sample photos through three phases.

| Phase | What you see |
| --- | --- |
| Photos | `IMG_0198.svg`, `DSC_2044.svg`, `phone-copy.svg`, `IMG_0201.svg`, `DSC_2047.svg`, and `export-final.svg` form a messy folder. |
| Albums | Lake Picnic, Birthday, and Mountain Walk each contain two sample photos. Captions and dates connect related moments. |
| Yearbook | The same photos become a book, “The days we keep.” Lake Picnic is dated 14 June, Birthday 21 June, and Mountain Walk 5 July. |

Originals stay untouched. The Yearbook phase is an app idea.
Choose Photos, Albums, or Yearbook to explore the illustration.

[Try the real photo organiser](https://github.com/jiggy/jig/tree/main/examples/photo-organiser).

<span id="example-support"></span>

### A customer’s words. A checked next step.

A support helper, built with Jig.

| Before | After |
| --- | --- |
| “I was charged twice. Please credit the second payment.” | Duplicate verified. Within policy. Credit eligible: USD 24.00. |
| Charges `ch-101` and `ch-102` are both settled USD 24.00 payments for the same invoice. | A reply draft explains that the duplicate payment is eligible for a USD 24.00 credit. |

The two charges move into a matched pair. The checked decision and reply draft appear below.
The result is ready for your application. No credit or message is sent.

Choose Before or After to explore.
[Explore the support example](guide/support-case.md).

<span id="example-kitchen"></span>

### Six volunteers. One covered morning.

A kitchen rota, built with Jig.

| Volunteer | Availability | Role |
| --- | --- | --- |
| Alex | 09–11 | Cook |
| Bea | 09–11 | Serve |
| Casey | 11–13 | Cook |
| Drew | 11–13 | Serve |
| Sam | 12–13 | Either |
| Toni | 10–12 | Either |

The illustration matches Alex and Bea to 09–11, then Casey and Drew to 11–13.
Sam and Toni remain available too. Time and role colours connect each person to the corresponding shift.

Every shift is covered. Availability and workload are checked.
An Agent proposes the rota. Code checks it.
Choose Before or After to explore.

[Explore the kitchen example](https://github.com/jiggy/jig/tree/main/examples/kitchen-roster).

<span id="how-it-works"></span>

## Code and Agents. Built to work together.

Agent instructions and ordinary code are first-class methods.
Call either, let them call each other, and build with both.

### Prepare a reply: one Flow, two implementations

The illustration places equivalent method steps beside each other.
An equals sign joins the two implementations behind one callable boundary.

**FLOW.md — Agent instructions**

```md
# Prepare a reply

Read the supplied request.
Choose the next step.
Write a reply.
Return outcome done with the reply as output.
```

**FLOW.ts — TypeScript**

```ts
import { handle } from '@jigging/flow'

await handle(async (run) => {
  const request = readRequest(run.input)
  const nextStep = chooseNextStep(request)
  const reply = writeReply(nextStep)
  return { outcome: 'done', output: reply }
})
```

Both receive input through `method(input)` and return an outcome and result.
These are alternative Flow entrypoints with illustrative helper calls.

Choose the runtime for your method.

| Runtime | Status |
| --- | --- |
| Markdown | Available now |
| TypeScript / Bun | Available now |
| Python | Coming soon |

More runtimes are planned.

<span id="your-control"></span>

## Give it power. Keep the choice.

Choose what runs, what it can reach, and where it stops.
The control illustration offers Grant, Limit, and Review views.

### Grant: only the reach you grant

Your methods get the powers you choose.
The illustration grants files and an Agent while HTTP has no access.

[Choose its powers](spec/grants.md).

### Limit: a boundary around the run

Choose a deadline. Jig enforces limits and accounts for cleanup.
Time, memory, and processes surround the illustrated method.
The execution sequence is Run, Settle, Return.

[Inside the boundary](spec/project-policy.md).

### Review: community Flows, reviewed first

Inspect a community Flow and its requested access before it runs.
Jig executes the revision you accept.
The illustration follows Community Flow, Your review, then Accepted revision.

[How review works](guide/dependencies.md).

<span id="app-views"></span>

## Build the workflow. Web and TUI are included.

Describe your app’s view once.
Jig supplies an interactive browser workspace and a keyboard-driven terminal interface.
No separate frontend for each.

The Web and Terminal / TUI tabs currently contain temporary placeholders.
They do not embed a working display or run a task.

The section introduces filtering and sorting records, previewing delivered files, and inspecting calls and errors.
[Describe your app’s view](guide/channels.md).

<span id="architecture"></span>

## Bring the same FLOW to your next app.

Built on [FLOW](https://flow.jig.md/).

Keep the method you already rely on.
Use it in another app, workflow, or Agent without rebuilding it.

The reuse carousel contains three methods. Each keeps the same Flow while its app connections change.
These are app ideas and illustrations.

### Translate text

Input: text and a language. Output: translated text.

| App | Input | Result |
| --- | --- | --- |
| Recipe keeper | “Fold in the flour. Bake for 35 minutes.” | “Incorpora la harina. Hornea durante 35 minutos.” The recipe becomes a Spanish preparation view. |
| Travel companion | “Where does the last train leave from?” | “¿De dónde sale el último tren?” The phrase appears in a Madrid travel companion. |

Same FLOW. Different apps.

### Find dates

Input: text. Output: dated events.

| App | Input | Result |
| --- | --- | --- |
| Family calendar | “Sports day is on 18 June 2027 at 10:00, on the school field. Bring a hat!” | Sports day, 18 June 2027 at 10:00, School field. |
| Project tracker | “The design review is on 24 June 2027 at 14:00. Final handoff is 28 June 2027.” | Design review, 24 June 2027 at 14:00. Final handoff, 28 June 2027. |

Same FLOW. Different apps.

### Summarise text

Input: text. Output: a short summary.

| App | Input | Result |
| --- | --- | --- |
| Reading companion | “A garden changes every week. Observing before planting helps you work with shade, soil, and the seasons.” | “Watch first. Plant second.” Learn the light and soil before choosing what to grow. |
| Team handover | “Mobile tests passed. Payment retry is ready for review. Lea will check it tomorrow. Release waits for that review.” | Mobile tests passed. Lea reviews payment retry tomorrow. Release follows that review. |

Same FLOW. Different apps.

### New connections. Same FLOW.

Connect your FLOW to a different method through the same shared contract.
The illustration connects “Your FLOW — Same method” to “Connection — Same contract.”

[How contracts make parts fit](guide/contracts.md).

### How a Flow connects

Input starts a call.
Optional subscriptions bring messages in. Publications send messages out.
The call returns an outcome and result.

The cross diagram places input above the Flow and outcome plus result below it.
Incoming subscriptions appear on the left. Outgoing publications appear on the right.

[Explore the FLOW standard](https://flow.jig.md/).

<span id="microkernel"></span>

## Big ideas. A small core.

Microkernel-inspired by design.

Design the method. Choose its Agents. Keep the execution foundation.

| Part | What stays with it |
| --- | --- |
| Your application | Your purpose. Your rules. One calling boundary: `method(input)`. |
| Jig | Review, powers, limits, and lifecycle. The same focused execution core. |
| Your Agent | Your choice, connected through ACP. This is separate from the method. |
| Inside your Flow | The authored method and its internal procedure. |

The illustration offers Codex, Claude Code, and Pi as independent Agent choices.
[Explore ACP clients](guide/agents.md#local-clients).

Three application examples each offer a specialist, a review loop, and a specialist team.
Switching the app, strategy, or Agent leaves the other choices and execution foundation in place.
These diagrams illustrate authored procedures and independent configuration choices.

### Research brief

Input: a question. Output: brief and outcome.

| Strategy | Inside the Flow |
| --- | --- |
| A specialist | One researcher investigates the question and returns a brief. |
| Review & refine | Draft, review, then refine the research brief. The authored method can repeat the review loop before returning. |
| A specialist team | Plan the investigation. Research, Analyze, and Challenge specialists work together. Synthesize their work into a brief. |

### Software factory

Input: an idea. Output: proposed change and evidence.

| Strategy | Inside the Flow |
| --- | --- |
| A specialist | A Builder designs and builds a proposed software change. |
| Review & refine | Plan the idea, build the change, then run checks. Refine the implementation before returning the proposal and evidence. |
| A specialist team | Plan, assign Build and Add tests work to specialists, run checks, then review the proposed change and evidence. |

### Event plan

Input: an event brief. Output: proposed event plan.

| Strategy | Inside the Flow |
| --- | --- |
| A specialist | One Planner shapes the occasion and proposes an event plan. |
| Review & refine | Draft a plan, check its fit against budget and guest limits, then adjust. The method can repeat this loop. |
| A specialist team | Coordinate Venue and Programme specialists. Reconcile their proposals with the separate budget constraint, then check the proposed plan’s fit. |

Your next idea shouldn’t need a new kernel.

[Explore the architecture](guide/understand.md#why-a-microkernel-inspired-host).

<span id="start"></span>

## Start with hello. Build something bigger.

Learn the review-and-run loop with a greeting.
Then combine specialists into a more capable application.

[Run your first Flow](guide/index.md#your-first-flow).
Developer alpha: [check Linux and Mac requirements](guide/index.md#supported-host).

### Ask your Agent

The default setup tab offers this prompt to paste into your coding Agent:

```text
Bootstrap a Jig project: https://jig.md/guide/for-agents.html
```

Your Agent follows the current [Jig setup guide](guide/for-agents.md).

### Terminal

```sh
# Install Jig, then make a small project
npm install --global @jigging/jig@alpha
jig init hello-jig
cd hello-jig

# Review the source, then approve it
jig review --allow-resolution-network

# Run the approved method
jig run flow:flows/hello --input '"Ada"'
```

Expected result:

```text
Hello, Ada!
```

Review may access the network to resolve dependencies.
Inspect the source and policy before approving.

### Combine specialists into a workflow

Try a more capable application.
Go further with a support application that interprets requests, checks account records, and prepares a reply.

[Build the support workflow](guide/support-case.md).
[Explore a small software factory](guide/software-factory.md).

## Build with Agents as naturally as you build with code.

Expand human possibility.
Developer alpha. Bread source-available.

Free for personal non-business use, genuine evaluation, and qualifying business groups below US$1m annual revenue.
[Licence terms apply](https://github.com/jiggy/jig/blob/main/LICENSE.md).
Agent judgment can be wrong. Application checks still matter.

[Documentation](guide/index.md) · [GitHub](https://github.com/jiggy/jig) · [FLOW](https://flow.jig.md/) · [Pricing & licence](pricing.md)
