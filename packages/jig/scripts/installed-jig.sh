#!/bin/sh

set -eu

fail() {
  printf '%s\n' 'JIG_COMMAND_UNAVAILABLE: the installed Jig runtime is unavailable' >&2
  exit 2
}

case $0 in
  *'
'*) fail ;;
esac

if [ -x /usr/bin/readlink ]; then
  readlink=/usr/bin/readlink
elif [ -x /bin/readlink ]; then
  readlink=/bin/readlink
elif [ -x /run/current-system/sw/bin/readlink ]; then
  readlink=/run/current-system/sw/bin/readlink
else
  fail
fi
launcher=$($readlink -f -- "$0") || fail
[ "${launcher##*/}" = jig ] || fail
bin=${launcher%/*}
[ "${bin##*/}" = bin ] || fail
release=${bin%/*}
entry=$release/libexec/installed-cli.js
[ -f "$entry" ] || fail

nested=$release/node_modules/@oven/bun-linux-x64-baseline/bin/bun
hoisted=$release/../../@oven/bun-linux-x64-baseline/bin/bun
if [ -f "$nested" ] && [ -x "$nested" ]; then
  runtime=$nested
elif [ -f "$hoisted" ] && [ -x "$hoisted" ]; then
  runtime=$hoisted
else
  fail
fi
runtime=$($readlink -f -- "$runtime") || fail

unset BUN_BE_BUN BUN_OPTIONS NODE_OPTIONS
exec "$runtime" --no-env-file --no-install --config=/dev/null "$entry" "$@"
