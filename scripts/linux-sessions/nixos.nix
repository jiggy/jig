{ config, lib, pkgs, utils, ... }:
let
  sessions = config.jig.delegatedSessions;
  enterSession = pkgs.writeShellScript "jig-enter-systemd-session" (builtins.readFile ./enter-systemd-session.sh);
in
{
  options.jig.delegatedSessions = lib.mkOption {
    default = { };
    description = "Operator-started Linux sessions with independent cgroup delegation for Jig.";
    type = lib.types.attrsOf (lib.types.submodule {
      options = {
        user = lib.mkOption {
          type = lib.types.str;
          description = "Unprivileged account that owns this session.";
        };
        workingDirectory = lib.mkOption {
          type = lib.types.path;
          description = "Absolute initial working directory of the session.";
        };
        command = lib.mkOption {
          type = lib.types.nonEmptyListOf lib.types.str;
          description = "Absolute executable and arguments for the foreground session.";
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
      message = "Jig session ${name} requires a simple unit name, an unprivileged user, and an absolute executable.";
    }) sessions ++ [
      {
        assertion = lib.versionAtLeast config.systemd.package.version "254";
        message = "Jig sessions require systemd 254 or newer for DelegateSubgroup.";
      }
    ];

    systemd.services = lib.mapAttrs' (name: session:
      let
        unit = "jig-session-${name}";
      in
      lib.nameValuePair unit {
        description = "Jig delegated session ${name}";
        environment.JIG_BWRAP_PATH = lib.getExe pkgs.bubblewrap;
        serviceConfig = {
          Type = "exec";
          User = session.user;
          WorkingDirectory = toString session.workingDirectory;
          Delegate = "cpu memory pids";
          DelegateSubgroup = "jig";
          KillMode = "control-group";
          ExecStart = utils.escapeSystemdExecArgs ([ enterSession "${unit}.service" ] ++ session.command);
        };
      }) sessions;
  };
}
