{ config, lib, pkgs, utils, ... }:
let
  sessions = config.jig.agentSessions;
  enterSession = pkgs.writeShellScript "jig-enter-agent-session" (builtins.readFile ./enter-session.sh);
in
{
  options.jig.agentSessions = lib.mkOption {
    default = { };
    description = "Operator-started Jig agent sessions with one delegated cgroup subtree per worktree.";
    type = lib.types.attrsOf (lib.types.submodule {
      options = {
        user = lib.mkOption {
          type = lib.types.str;
          description = "Dedicated unprivileged runner account for this session.";
        };
        worktree = lib.mkOption {
          type = lib.types.path;
          description = "Absolute path to the worktree.";
        };
        command = lib.mkOption {
          type = lib.types.nonEmptyListOf lib.types.str;
          description = "Absolute executable and arguments for the existing agent sandbox.";
        };
      };
    });
  };

  config = lib.mkIf (sessions != { }) {
    programs.nix-ld.enable = true;
    environment.systemPackages = [ pkgs.coreutils ];

    assertions = lib.mapAttrsToList (name: session: {
      assertion =
        builtins.match "[a-z0-9][a-z0-9-]{0,47}" name != null
        && session.user != ""
        && session.user != "root"
        && lib.hasPrefix "/" (builtins.head session.command);
      message = "Jig agent session ${name} requires a simple unit name, an unprivileged user, and an absolute executable.";
    }) sessions ++ [
      {
        assertion = lib.versionAtLeast config.systemd.package.version "254";
        message = "Jig agent sessions require systemd 254 or newer for DelegateSubgroup.";
      }
      {
        assertion = lib.length (lib.unique (lib.mapAttrsToList (_: session: toString session.worktree) sessions))
          == lib.length (lib.attrNames sessions);
        message = "Each Jig agent session requires its own worktree.";
      }
    ];

    systemd.services = lib.mapAttrs' (name: session:
      let
        unit = "jig-agent-${name}";
      in
      lib.nameValuePair unit {
        description = "Jig agent session ${name}";
        environment.JIG_BWRAP_PATH = lib.getExe pkgs.bubblewrap;
        serviceConfig = {
          Type = "exec";
          User = session.user;
          WorkingDirectory = toString session.worktree;
          Delegate = "cpu memory pids";
          DelegateSubgroup = "jig";
          KillMode = "control-group";
          ExecStart = utils.escapeSystemdExecArgs ([ enterSession "${unit}.service" ] ++ session.command);
        };
      }) sessions;
  };
}
