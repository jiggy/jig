#!/bin/sh

set -eu

fail() {
  if [ -t 2 ] && [ "${TERM:-}" != dumb ] && [ "${NO_COLOR+x}" != x ]; then
    printf '\033[1;31m%s\033[0m\n' 'Error: Jig could not start' >&2
  else
    printf '%s\n' 'Error: Jig could not start' >&2
  fi
  printf '%s\n' '' '  The installed Jig runtime is unavailable.' '' \
    '  Next step: Restore the complete Jig installation.' \
    '  See https://jig.md/guide/#install.' '' \
    '  Diagnostic code: JIG_COMMAND_UNAVAILABLE' >&2
  exit 2
}

case $0 in
  *'
'*) fail ;;
esac

if [ -x /usr/bin/readlink ]; then
  readlink_command=/usr/bin/readlink
elif [ -x /bin/readlink ]; then
  readlink_command=/bin/readlink
elif [ -x /run/current-system/sw/bin/readlink ]; then
  readlink_command=/run/current-system/sw/bin/readlink
else
  fail
fi

if [ -x /usr/bin/uname ]; then
  uname_command=/usr/bin/uname
elif [ -x /bin/uname ]; then
  uname_command=/bin/uname
else
  fail
fi

resolve_file() {
  resolved=$1
  links=0
  while [ -L "$resolved" ]; do
    links=$((links + 1))
    [ "$links" -le 16 ] || return 1
    target=$($readlink_command "$resolved") || return 1
    case $target in
      /*) resolved=$target ;;
      *) resolved=${resolved%/*}/$target ;;
    esac
  done
  resolved_directory=$(CDPATH= cd -- "${resolved%/*}" && pwd -P) || return 1
  printf '%s/%s\n' "$resolved_directory" "${resolved##*/}"
}

case $0 in
  /*) launcher=$0 ;;
  *) launcher=$PWD/$0 ;;
esac
launcher=$(resolve_file "$launcher") || fail
[ "${launcher##*/}" = jig ] || fail
bin=${launcher%/*}
[ "${bin##*/}" = bin ] || fail
release=${bin%/*}
entry=$release/libexec/installed-cli.js
[ -f "$entry" ] || fail

case $($uname_command -s 2>/dev/null) in
  Darwin) runtime_package=bun-darwin-x64-baseline ;;
  Linux) runtime_package=bun-linux-x64-baseline ;;
  *) fail ;;
esac
nested=$release/node_modules/@oven/$runtime_package/bin/bun
hoisted=$release/../../@oven/$runtime_package/bin/bun
if [ -f "$nested" ] && [ -x "$nested" ]; then
  runtime=$nested
elif [ -f "$hoisted" ] && [ -x "$hoisted" ]; then
  runtime=$hoisted
else
  fail
fi
runtime=$(resolve_file "$runtime") || fail

unset BUN_BE_BUN BUN_OPTIONS NODE_OPTIONS
exec "$runtime" --no-env-file --no-install --config=/dev/null "$entry" "$@"
