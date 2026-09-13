# CLI experience contract

Jig's CLI serves **agency through power under control**. People must be able
to understand the task, observe progress, interpret the outcome, and take the
next safe action without a maintainer translating internal machinery.
This specification governs every public Jig command, help screen, approval,
notice, diagnostic, progress display, and installed-launcher failure. It
makes usable control an observable requirement;
[project policy](project-policy.md) retains authority over admission and lifecycle.

## Required experience

1. **Task first.** Identify the requested task and relevant project or target.
   Name stages in ordinary language. Internal lifecycle and implementation
   terms appear only when needed to understand or repair a problem.
2. **Stable progress.** Interactive terminal stderr has one active line with
   elapsed time. Preserve completed stages; never mark a failed or merely
   departed stage complete. Update waiting time in place, not by appending
   unchanged messages. Report the known wait reason; never invent percentages,
   estimated completion times, or internal Flow stages. Finish or suspend the
   active line before prompts, notices, streamed diagnostics, or results.
3. **Consistent visual hierarchy.** Use bold task/section headings and final
   outcomes, green completion, amber warnings, and red failures. Text must
   carry every meaning independently of color or symbols. Use terminal palette
   colors without background fills; remain legible in light and dark themes.
   Narrow terminals must retain complete consent and recovery information;
   only the transient progress label may shorten to fit.
4. **Readable failures.** Order the failure summary, relevant location, known
   explanation/recovery, and diagnostic code. Codes support search and software;
   they must not replace the explanation. Name known missing prerequisites.
   Unknown causes stay unknown, with a bounded diagnostic step rather than a
   guessed repair or raw exception. Explain whether work started and whether
   effects or cleanup are uncertain whenever that affects recovery.
5. **Useful next actions.** Successful setup and review identify the next
   supported action. Failures give a verified command, specific correction, or
   relevant documentation when available. Never invent commands or recommend
   bypassing safeguards. Commands containing user values must be shell-safe.
6. **Explicit authority.** Show consequential permission scope before effects.
   A supplied grant is acknowledged, not requested again. Dependency resolution
   notices retain public/private-network access, pre-validation effects,
   irreversibility, possible rejection, and review-only scope. Approval shows
   every changed public policy record; `--details` includes unchanged policy.
   Presentation must not hide policy behind truncation, decoration, or a pager.
7. **Honest completion.** Command success follows required cleanup. Execution
   completion, application outcome, delivery, and cleanup remain separate.
   Cancellation requested is not cancellation complete. Lost work and unknown
   delivery never invite automatic replay. A declined review is a decision,
   not a crash; already incurred dependency effects are not undone.
8. **Progressive detail.** Ordinary output supports the next decision. Exact
   review details, Run JSON/NDJSON, and bounded diagnostics retain their roles;
   no debug flag is implied. Never hide important failures or authority notices
   behind an optional mode. Do not expose secrets or private host state.
9. **Automation and accessibility.** Run stdout remains exact JSON or NDJSON;
   version stdout remains the version alone. Human status uses stderr.
   Redirected streams contain no terminal escapes or animation; failures and
   consequential notices remain readable. `NO_COLOR` (including an empty value)
   and `TERM=dumb` select plain presentation without animation. Plain terminal
   progress reports stage changes once. Do not require Unicode, a pager, cursor
   hiding, an alternate screen, or interactivity. Escape untrusted control and
   review Unicode characters before presentation.
10. **Acceptance is required.** A CLI-affecting change must check rendered
    success, failure, long waits, cancellation, and uncertain cleanup, plus
    redirected output, color disabled, narrow terminals, and light/dark themes.
    Verify byte-exact machine records, diagnostic safety, complete changed
    policy, and no premature success. An unfamiliar reader must be able to
    identify the outcome and next action from the transcript alone.

## Implementation and review ownership

The CLI's shared presentation and progress modules own human formatting;
command branches supply facts. Installed-launcher errors follow the same
hierarchy even when the application cannot start. Review policy is generated
from the same captured records that are approved, and human Run summaries
come from the same terminal observations as machine results.

Changes to public output must update this contract when its guarantees change,
its owning implementation, and focused acceptance tests together. Adding an
ad hoc raw diagnostic or weakening an assertion to accommodate unreadable
output is not an acceptable shortcut. Recovery advice remains subject to the
[results guide](../guide/results.md) and exact lifecycle contracts.
