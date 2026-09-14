# Public site theme

## Purpose

Make FLOW's capability compounding and Jig's agency understandable through a
shared reading experience.

## Ownership

- `index.tsx` extends the default layout with homepage composition, document
  context, and a direct Markdown resource link beside Rspress's copy action.
- `package-showcase.tsx` renders the FLOW package explorer from frontmatter,
  preserving every stage, language, and optional layer in generated Markdown.
  It uses native Rspress code rendering and the shared One Light/One Dark Pro
  palettes; snippets demonstrate the protocol and do not execute in the browser.
- `showcase.tsx` renders Jig’s illustrative implementations from homepage frontmatter,
  showing a request, selectable method steps, and an illustrative result.
  A native disclosure reveals the unchanged caller and implementation. All
  inputs, variants, results, and qualifications remain in generated Markdown.
  It never executes product work.
- `search.tsx` uses Rspress's native local search with conditional mounting,
  modal semantics, keyboard controls, focus containment, and focus restoration.
- `navigation.tsx` presents the flat primary links in a native mobile disclosure
  with Escape dismissal and a theme control; configurations keep those links flat.
- `appearance.tsx` supplies a native theme button, retaining keyboard focus
  inside the mobile navigation so Escape can dismiss it after a theme change.
- `sidebar.tsx` gives native sidebar groups keyboard controls and expanded
  state, and removes collapsed links from the focus order.
- `tabs.tsx` adds keyboard tab semantics to native Rspress tabs while retaining
  language persistence and complete Markdown export.
- `code-themes.ts` retains the One Light and One Dark Pro palettes with native
  Shiki color replacements targeting 7:1 text contrast against their code backgrounds.
- `llms.ts` orders generated page links using the same sidebar as human readers;
  unlisted public pages remain discoverable rather than silently disappearing.
- `fonts/` owns self-hosted Latin variable Manrope and JetBrains Mono fonts,
  taken unchanged from Fontsource packages 5.3.0. Their individual OFL notices
  are copied to each site's `/font-licenses/` directory during assembly.
- `accessible-markdown.ts` gives generated heading links accessible names and
  makes tables keyboard-focusable for horizontal scrolling.
- `diagram-images.ts` and `diagram-theme-loader.cjs` generate fixed light/dark
  variants of local Archify SVGs during HTML builds. Site appearance selects
  the visible image; native zoom and the original Markdown image remain intact.
  This avoids relying on WebKit inheriting color schemes inside SVG images.
- Public prose stays in `docs/`; shared presentation stays in `../landing.css`.

## Local Contracts

- Preserve default documentation navigation, search, and accessibility.
- Keep both sites independent; shared components contain no product prose.

## Work Guidance

- Prefer the default theme and small extensions over a copied theme.
- Landing pages move from an early interactive demonstration to product-specific
  structure and one first-use path. Keep implementation details in disclosures,
  resource routing compact, and motion brief, optional, and reduced-motion aware.
- Place the package explorer’s caption below its instrument. Supporting side
  visuals use separated, lightly tinted elements and open space rather than
  a single filled text panel; retain a visible boundary where it explains containment.

## Verification

- Build both sites and inspect homepages and guides in both themes at mobile
  and desktop widths, including 320px reflow and reduced motion.
- Exercise search, empty results, keyboard-only navigation, walkthrough tabs,
  and Markdown copying; check browser errors and accessibility violations.
- Aim for WCAG AAA text contrast. Automated checks do not establish full WCAG
  conformance or comparative superiority; preserve their precise scope.

## Child DOX Index

- None.
