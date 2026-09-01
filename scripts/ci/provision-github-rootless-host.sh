#!/bin/sh

# Prepare and verify one ephemeral GitHub-hosted Ubuntu runner for Jig's
# rootless Linux conformance tests. Privilege is confined to provisioning this
# disposable host; Jig and FLOW package code continue to run unprivileged.

set -eu

BUBBLEWRAP_VERSION=0.12.0
BUBBLEWRAP_SHA256=9760d007363e3abba7c747489910f9f82d9fca53ba3bd3282e396fa3c97a3314
BUBBLEWRAP_URL=https://github.com/containers/bubblewrap/releases/download/v0.12.0/bubblewrap-0.12.0.tar.xz
CGROUP_ROOT=/sys/fs/cgroup
REQUIRED_CONTROLLERS="cpu memory pids"

provision() {
  [ "${GITHUB_ACTIONS:-}" = true ] || fail "provisioning is restricted to GitHub Actions"
  [ "${RUNNER_OS:-}" = Linux ] || fail "the runner is not Linux"
  [ "${ImageOS:-}" = ubuntu24 ] || fail "the runner is not the pinned Ubuntu 24.04 image"
  [ "$(id -u)" -ne 0 ] || fail "the conformance process must be unprivileged"
  command -v sudo >/dev/null 2>&1 || fail "the ephemeral runner has no sudo provisioning boundary"
  sudo -n true || fail "the ephemeral runner cannot provision its host noninteractively"

  sudo -n apt-get -q update
  sudo -n apt-get -q -y install \
    build-essential \
    ca-certificates \
    curl \
    libcap-dev \
    libcap2-bin \
    meson \
    ninja-build \
    pkg-config \
    xz-utils

  work=$(mktemp -d "${RUNNER_TEMP:-/tmp}/jig-bubblewrap.XXXXXX")
  case $work in
    "${RUNNER_TEMP:-/tmp}"/jig-bubblewrap.*) ;;
    *) fail "mktemp returned an unexpected Bubblewrap build path" ;;
  esac
  trap 'rm -rf -- "$work"' EXIT HUP INT TERM

  curl --fail --location --proto '=https' --tlsv1.2 \
    --output "$work/bubblewrap.tar.xz" "$BUBBLEWRAP_URL"
  printf '%s  %s\n' "$BUBBLEWRAP_SHA256" "$work/bubblewrap.tar.xz" |
    sha256sum --check --strict -
  tar -xJf "$work/bubblewrap.tar.xz" -C "$work"

  meson setup "$work/build" "$work/bubblewrap-$BUBBLEWRAP_VERSION" \
    --buildtype=release \
    --prefix=/usr \
    -Dbash_completion=disabled \
    -Dman=disabled \
    -Dselinux=disabled \
    -Dtests=false \
    -Dzsh_completion=disabled
  meson compile -C "$work/build"
  [ "$("$work/build/bwrap" --version)" = "bubblewrap $BUBBLEWRAP_VERSION" ] ||
    fail "the source build did not produce exact Bubblewrap $BUBBLEWRAP_VERSION"
  sudo -n install -o root -g root -m 0755 "$work/build/bwrap" /usr/bin/bwrap
  verify_bubblewrap

  # Ubuntu's AppArmor restriction is the reason Bubblewrap upstream performs
  # the same change in its GitHub Actions jobs. This affects only the
  # disposable conformance VM and grants no authority to Jig or package code.
  if [ -e /proc/sys/kernel/apparmor_restrict_unprivileged_userns ]; then
    sudo -n sysctl -q -w kernel.apparmor_restrict_unprivileged_userns=0
  fi
  if [ -e /proc/sys/kernel/unprivileged_userns_clone ]; then
    sudo -n sysctl -q -w kernel.unprivileged_userns_clone=1
  fi
  [ "$(cat /proc/sys/user/max_user_namespaces)" -gt 0 ] ||
    fail "the runner disables unprivileged user namespaces"

  uid=$(id -u)
  user=$(id -un)
  sudo -n loginctl enable-linger "$user"
  sudo -n systemctl start "user@$uid.service"

  runtime=/run/user/$uid
  deadline=50
  while [ ! -S "$runtime/bus" ]; do
    [ "$deadline" -gt 0 ] || fail "the unprivileged systemd user bus did not become ready"
    sleep 0.1
    deadline=$((deadline - 1))
  done
  [ "$(stat -c %u "$runtime")" = "$uid" ] || fail "the user runtime directory has the wrong owner"
  export XDG_RUNTIME_DIR="$runtime"
  export DBUS_SESSION_BUS_ADDRESS="unix:path=$runtime/bus"
  systemctl --user show-environment >/dev/null || fail "the unprivileged user manager is unavailable"

  if [ -n "${GITHUB_ENV:-}" ]; then
    {
      printf 'XDG_RUNTIME_DIR=%s\n' "$XDG_RUNTIME_DIR"
      printf 'DBUS_SESSION_BUS_ADDRESS=%s\n' "$DBUS_SESSION_BUS_ADDRESS"
    } >> "$GITHUB_ENV"
  fi

  [ "$(stat -fc %T "$CGROUP_ROOT")" = cgroup2fs ] || fail "cgroup v2 is unavailable"
  require_controllers "$CGROUP_ROOT/cgroup.controllers"
  run_delegated /bin/true
  run_acquisition_host /bin/true
  verify_namespaces

  printf '%s\n' "GitHub rootless host preflight passed"
}

verify_bubblewrap() {
  [ -f /usr/bin/bwrap ] || fail "/usr/bin/bwrap is not a regular file"
  [ ! -L /usr/bin/bwrap ] || fail "/usr/bin/bwrap must not be a symlink"
  [ "$(stat -c '%u:%g:%a' /usr/bin/bwrap)" = 0:0:755 ] ||
    fail "/usr/bin/bwrap is not root-owned mode 0755"
  [ -z "$(getcap /usr/bin/bwrap)" ] || fail "/usr/bin/bwrap has file capabilities"
  [ "$(/usr/bin/bwrap --version)" = "bubblewrap $BUBBLEWRAP_VERSION" ] ||
    fail "/usr/bin/bwrap is not exact Bubblewrap $BUBBLEWRAP_VERSION"
}

verify_namespaces() {
  /usr/bin/bwrap \
    --unshare-all \
    --unshare-user \
    --die-with-parent \
    --new-session \
    --ro-bind / / \
    --proc /proc \
    --dev /dev \
    --disable-userns \
    --assert-userns-disabled \
    -- /usr/bin/true || fail "the required unprivileged namespace envelope is unavailable"
}

run_delegated() {
  manager=$(fixed_executable /usr/bin/systemd-run /bin/systemd-run) ||
    fail "systemd-run is unavailable"
  self=$(canonical_self)
  execution_path=$(ci_execution_path) || fail "the exact CI Bun executable is unavailable"
  unit="jigci-delegated-$(random_hex 12).service"
  # A GitHub runner is a system service outside the new user's cgroup tree, so
  # the user manager must spawn this process. systemd 254+ places it directly
  # in the leaf subgroup without an attach-after-start migration.
  "$manager" \
    --user \
    --wait \
    --collect \
    --quiet \
    --pipe \
    --service-type=exec \
    --same-dir \
    --setenv=PATH="$execution_path" \
    --setenv=XDG_RUNTIME_DIR="$XDG_RUNTIME_DIR" \
    --setenv=DBUS_SESSION_BUS_ADDRESS="$DBUS_SESSION_BUS_ADDRESS" \
    --property="Delegate=cpu memory pids" \
    --property=DelegateSubgroup=jig \
    --unit="$unit" \
    -- "$self" enter-delegated "$@"
}

enter_delegated() {
  [ "$(id -u)" -ne 0 ] || fail "delegated conformance must remain unprivileged"
  relative=
  while IFS=: read -r hierarchy controllers path; do
    if [ "$hierarchy" = 0 ] && [ -z "$controllers" ]; then
      relative=$path
    fi
  done < /proc/self/cgroup
  case $relative in
    /*/jigci-delegated-*.service/jig) ;;
    *) fail "the command did not enter its exact delegated service subgroup" ;;
  esac
  child=$CGROUP_ROOT$relative
  scope=${child%/jig}
  [ "$(readlink -f "$child")" = "$child" ] || fail "the delegated child cgroup is not canonical"
  [ "$(readlink -f "$scope")" = "$scope" ] || fail "the delegated parent cgroup is not canonical"
  [ "$(stat -c %u "$scope")" = "$(id -u)" ] || fail "the delegated cgroup has the wrong owner"
  [ -w "$scope/cgroup.procs" ] || fail "the delegated cgroup process set is not writable"
  [ -w "$scope/cgroup.subtree_control" ] || fail "the delegated subtree controls are not writable"
  [ -w "$scope/cgroup.kill" ] || fail "the delegated cgroup cannot be killed as one tree"
  [ -z "$(cat "$scope/cgroup.procs")" ] || fail "the delegated parent cgroup is populated"
  require_controllers "$scope/cgroup.controllers"
  children=$(find "$scope" -mindepth 1 -maxdepth 1 -type d -printf '%f\n')
  [ "$children" = jig ] || fail "the delegated parent is not exclusive to the jig subgroup"

  # Delegate= makes the controllers available to the unit, but systemd leaves
  # activation inside the delegated unit to its unprivileged owner. Complete
  # that host-side delegation only after proving this is our exclusive cgroup.
  printf '%s\n' '+cpu +memory +pids' > "$scope/cgroup.subtree_control"
  require_controllers "$scope/cgroup.subtree_control"

  for control in cpu.max memory.max pids.max cgroup.events cgroup.kill; do
    [ -e "$child/$control" ] || fail "the delegated child lacks $control"
  done
  for control in cpu.max memory.max pids.max cgroup.kill; do
    [ -w "$child/$control" ] || fail "the delegated child cannot write $control"
  done
  [ -r "$child/cgroup.events" ] || fail "the delegated child cannot read cgroup.events"

  export AGENT_DELEGATED_CGROUP="$scope"
  exec "$@"
}

run_acquisition_host() {
  manager=$(fixed_executable /usr/bin/systemd-run /bin/systemd-run) ||
    fail "systemd-run is unavailable"
  self=$(canonical_self)
  execution_path=$(ci_execution_path) || fail "the exact CI Bun executable is unavailable"
  unit="jigci-acquisition-$(random_hex 12).service"
  # Keep this transport deliberately short of Jig's exact inherited contract.
  # The installed command must therefore exercise its own transient scope
  # acquisition instead of taking the inherited-delegation fast path.
  "$manager" \
    --user \
    --wait \
    --collect \
    --quiet \
    --pipe \
    --service-type=exec \
    --same-dir \
    --setenv=PATH="$execution_path" \
    --setenv=XDG_RUNTIME_DIR="$XDG_RUNTIME_DIR" \
    --setenv=DBUS_SESSION_BUS_ADDRESS="$DBUS_SESSION_BUS_ADDRESS" \
    --property=Delegate=pids \
    --property=DelegateSubgroup=transport \
    --unit="$unit" \
    -- "$self" enter-acquisition-host "$@"
}

enter_acquisition_host() {
  [ "$(id -u)" -ne 0 ] || fail "rootless acquisition conformance must remain unprivileged"
  relative=
  while IFS=: read -r hierarchy controllers path; do
    if [ "$hierarchy" = 0 ] && [ -z "$controllers" ]; then
      relative=$path
    fi
  done < /proc/self/cgroup
  case $relative in
    /*/jigci-acquisition-*.service/transport) ;;
    *) fail "the command did not enter its exact acquisition transport subgroup" ;;
  esac
  service=${CGROUP_ROOT}${relative%/transport}
  if has_required_controllers "$service/cgroup.subtree_control"; then
    fail "the acquisition transport unexpectedly satisfies the inherited delegation contract"
  fi
  exec "$@"
}

assert_clean() {
  uid=$(id -u)
  user_slice=$CGROUP_ROOT/user.slice/user-$uid.slice/user@$uid.service
  deadline=100
  while :; do
    units=$(systemctl --user list-units --all --plain --no-legend \
      'jig-*' 'jigci-*' 2>/dev/null || true)
    cgroups=
    if [ -d "$user_slice" ]; then
      cgroups=$(find "$user_slice" -type d \
        \( -name 'jig-*' -o -name 'jigci-*' \) -print 2>/dev/null || true)
    fi
    temporary=$(find "${TMPDIR:-/tmp}" -maxdepth 1 \
      \( -name 'jig-rootless-*' -o -name 'jig-operational-baseline-*' \) -print 2>/dev/null || true)
    if [ -z "$units" ] && [ -z "$cgroups" ] && [ -z "$temporary" ]; then
      printf '%s\n' "GitHub rootless host residue check passed"
      return 0
    fi
    [ "$deadline" -gt 0 ] || break
    sleep 0.1
    deadline=$((deadline - 1))
  done

  [ -z "$units" ] || printf '%s\n' "$units" >&2
  [ -z "$cgroups" ] || printf '%s\n' "$cgroups" >&2
  [ -z "$temporary" ] || printf '%s\n' "$temporary" >&2
  fail "Jig execution residue remained"
}

has_required_controllers() {
  values=$(cat "$1")
  for controller in $REQUIRED_CONTROLLERS; do
    case " $values " in
      *" $controller "*) ;;
      *) return 1 ;;
    esac
  done
  return 0
}

require_controllers() {
  values=$(cat "$1")
  for controller in $REQUIRED_CONTROLLERS; do
    case " $values " in
      *" $controller "*) ;;
      *) fail "the cgroup subtree lacks the $controller controller" ;;
    esac
  done
}

fixed_executable() {
  for candidate in "$@"; do
    resolved=$(readlink -f "$candidate" 2>/dev/null || true)
    if [ -n "$resolved" ] && [ -f "$resolved" ] && [ -x "$resolved" ]; then
      printf '%s\n' "$resolved"
      return 0
    fi
  done
  return 1
}

ci_execution_path() {
  bun=$(fixed_executable "${JIG_CI_BUN:-}") || return 1
  [ "$bun" = "$JIG_CI_BUN" ] || return 1
  printf '%s\n' "${bun%/*}:/usr/bin:/bin"
}

canonical_self() {
  case $0 in
    /*) candidate=$0 ;;
    *) candidate=$PWD/$0 ;;
  esac
  resolved=$(readlink -f "$candidate")
  [ -f "$resolved" ] && [ -x "$resolved" ] || fail "the conformance helper is not executable"
  printf '%s\n' "$resolved"
}

random_hex() {
  od -An -N "$1" -tx1 /dev/urandom | tr -d ' \n'
}

fail() {
  printf '%s\n' "GitHub rootless host unavailable: $*" >&2
  exit 1
}

case ${1:-provision} in
  provision)
    provision
    ;;
  run-delegated)
    shift
    [ "$#" -gt 0 ] || fail "run-delegated requires a command"
    run_delegated "$@"
    ;;
  enter-delegated)
    shift
    [ "$#" -gt 0 ] || fail "enter-delegated requires a command"
    enter_delegated "$@"
    ;;
  run-acquisition-host)
    shift
    [ "$#" -gt 0 ] || fail "run-acquisition-host requires a command"
    run_acquisition_host "$@"
    ;;
  enter-acquisition-host)
    shift
    [ "$#" -gt 0 ] || fail "enter-acquisition-host requires a command"
    enter_acquisition_host "$@"
    ;;
  assert-clean)
    assert_clean
    ;;
  *)
    fail "unknown command: $1"
    ;;
esac
