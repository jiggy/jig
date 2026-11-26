#!/usr/bin/env bash
set -euo pipefail

if (( $# != 1 )) || [[ $1 != /* || ! -x $1 ]]; then
  printf 'Usage: bash %s /absolute/path/to/installed/jig\n' "$0" >&2
  exit 2
fi

jig=$1
root=$(mktemp -d "$PWD/.jig-session-acceptance.XXXXXXXX")
project=$root/project
"$jig" init --bare "$project" >&2
flow=$project/flows/lifetime
mkdir -- "$flow"

cat > "$flow/FLOW.meta.json" <<'JSON'
{"name":"lifetime","description":"Observe Jig execution and descendant cleanup."}
JSON

cat > "$flow/FLOW.contract.json" <<'JSON'
{
  "$schema": "https://flow.jig.md/schemas/invocation-contract-0.schema.json",
  "input": {"type":"integer","minimum":0,"maximum":180000}
}
JSON

cat > "$flow/FLOW.ts" <<'TS'
import { createInterface } from 'node:readline'

const lines = createInterface({ input: process.stdin })
for await (const line of lines) {
  const request = JSON.parse(line)
  if (request.jsonrpc !== '2.0' || request.method !== 'flow/run') {
    throw new Error('Expected one FLOW Run/0 request')
  }
  const child = Bun.spawn(
    [process.execPath, '--no-env-file', '--no-install', '--config=/dev/null', '-e', 'await Bun.sleep(240_000)'],
    { stdin: 'ignore', stdout: 'ignore', stderr: 'ignore' },
  )
  child.unref()
  await Bun.sleep(request.params.input)
  process.stdout.write(JSON.stringify({
    jsonrpc: '2.0',
    id: request.id,
    result: { outcome: 'done', output: { revision: 'first', childStarted: child.pid > 1 } },
  }) + '\n')
  lines.close()
  break
}
TS

printf '%s\n' "$project"
