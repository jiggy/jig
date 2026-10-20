# Repository licensing

Copyright © 2026 Victor Duarte <zvictor> and contributors.

This repository contains several separately licensed works. The most specific
entry below controls. Third-party material retains its own license as recorded
in the relevant notice file. Package license and notice files reproduce or
identify the governing terms for their installed package.

| Material | License |
| --- | --- |
| Jig host and display-library source, installed package documentation, project specifications, and machine schemas (`packages/jig/**`; `packages/display-model/**`; `packages/display-web/**`; `packages/display-tui/**`; `docs/jig/spec/**`), excluding separately identified third-party material | Bread License ([Jig adoption and text](LICENSE.md)) |
| Reusable Agent methods, their installed Flow artifacts, and portable reporting libraries/agreement (`packages/agent-method/**`; `packages/agent-acp/**`; `packages/reporting/**`; `packages/jiggy-reporting/**`, except bundled third-party material) | Mozilla Public License 2.0 ([text](LICENSES/MPL-2.0.txt)) |
| FLOW regression snapshots (`packages/jig/test/fixtures/flow-conformance/**`) | Apache License 2.0 ([text](LICENSES/Apache-2.0.txt)) |
| Manrope and JetBrains Mono font files (`site/theme/fonts/**`) | SIL Open Font License 1.1 (individual notices in [site/theme/fonts](https://github.com/jiggy/jig/tree/main/site/theme/fonts)) |
| Explanatory documentation and public sites (`docs/jig/index.md`; `docs/jig/guide/**`; `docs/jig/contracts/**`; `docs/jig/use-cases.md`; `docs/jig/time-travel-handoff.md`; `docs/jig/orchestration-patterns.md`; `site/jig/public/**`) | Creative Commons Attribution 4.0 International ([text](LICENSES/CC-BY-4.0.txt)) |

Original repository material not listed above, including repository tooling
and the Sley integration skill, is available under MPL-2.0
([text](LICENSES/MPL-2.0.txt)). Jig's license does not cover FLOW, independent
applications, or separately licensed third-party material. Packages carry
the applicable terms and notices. Earlier distributions retain their valid
licenses; this mapping applies to the source version carrying it.

No software or content license grants rights in project names, logos, service
marks, or conformance marks except for the limited descriptive uses required
by the applicable license.
