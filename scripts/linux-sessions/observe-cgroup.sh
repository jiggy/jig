#!/usr/bin/env bash
set -euo pipefail

if (( $# != 2 )) || [[ $1 != running && $1 != settled ]] ||
  [[ $2 != /sys/fs/cgroup/*/* ]]; then
  printf 'Usage: bash %s {running|settled} /sys/fs/cgroup/.../session-leaf\n' "$0" >&2
  exit 2
fi

phase=$1
leaf=$2
[[ $(stat -fc %T /sys/fs/cgroup) == cgroup2fs &&
   $(realpath -e -- "$leaf") == "$leaf" && -r "$leaf/cgroup.events" ]] || {
  printf 'Expected a canonical cgroup v2 session directory at %s\n' "$leaf" >&2
  exit 1
}
parent=${leaf%/*}
shopt -s nullglob
running=()
residue=()
for child in "$parent"/*/; do
  [[ $child == "$leaf/" ]] && continue
  residue+=("$child")
  if [[ -r $child/cgroup.events ]] && grep -Fxq 'populated 1' "$child/cgroup.events"; then
    running+=("$child")
  fi
done

case $phase in
  running)
    if (( ${#running[@]} == 1 && ${#residue[@]} == 1 )); then
      printf '%s\n' "${running[0]}"
      exit 0
    fi
    ;;
  settled)
    if (( ${#residue[@]} == 0 )); then
      printf '%s has no execution subgroups\n' "$parent"
      exit 0
    fi
    ;;
esac
printf '%s: expected %s, found %s populated execution groups and %s execution directories\n' \
  "$parent" "$phase" "${#running[@]}" "${#residue[@]}" >&2
exit 1
