# Security

Jig's direct-run alpha treats admitted project and FLOW package code as
untrusted. Its supported Linux host runs project evaluation, dependency
preparation, and Flow execution inside one rootless cgroup-v2 and Bubblewrap
boundary. There is no privileged or weaker fallback.

## What the boundary protects

An admitted Flow receives only its exact execution package, fixed runtime
support, private scratch space, private process and network namespaces, and
the Run/1 channel. It does not receive the project tree, host environment,
ambient `PATH`, host process tree, host network, writable cgroup controls,
general host devices, inherited descriptors, or Jig's control channel.

Jig applies aggregate CPU, memory, and process limits before package code can
execute. Every terminal path fences the complete process tree and removes its
rootless owner state before reporting completion.

Project evaluation and the fixed dependency installer use the same boundary.
Only the trusted installer may inherit networking, solely during `jig check`;
lifecycle scripts are disabled and the later Flow Run remains offline.

## Supported trust boundary

The alpha does not defend against:

- compromise of the Linux kernel, systemd, Bubblewrap, cgroup v2, or Jig's
  fixed Bun runtime and trusted support files;
- the host administrator or another malicious process running as the same
  operating-system user;
- physical access or compromise outside the supported host; or
- denial of service within the documented resource ceilings or through
  storage retained by an explicitly approved project.

An unsupported host or missing containment capability fails closed. Do not
replace cgroup-v2 ownership with `ulimit`, per-process accounting,
process-group killing, or `/proc` polling; those mechanisms do not enforce the
same descendant and cleanup boundary.

## Fixed alpha ceilings

| Operation | Wall clock | Aggregate memory | Aggregate PIDs | CPU quota |
| --- | ---: | ---: | ---: | ---: |
| Flow Run | 30 seconds | 256 MiB | 48 | 50% of one CPU |
| Project evaluation | 3 seconds | 256 MiB | 64 | 50% of one CPU |
| Locked dependency preparation | 60 seconds | 512 MiB | 64 | one CPU |

These limits are fixed in this alpha and are not project configuration.

## Reporting a vulnerability

Do not open a public issue for a suspected vulnerability. Report it through
[GitHub's private vulnerability form](https://github.com/jigmd/jig/security/advisories/new).
Include the affected version, supported-host details, reproduction steps, and
the observed security impact. Never include secrets or third-party data.
