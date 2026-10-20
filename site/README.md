# Jig public site

This repository owns https://jig.md.
`docs/jig/` owns content. `site/jig/` owns publication configuration and assets.

```sh
bun install --cwd site --frozen-lockfile --ignore-scripts
scripts/build-site.sh jig .tmp/jig-site
```

The repository's Pages workflow builds and deploys the exact pushed revision.
FLOW deploys from its own repository. The separate `jiggy/jig-site` deployment repository is no longer required.
Site theme and fonts have independent copies in FLOW. Review shared presentation changes for both products.
