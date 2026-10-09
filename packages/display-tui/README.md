# @jigging/display-tui

Render semantic observations in a terminal or a bounded inline region. The
package accepts `@jigging/display-model` snapshots and portable user-updates
views; it does not require the Jig host or acquire execution authority.

```ts
import { prepareTui, createTui } from '@jigging/display-tui'

const support = await prepareTui()
const display = await createTui(support, {
  snapshot,
  theme: 'one-dark',
  preview: async ({ artifactId, captureGeneration }) => retainedPreview(artifactId, captureGeneration),
  onChange: scheduleFrame,
  onAction: action => handleCloseOrInterrupt(action),
  interactionAllowed: () => withinCallerLifetime(),
})
display.update(nextSnapshot)
display.input(ownedInputBytes)
const { text } = await display.frame({ columns: 120, rows: 30, color: true })
// The caller writes text through its own bounded writer.
display.dispose()
```

`prepareTui()` explicitly checks native support and returns an opaque value.
`TuiSupportError` identifies unavailable support. The caller performs this check
before starting work when display availability is a prerequisite. This package
supports the qualified Bun profiles used by Jig: Linux x64 Bun 1.3.3 and Darwin
x64/arm64 Bun 1.4.2, with exact OpenTUI 0.5.17 and tree-sitter 0.25.10 dependencies.
Those support declarations do not qualify a consumer's execution host.

The caller owns real stdin, raw/flowing restoration, signals, output, execution
cancellation and presentation lifetime. `onAction` receives a close or interrupt
intent. Recheck the authoritative execution phase before interpreting an
interrupt; a snapshot cannot grant execution authority. The viewer has no idle
or absolute timeout. `interactionAllowed` lets an enclosing lifetime constrain
navigation without extending that lifetime.

Snapshot updates are silent; the caller schedules its own render after replacement.
`onChange` requests a render only for local input or completed asynchronous preview
work. Viewer state survives complete snapshot replacements by stable identities.
Invalid or incomplete observations retain a visibly stale complete body with
references disabled. File access accepts only an inventory artifact ID and its
capture generation. The preview service must supply retained immutable bytes;
no path or arbitrary URL is passed to it. Preview identity, selection and disposal
fence late replies. One excerpt is at most 64 KiB. Expansion and literal search
reuse it. Frames are serialized and bounded to 32 KiB including ANSI bytes.

To continue inline after a live close intent, call `display.handoffInline()` before
disposal. It returns an `InlineDisplay` once and ends native rendering, input,
preview work and callbacks while transferring the chosen destination and local
selection, filters, sorts, disclosure, tree and scroll state. Dispose the returned
inline owner when presentation ends. Disposing the old TUI owner afterward does
not dispose that transferred owner; disposed inspectors cannot hand off again.

Opaque semantic IDs remain separate from tagged navigation and record identities,
including IDs equal to built-in names or strings resembling those tags. Missing
call parents remain unavailable relationship evidence while their calls and
descendants render at the tree root. Incomplete or malformed replacements show
a stale marker independently of a sticky cause, including compact layouts.
Warning markers and titles escape supplied controls and remain one physical line;
shortened warning explanations remain in wrapped context. Workspace facts retain
their own host-observed, application-reported or recorded-claim attribution and
clipping. Only complete host-observed status facts receive verdict colors.
Application outcomes remain literal. Full facts are available with `!` and in
inline output, including when compact geometry shortens the status header.

Supply input bytes through `display.input`; the package never reads stdin:

| Keys | Viewer intent |
| --- | --- |
| Tab / Shift-Tab, `v` | Next/previous destination, or open the destination chooser |
| Up/Down or `k`/`j`, `c` | Select an entry, or move through collections |
| Enter, Escape | Expand evidence, or return from the current disclosure |
| `/`, `s`, `r` | Filter rows, choose sorting, or inspect typed references |
| `!`, `?` | Full causes/facts, or contextual keyboard help |
| `q`, Ctrl-C | Close intent, or interrupt intent for the caller to interpret |

Keys are contextual: printable characters edit an active filter/search draft.
The caller owns every resulting effect and may transfer a live close into inline
presentation rather than canceling work.

For inline output, native support is unnecessary. Inline frames and the text
width/wrapping helpers still require Bun's text-width API; Node can import inert
exports and compile their declarations but cannot render these frames:

```ts
import { createInlineDisplay } from '@jigging/display-tui/inline'

const display = createInlineDisplay({ snapshot })
const { lines } = display.frame({ columns: 80, rows: 12, color: false })
display.dispose()
```

`@jigging/display-tui/text` exports `escapeTerminalText`, `terminalWidth`,
`truncateTerminalText` and `wrapTerminalText`. `@jigging/display-tui/style` exports
small heading, secondary, selection and syntax-color functions with explicit
theme input. These modules have no native initialization or host command parser.

To qualify frozen package archives, run `just test-package` on the qualified Bun
profile with these absolute paths supplied:

- `DISPLAY_TUI_PACKAGE_ARCHIVE`: the terminal display candidate.
- `DISPLAY_MODEL_PACKAGE_ARCHIVE`: its semantic model candidate.
- `USER_UPDATES_PACKAGE_ARCHIVE`: the portable updates candidate.
- `FLOW_SDK_PACKAGE_ARCHIVE`: the public Flow SDK candidate.
- `FLOW_NODE`: an independent Node executable used to compile the public consumer
  declarations. This does not qualify Node as a native terminal runtime.

The proof installs those exact archives in a temporary consumer with Jig absent,
checks unchanged archive hashes, exercises native frames and retained previews,
and verifies inline imports with native support hidden.

Jig's existing Bread terms and pricing apply to this moved Jig implementation.
Personal use, qualifying organizational use and genuine evaluation remain free
under the applicable grant. See the included license and pricing documents.
