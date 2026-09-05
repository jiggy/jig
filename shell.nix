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
    pkgs.just
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
    jig_repository=${pkgs.lib.escapeShellArg (toString ./.)}
    export PATH="$jig_repository/packages/jig/bin:$PATH"
    if [ ! -x "$jig_repository/packages/jig/bin/jig" ] ||
       [ ! -f "$jig_repository/packages/jig/libexec/installed-cli.js" ]; then
      printf '\033[1;31m%s\033[0m\n' 'Jig is not built (or its build is incomplete). From the repository root, run: bun i && just jig::build' >&2
    elif ! jig_built_version=$("$jig_repository/packages/jig/bin/jig" --version 2>/dev/null); then
      printf '\033[1;31m%s\033[0m\n' 'Jig could not report its built version. From the repository root, run: bun i && just jig::build' >&2
    else
      jig_expected_version=$(jq -r .version "$jig_repository/packages/jig/package.json")
      if [ "$jig_built_version" != "$jig_expected_version" ]; then
        printf '\033[1;31mJig build version %s does not match package.json version %s. From the repository root, run: just jig::build\033[0m\n' "$jig_built_version" "$jig_expected_version" >&2
      fi
    fi
    unset jig_repository jig_expected_version jig_built_version
  '';
}
