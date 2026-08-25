#!/bin/sh
set -eu

fail() {
  printf 'missing capability: %s\n' "$1" >&2
  exit 70
}

command -v sudo >/dev/null 2>&1 || fail "sudo"
sudo -n true || fail "non-interactive sudo"

test "$(stat -fc %T /sys/fs/cgroup 2>/dev/null)" = "cgroup2fs" || fail "cgroup v2"
mount_options=$(awk '$2 == "/sys/fs/cgroup" { print $4 }' /proc/mounts)
case ",$mount_options," in
  *,rw,*) ;;
  *) fail "writable cgroup-v2 mount" ;;
esac

self_relative=$(cut -d: -f3 /proc/self/cgroup)
self_cgroup=$(realpath "/sys/fs/cgroup${self_relative}")
scope=$(dirname "$self_cgroup")
test -r "$scope/cgroup.controllers" || fail "delegated cgroup scope"
test -z "$(cat "$scope/cgroup.procs")" || fail "empty delegated cgroup scope"

for controller in cpu memory pids; do
  grep -qw "$controller" "$scope/cgroup.controllers" || fail "$controller controller"
done

name="jig-phase2-preflight-$$-$(date +%s)"
parent="$scope/$name"
run="$parent/run"

cleanup() {
  if test -e "$run/cgroup.kill"; then
    sudo -n sh -c 'printf 1 > "$1"' sh "$run/cgroup.kill" 2>/dev/null || true
  fi
  sudo -n rmdir "$run" 2>/dev/null || true
  sudo -n rmdir "$parent" 2>/dev/null || true
}
trap cleanup EXIT INT TERM

sudo -n mkdir "$parent"
sudo -n sh -c 'printf "+cpu +memory +pids" > "$1"' sh "$parent/cgroup.subtree_control"
sudo -n mkdir "$run"
sudo -n sh -c 'printf 134217728 > "$1"' sh "$run/memory.max"
sudo -n sh -c 'printf 32 > "$1"' sh "$run/pids.max"
sudo -n sh -c 'printf "50000 100000" > "$1"' sh "$run/cpu.max"

for control in cpu.max memory.max pids.max cgroup.events cgroup.kill; do
  test -e "$run/$control" || fail "child $control"
done
grep -q '^populated 0$' "$run/cgroup.events" || fail "cgroup.events populated 0"

printf 'sudo=ok\n'
printf 'cgroup.mount=%s\n' "$mount_options"
printf 'cgroup.scope=%s\n' "$scope"
printf 'cgroup.controllers=%s\n' "$(tr '\n' ' ' < "$scope/cgroup.controllers")"
printf 'run.cpu.max=%s\n' "$(cat "$run/cpu.max")"
printf 'run.memory.max=%s\n' "$(cat "$run/memory.max")"
printf 'run.pids.max=%s\n' "$(cat "$run/pids.max")"
if test -c /dev/kvm && test -r /dev/kvm && test -w /dev/kvm; then
  printf 'optional.kvm=rw\n'
else
  printf 'optional.kvm=unavailable\n'
fi
if test -c /dev/net/tun && test -r /dev/net/tun && test -w /dev/net/tun; then
  printf 'optional.tun=rw\n'
else
  printf 'optional.tun=unavailable\n'
fi

cleanup
trap - EXIT INT TERM
test ! -e "$parent" || fail "Jig preflight cgroup cleanup"
printf 'cleanup=removed\n'
