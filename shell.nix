{
  # This revision supplies the Bun 1.3.3 required by Jig's build.
  pkgs ? import (builtins.fetchTarball {
    url = "https://github.com/NixOS/nixpkgs/archive/2f5cde3125a022b349324aae7e15a35622723cb8.tar.gz";
  }) { },
}:
let
  python = pkgs.python3.withPackages (p: [ p.build p.setuptools p.wheel ]);
  # The pinned toolchain predates Bubblewrap's required namespace controls.
  bubblewrap = pkgs.bubblewrap.overrideAttrs (old: {
    version = "0.12.0";
    src = pkgs.fetchurl {
      url = "https://github.com/containers/bubblewrap/releases/download/v0.12.0/bubblewrap-0.12.0.tar.xz";
      hash = "sha256-l2DQBzY+Orunx0dImRD5+C2fylO6O9MoLjlvo8l6MxQ=";
    };
    meta = old.meta // {
      changelog = "https://github.com/containers/bubblewrap/releases/tag/v0.12.0";
    };
  });
in
assert pkgs.bun.version == "1.3.3";
pkgs.mkShellNoCC {
  packages = [
    pkgs.bun
    pkgs.nodejs_24
    python
    pkgs.git
    pkgs.curl
    pkgs.jq
    pkgs.ripgrep
    pkgs.coreutils
    bubblewrap
  ];

  FLOW_NODE = "${pkgs.nodejs_24}/bin/node";
  FLOW_NPM = "${pkgs.nodejs_24}/bin/npm";
  JIG_NPM = "${pkgs.nodejs_24}/bin/npm";
  PYTHON = "${python}/bin/python3";
  JIG_BWRAP_PATH = "${bubblewrap}/bin/bwrap";

  shellHook = ''
    if [ ! -d packages/jig/node_modules ]; then
      printf '%s\n' 'Jig dependencies are missing. Run: bun install --cwd packages/jig --frozen-lockfile --ignore-scripts' >&2
    fi
    if [ ! -x packages/jig/bin/jig ] || [ ! -f packages/jig/libexec/installed-cli.js ]; then
      printf '%s\n' 'Jig has not been built. After installing dependencies, run: bun run --cwd packages/jig build' >&2
    fi
  '';
}
