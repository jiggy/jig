#!/usr/bin/env bash
set -euo pipefail

if (( $# != 2 )) || [[ $1 != running && $1 != settled ]] ||
  [[ ! $2 =~ ^jig-agent-[a-z0-9][a-z0-9-]{0,47}\.service$ ]]; then
  printf 'Usage: bash %s {running|settled} jig-agent-NAME.service\n' "$0" >&2
  exit 2
fi

phase=$1
unit=$2
relative=$(systemctl show --property=ControlGroup --value "$unit")
[[ $relative == /*/"$unit" ]] || {
  printf 'No active cgroup for %s\n' "$unit" >&2
  exit 1
}
parent=/sys/fs/cgroup$relative
[[ -d $parent/jig ]] || exit 1
shopt -s nullglob
running=()
residue=()
for child in "$parent"/*/; do
  [[ $child == "$parent/jig/" ]] && continue
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
      printf '%s has no execution subgroups\n' "$unit"
      exit 0
    fi
    ;;
esac
printf '%s: expected %s, found %s populated execution groups and %s execution directories\n' \
  "$unit" "$phase" "${#running[@]}" "${#residue[@]}" >&2
exit 1
