set -euo pipefail

fail() {
  printf 'Jig delegated session: %s\n' "$1" >&2
  exit 1
}

(( $# >= 2 )) || fail 'expected a service name and the operator-selected session command'
unit=$1
shift

(( EUID != 0 )) || fail 'the session must run as an unprivileged user'
[[ $(stat -f -c %T /sys/fs/cgroup) == cgroup2fs ]] || fail 'cgroup v2 is required'
IFS= read -r membership < /proc/self/cgroup
[[ $membership == 0::/*/"$unit"/jig ]] || fail 'the process is outside the expected service subgroup'
leaf=/sys/fs/cgroup${membership#0::}
parent=${leaf%/jig}
[[ $(realpath -e -- "$leaf") == "$leaf" ]] || fail 'the cgroup path is not canonical'
[[ $(stat -c %u -- "$parent") == "$EUID" ]] ||
  fail 'the delegated parent is not owned by the service user'
[[ -z $(< "$parent/cgroup.procs") ]] || fail 'the delegated parent contains processes'

# Activate only the unit's own empty parent before starting the session.
shopt -s nullglob
children=("$parent"/*/)
[[ ${#children[@]} == 1 && ${children[0]} == "$leaf/" ]] ||
  fail 'the delegated parent already contains another subgroup'
printf '%s\n' '+cpu +memory +pids' > "$parent/cgroup.subtree_control" ||
  fail 'could not enable the delegated cpu, memory, and pids controllers'

exec "$@"
