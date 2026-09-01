import { join } from "node:path";

import type { PrivateInstalledBunLocation } from "../../src/internal/installed-bun-support.js";

export const installedBunLocation: PrivateInstalledBunLocation = Object.freeze({
  releaseRoot: join(import.meta.dir, "..", ".."),
  executablePath: join(
    import.meta.dir,
    "..",
    "..",
    "node_modules",
    "@oven",
    "bun-linux-x64-baseline",
    "bin",
    "bun",
  ),
  installedCliPath: join(import.meta.dir, "..", "..", "libexec", "installed-cli.js"),
});
