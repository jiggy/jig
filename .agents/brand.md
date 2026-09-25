# Brand identity

This guide owns the selected names and visual system for Jig and FLOW. It is
the reference for product marks and lockups, not a claim about trademark
availability or legal clearance.

## Product names

- **Jig** is the host and command-line product. Write the product name `Jig`
  and the installed command `jig`.
- **FLOW** is the independent, sibling standard. Write the standard `FLOW` and
  its package entrypoint `FLOW.md`; do not present it as a Jig feature.
- The ecosystem's primary home is `https://jig.md`.
- Publisher names, account handles, and registry scopes are distribution
  details, not product brands or parts of product wordmarks.
- Sley has a separate identity and is outside this Jig/FLOW brand system.

## Emblems and meaning

Jig and FLOW use the selected switch-shaped emblem geometry. Jig uses the
striped mark to express guided movement and controlled power; FLOW uses the
unstriped counterpart to express free movement. The stripe is not a warning,
an avoided route, or a road marking. Keep the two emblems distinct and preserve
their approved paths rather than redrawing them for individual placements.

Use monochrome marks: ink `#20242C` on light surfaces and paper `#F3F5F8` on
dark surfaces. Do not add a separate accent color to either emblem.

## Wordmarks and lockup

Use live text beside the emblem so the product name remains selectable,
accessible, and responsive:

- `Jig`: Quicksand SemiBold (600), with visible letter height about 78% of the
  emblem height and an emblem-to-word gap about 17% of the emblem height.
- `FLOW`: Quicksand Bold (700), with visible letter height about 67% of the
  emblem height and a gap about 22% of the emblem height.

These are the selected balanced proportions, measured in the studies at a
108-unit visible emblem height: Jig 84 units high with an 18-unit gap; FLOW 72
units high with a 24-unit gap. Preserve the difference between title-case Jig
and uppercase FLOW rather than forcing identical wordmark sizes.

Do not bake the wordmark into the emblem SVG. Pair the correct emblem with the
live product name and retain the same monochrome treatment in light and dark
themes. In the site header, treat the emblem as decorative and let the live
product name provide the link's accessible name.

## Assets and implementation

- `site/jig/public/mark.svg` and `mark-light.svg` are Jig's dark and light
  emblems; `favicon.svg` is its theme-aware browser icon.
- `site/flow/public/mark.svg`, `mark-light.svg`, and `favicon.svg` provide the
  corresponding unstriped FLOW assets.
- `site/jig/public/logo.svg` and `logo-light.svg`, and the matching files under
  `site/flow/public/`, are transparent standalone emblem-plus-wordmark SVG
  lockups. Their PNG counterparts are transparent 4× raster exports. Each SVG
  embeds the licensed Quicksand face needed to preserve the chosen wordmark
  when opened outside the sites. Use the ink `logo.svg` on light surfaces and
  the paper `logo-light.svg` on dark surfaces.
- `site/landing.css` owns shared wordmark font faces, size, color, and spacing.
  The site configurations supply each site's mark and live product name.
- `site/theme/fonts/quicksand-semibold.ttf` and `quicksand-bold.ttf` are the
  self-hosted wordmark fonts. Preserve `quicksand-LICENSE.txt` and the build's
  publication of font notices.

Use the emblem at small sizes only where its shape remains legible. Keep
favicon variants monochrome and theme-aware; do not introduce a separate
small-size logo concept without a new reviewed study.
