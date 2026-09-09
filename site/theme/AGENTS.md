# Public site theme

## Purpose

Make FLOW's capability compounding and Jig's agency understandable through a
shared reading experience.

## Ownership

- `index.tsx` supplies a semantic homepage hero and renders homepage Markdown
  through the default documentation components. Native link Enter activation
  stays local so Rspress 2.0.21’s closed search does not consume it.
- `accessible-markdown.ts` gives generated heading links accessible names and
  makes tables keyboard-focusable for horizontal scrolling.
- Public prose stays in `docs/`; shared presentation stays in `../landing.css`.

## Local Contracts

- Preserve default documentation navigation, search, and accessibility.
- Keep both sites independent; shared components contain no product prose.

## Work Guidance

- Prefer the default theme and small extensions over a copied theme.

## Verification

- Build both sites and inspect homepages in both themes at mobile and desktop widths.

## Child DOX Index

- None.
