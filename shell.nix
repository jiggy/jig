{
  # Keep the current host tools, including Bubblewrap 0.12.0.
  pkgs ? import (builtins.fetchTarball {
    url = "https://github.com/NixOS/nixpkgs/archive/9bb52223f4f6a0cc606fd0852d8784f896c137d5.tar.gz";
    sha256 = "sha256-2Cxxgpz1+cRgKZJFi12/9LG3aIBN66f2RvFs34Oj/A0=";
  }) { },
}:
let
  bun = pkgs.bun.overrideAttrs (old: rec {
    version = "1.4.4";
    passthru = (old.passthru or { }) // {
      sources = {
        "aarch64-darwin" = pkgs.fetchurl {
          url = "https://github.com/oven-sh/bun/releases/download/bun-v${version}/bun-darwin-aarch64.zip";
          hash = "sha256-wkDX8My5DCY6hJ/NsJt+5iYw2SE0jtaq/ahrnVd7xRA=";
        };
        "aarch64-linux" = pkgs.fetchurl {
          url = "https://github.com/oven-sh/bun/releases/download/bun-v${version}/bun-linux-aarch64.zip";
          hash = "sha256-uqa7NvUdblhWHgK76oJQOKnfRU9nPW13bou/hvjHhQ4=";
        };
        "x86_64-darwin" = pkgs.fetchurl {
          url = "https://github.com/oven-sh/bun/releases/download/bun-v${version}/bun-darwin-x64-baseline.zip";
          hash = "sha256-1KFVrfv9CRVes7oFyeOlRPOSl9emhhbTx3WfZ6tcR9w=";
        };
        "x86_64-linux" = pkgs.fetchurl {
          url = "https://github.com/oven-sh/bun/releases/download/bun-v${version}/bun-linux-x64-baseline.zip";
          hash = "sha256-4ERutVmVdy65iUvrrppr42jZhai5Jx7hJEhvmUbu3XY=";
        };
      };
    };
    src = passthru.sources.${pkgs.stdenvNoCC.hostPlatform.system}
      or (throw "Unsupported system: ${pkgs.stdenvNoCC.hostPlatform.system}");
  });
  python = pkgs.python3.withPackages (p: [ p.build p.setuptools p.wheel ]);
in
assert bun.version == "1.4.4";
pkgs.mkShellNoCC {
  packages = [
    bun
    pkgs.just
    pkgs.nodejs_24
    python
    pkgs.git
    pkgs.curl
    pkgs.jq
    pkgs.ripgrep
    pkgs.coreutils
    pkgs.bubblewrap
  ];

  FLOW_NODE = "${pkgs.nodejs_24}/bin/node";
  FLOW_NPM = "${pkgs.nodejs_24}/bin/npm";
  JIG_NPM = "${pkgs.nodejs_24}/bin/npm";
  PYTHON = "${python}/bin/python3";
  JIG_BWRAP_PATH = "${pkgs.bubblewrap}/bin/bwrap";
  JIG_AUTHORING_NODE_PATH = "${pkgs.nodejs_24}/bin/node";

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
