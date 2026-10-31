# Public site theme

## Purpose

Make FLOW's capability compounding and Jig's agency understandable through a
shared reading experience.

## Ownership

- `index.tsx` extends the documentation layout with context, an accessible brand
  title, and a direct Markdown resource link beside Rspress's copy action.
  Production client-side home navigation reloads the current URL to load the
  standalone landing page. Markdown generation and development retain the
  semantic homepage content.
- `brand-title.tsx` composes the theme-selected decorative emblem with the live
  product name, which provides the navigation link's accessible name.
- `search.tsx` uses Rspress's native local search with conditional mounting,
  modal semantics, keyboard controls, focus containment, and focus restoration.
- `navigation.tsx` presents the flat primary links in a native mobile disclosure
  with Escape dismissal and a theme control. Configurations keep those links
  flat.
- `appearance.tsx` supplies a native theme button, retaining keyboard focus
  inside the mobile navigation so Escape can dismiss it after a theme change.
- `sidebar.tsx` gives native sidebar groups keyboard controls and expanded
  state, and removes collapsed links from the focus order.
- `tabs.tsx` adds keyboard tab semantics to native Rspress tabs while retaining
  language persistence and complete Markdown export.
- `code-themes.ts` retains the One Light and One Dark Pro palettes with native
  Shiki color replacements targeting 7:1 text contrast against their code
  backgrounds.
- `llms.ts` orders generated page links using the same sidebar as human readers.
  Unlisted public pages remain discoverable rather than silently disappearing.
- `fonts/` owns self-hosted Latin variable Manrope and JetBrains Mono fonts,
  taken unchanged from Fontsource packages 5.3.0. It also owns Quicksand
  SemiBold and Bold for the Jig and FLOW wordmarks. Their individual OFL notices
  are copied to each site's `/font-licenses/` directory during assembly.
- `landing.css` composes each site's emblem with its live product wordmark in
  the balanced monochrome lockup.
- `accessible-markdown.ts` gives generated heading links accessible names and
  makes tables keyboard-focusable for horizontal scrolling.
- `diagram-images.ts` and `diagram-theme-loader.cjs` generate fixed light/dark
  variants of local Archify SVGs during HTML builds. Site appearance selects the
  visible image. Native zoom and the original Markdown image remain intact. This
  avoids relying on WebKit inheriting color schemes inside SVG images.
- Documentation prose and the semantic homepage companion stay in `docs/`.
  Shared documentation presentation stays in `../landing.css`.
  The standalone landing page belongs to `../../docs/jig/index.html`.
  Its static assets belong to `../jig/public/landing/`.

## Local Contracts

- Preserve default documentation navigation, search, and accessibility.
- Keep the shared nav lockup monochrome and balanced. Pair the Jig striped mark
  with Quicksand SemiBold `jig`. Pair the FLOW unstriped mark with Quicksand
  Bold `FLOW`. Keep the accessible product names as live text. Do not duplicate
  them inside the image assets.
- Keep both sites independent. Shared components contain no product prose.

## Work Guidance

- Prefer the default theme and small extensions over a copied theme.
- Landing pages move from an early interactive demonstration to product-specific
  structure and one first-use path. Keep implementation details in disclosures,
  resource routing compact, and motion brief, optional, and reduced-motion
  aware.

## Verification

- Build this repository's site and inspect homepages and guides in both themes at mobile and
  desktop widths, including 320px reflow and reduced motion.
- Exercise search, empty results, keyboard-only navigation, walkthrough tabs,
  and Markdown copying. Check browser errors and accessibility violations.
- Aim for WCAG AAA text contrast. Automated checks do not establish full WCAG
  conformance or comparative superiority. Preserve their precise scope.

## Child DOX Index

- None.
