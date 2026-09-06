#!/usr/bin/env bash
set -euo pipefail

log() { printf '[new-worktree] %s\n' "$*" >&2; }
fail() { log "ERROR: $*"; exit 1; }

usage() {
  printf 'usage: %s BRANCH [DIRECTORY_NAME]\n' "$0"
  printf 'Run the script from the primary checkout; destinations are its siblings.\n'
  printf 'Branches containing / require a separate directory name.\n'
}

if [[ $# == 1 && $1 == --help ]]; then
  usage
  exit 0
fi
[[ $# -ge 1 && $# -le 2 ]] || { usage >&2; exit 1; }

branch=$1
worktree_name=${2-$branch}
validated_branch=$(git check-ref-format --branch "$branch") || fail "Invalid branch name."
[[ "$validated_branch" == "$branch" ]] || fail "Use a literal branch name."
[[ "$worktree_name" =~ ^[a-zA-Z0-9][a-zA-Z0-9._-]*$ ]] ||
  fail "Directory name must start with a letter or digit and contain only letters, digits, ., _, or -."

script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
root="$(git -C "$script_dir/.." rev-parse --show-toplevel)"
[[ -d "$root/.git" ]] || fail "Invoke scripts/new-worktree.sh from the primary checkout's scripts directory."
workspace="$(cd "$root/.." && pwd -P)"
[[ -w "$workspace" ]] || fail "Workspace is not writable: $workspace"
wt="$workspace/$worktree_name"
[[ ! -e "$wt" && ! -L "$wt" ]] || fail "Target path already exists: $wt"

existing_branch=false
base_ref=HEAD
if git -C "$root" show-ref --verify --quiet "refs/heads/$branch"; then
  existing_branch=true
  base_ref="refs/heads/$branch"
fi
base_commit=$(git -C "$root" rev-parse --verify "$base_ref^{commit}")

# Mirror only existing ignored links from main to same-named workspace entries.
# Workspace links pointing INTO main (.agents, .envrc, shell.nix) are untouched;
# each worktree obtains its own tracked copies from Git.
shared_names=()
for source in "$root"/.[!.]* "$root"/..?* "$root"/*; do
  [[ -L "$source" ]] || continue
  name=${source##*/}
  [[ "$(readlink -- "$source")" == "../$name" ]] || continue
  git -C "$root" check-ignore -q -- "$name" || continue
  [[ -e "$workspace/$name" && ! -L "$workspace/$name" ]] ||
    fail "Shared entry must exist in the workspace without redirecting elsewhere: $name"
  if git -C "$root" cat-file -e "$base_commit:$name" 2>/dev/null; then
    fail "Target branch tracks $name; refusing to replace it with shared state."
  fi
  shared_names+=("$name")
done

log "Creating $wt on $branch at $base_commit"
if [[ "$existing_branch" == true ]]; then
  git -C "$root" worktree add "$wt" "$branch" >/dev/null
else
  git -C "$root" worktree add -b "$branch" "$wt" "$base_commit" >/dev/null
fi

# A late filesystem error must preserve the checkout for inspection, not force
# removal of potentially changed work. Git handles its own creation failures.
trap 'log "Setup incomplete; worktree retained for inspection: $wt"' ERR
for name in "${shared_names[@]}"; do
  ln -sT -- "../$name" "$wt/$name"
done
trap - ERR

printf 'Worktree ready:\n  cd %q\n  direnv allow\n' "$wt"
