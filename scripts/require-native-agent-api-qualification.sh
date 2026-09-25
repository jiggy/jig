#!/bin/sh

# Require the exact main-push native-client qualification before npm release.

set -eu

if [ "$#" -ne 2 ]; then
  echo "usage: scripts/require-native-agent-api-qualification.sh <owner/repository> <source-revision>" >&2
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
  echo "GH_TOKEN is required to inspect native Agent API qualification" >&2
  exit 2
fi
command -v gh >/dev/null 2>&1 || {
  echo "gh is required to inspect native Agent API qualification" >&2
  exit 2
}
command -v jq >/dev/null 2>&1 || {
  echo "jq is required to inspect native Agent API qualification" >&2
  exit 2
}

temporary=$(mktemp -d "${RUNNER_TEMP:-${TMPDIR:-/tmp}}/jig-native-agent-api.XXXXXX")
cleanup() {
  rm -rf -- "$temporary"
}
trap cleanup EXIT HUP INT TERM

expected_title="Native Agent API qualification for $revision"
attempts=240
delay_seconds=10
runs_file=$temporary/runs.json
attempt=1
while [ "$attempt" -le "$attempts" ]; do
  gh api --method GET \
    -f per_page=100 \
    "repos/$repository/actions/workflows/native-agent-api-qualification.yml/runs" \
    > "$runs_file"
  state=$(jq -r \
    --arg title "$expected_title" --arg revision "$revision" \
    '
      [
        .workflow_runs[]
        | select(.display_title == $title and
            (.event == "workflow_run" or
             (.event == "workflow_dispatch" and .head_branch == "main" and .head_sha == $revision)))
      ]
      | sort_by(.created_at)
      | if length == 0 then
          "missing"
        else
          last
          | if .status != "completed" then "pending"
            elif .conclusion == "success" then "success"
            else "failed"
            end
        end
    ' "$runs_file")
  case $state in
    success)
      echo "Native Agent API qualification succeeded for $revision"
      exit 0
      ;;
    failed)
      jq -r \
        --arg title "$expected_title" --arg revision "$revision" \
        '
          .workflow_runs[]
          | select(.display_title == $title and
              (.event == "workflow_run" or
               (.event == "workflow_dispatch" and .head_branch == "main" and .head_sha == $revision)))
          | "\(.status)/\(.conclusion // "unknown") \(.html_url)"
        ' "$runs_file" >&2
      echo "Native Agent API qualification did not succeed for $revision" >&2
      exit 1
      ;;
    missing|pending) ;;
    *)
      echo "unexpected native Agent API qualification state: $state" >&2
      exit 1
      ;;
  esac
  if [ "$attempt" -eq "$attempts" ]; then
    echo "Native Agent API qualification did not succeed for $revision before the authorization deadline" >&2
    exit 1
  fi
  sleep "$delay_seconds"
  attempt=$((attempt + 1))
done
