#!/bin/sh

# Require one successful full Linux Host Conformance run for the exact main
# source revision before the retained npm candidates may be published.

set -eu

if [ "$#" -ne 2 ]; then
  echo "usage: scripts/require-linux-host-conformance.sh <owner/repository> <source-revision>" >&2
  exit 2
fi

repository=$1
revision=$2

case $repository in
  ""|/*|*/|*//*|*/*/*|*[!A-Za-z0-9_./-]*)
    echo "repository must be one GitHub owner/repository name" >&2
    exit 2
    ;;
esac
if [ "${#revision}" -ne 40 ]; then
  echo "source revision must be one full Git object ID" >&2
  exit 2
fi
case $revision in
  *[!0-9A-Fa-f]*)
    echo "source revision must be one full Git object ID" >&2
    exit 2
    ;;
esac
if [ -z "${GH_TOKEN:-}" ]; then
  echo "GH_TOKEN is required to inspect Linux Host Conformance" >&2
  exit 2
fi
command -v gh >/dev/null 2>&1 || {
  echo "gh is required to inspect Linux Host Conformance" >&2
  exit 2
}
command -v jq >/dev/null 2>&1 || {
  echo "jq is required to inspect Linux Host Conformance" >&2
  exit 2
}

temporary=$(mktemp -d "${RUNNER_TEMP:-${TMPDIR:-/tmp}}/jig-host-conformance.XXXXXX")
cleanup() {
  rm -rf -- "$temporary"
}
trap cleanup EXIT HUP INT TERM

attempts=240
delay_seconds=10
runs_file=$temporary/runs.json
attempt=1
while [ "$attempt" -le "$attempts" ]; do
  gh api --method GET \
    -f branch=main \
    -f event=push \
    -f head_sha="$revision" \
    -f per_page=100 \
    "repos/$repository/actions/workflows/linux-host-conformance.yml/runs" \
    > "$runs_file"
  state=$(jq -r \
    --arg repository "$repository" \
    --arg revision "$revision" \
    '
      [
        .workflow_runs[]
        | select(
            .event == "push" and
            .head_branch == "main" and
            .head_sha == $revision and
            .head_repository.full_name == $repository
          )
      ] as $runs
      | if any($runs[]; .status == "completed" and .conclusion == "success") then
          "success"
        elif any($runs[]; .status != "completed") then
          "pending"
        elif ($runs | length) == 0 then
          "missing"
        else
          "failed"
        end
    ' "$runs_file")
  case $state in
    success)
      echo "Linux Host Conformance succeeded for $revision"
      exit 0
      ;;
    failed)
      jq -r \
        --arg repository "$repository" \
        --arg revision "$revision" \
        '
          .workflow_runs[]
          | select(
              .event == "push" and
              .head_branch == "main" and
              .head_sha == $revision and
              .head_repository.full_name == $repository
            )
          | "\(.status)/\(.conclusion // "unknown") \(.html_url)"
        ' "$runs_file" >&2
      echo "Linux Host Conformance did not succeed for $revision" >&2
      exit 1
      ;;
    missing|pending) ;;
    *)
      echo "unexpected Linux Host Conformance state: $state" >&2
      exit 1
      ;;
  esac
  if [ "$attempt" -eq "$attempts" ]; then
    echo "Linux Host Conformance did not succeed for $revision before the authorization deadline" >&2
    exit 1
  fi
  sleep "$delay_seconds"
  attempt=$((attempt + 1))
done
