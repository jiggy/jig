# Public site theme

## Purpose

Make FLOW's capability compounding and Jig's agency understandable through a
shared reading experience.

## Ownership

- `index.tsx` extends the default layout with homepage composition, document
  context, and a direct Markdown resource link beside Rspress's copy action.
- `showcase.tsx` renders illustrative walkthroughs from homepage frontmatter;
  all stages remain in generated Markdown. It never executes product work.
- `search.tsx` uses Rspress's native local search with conditional mounting,
  modal semantics, keyboard controls, focus containment, and focus restoration.
- `navigation.tsx` presents the flat primary links in a native mobile disclosure
  with Escape dismissal and a theme control; configurations keep those links flat.
- `sidebar.tsx` gives native sidebar groups keyboard controls and expanded
  state, and removes collapsed links from the focus order.
- `tabs.tsx` adds keyboard tab semantics to native Rspress tabs while retaining
  language persistence and complete Markdown export.
- `llms.ts` orders generated page links using the same sidebar as human readers;
  unlisted public pages remain discoverable rather than silently disappearing.
- `fonts/` owns self-hosted Latin variable Manrope and JetBrains Mono fonts,
  taken unchanged from Fontsource packages 5.3.0. Their individual OFL notices
  are copied to each site's `/font-licenses/` directory during assembly.
- `accessible-markdown.ts` gives generated heading links accessible names and
  makes tables keyboard-focusable for horizontal scrolling.
- Public prose stays in `docs/`; shared presentation stays in `../landing.css`.

## Local Contracts

- Preserve default documentation navigation, search, and accessibility.
- Keep both sites independent; shared components contain no product prose.

## Work Guidance

- Prefer the default theme and small extensions over a copied theme.

## Verification

- Build both sites and inspect homepages and guides in both themes at mobile
  and desktop widths, including 320px reflow and reduced motion.
- Exercise search, empty results, keyboard-only navigation, walkthrough tabs,
  and Markdown copying; check browser errors and accessibility violations.
- Aim for WCAG AAA text contrast. Automated checks do not establish full WCAG
  conformance or comparative superiority; preserve their precise scope.

## Child DOX Index

- None.
