#!/bin/sh
# Trusted tooling consumes candidate archives only as data. Never run package scripts.
set -eu
tool_directory=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
publish_mode=production
registry=https://registry.npmjs.org
visibility_attempts=100
visibility_delay_seconds=10
if [ "$#" -gt 0 ]; then
  [ "$#" -eq 2 ] && [ "$1" = --rehearsal ] || { echo 'Use publish.sh [--rehearsal LOOPBACK_REGISTRY]' >&2; exit 2; }
  registry=$2
  node --input-type=module -e '
    const url = new URL(process.argv[1]);
    if (url.protocol !== "http:" || url.hostname !== "127.0.0.1" || !url.port ||
        url.pathname !== "/" || url.username || url.password || url.search || url.hash)
      throw Error("Rehearsal requires an isolated IPv4 loopback registry");
    for (const name of Object.keys(process.env))
      if (/TOKEN|SECRET|PASSWORD|CREDENTIAL|^ACTIONS_ID_TOKEN_|^OPENROUTER_API_KEY$/.test(name) && process.env[name])
        throw Error("Rehearsal refuses ambient credentials");
  ' "$registry"
  publish_mode=rehearsal
  visibility_attempts=5
  visibility_delay_seconds=1
fi
# Explicit CLI flags win over candidate publishConfig and ambient npm settings.
npm_registry() { npm "$@" --registry "$registry" --fetch-retries=0 --fetch-timeout=10000; }
set -eu

# The protected workflow owns this verifier. Queued jobs cannot rely
# on a readiness snapshot taken before approval or the mutation lock.
revalidate_qualification() {
  if [ "$publish_mode" = production ]; then
    node "$tool_directory/qualification.mjs"
  fi
}
# Inspect candidate data only. The trusted publisher never executes candidate code.
node --input-type=module <<'NODE'
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
const bytes = await readFile(`${process.env.RUNNER_TEMP}/candidates/CANDIDATE.json`);
if (createHash('sha256').update(bytes).digest('hex') !== process.env.EXPECTED_RECEIPT_SHA256)
  throw new Error('candidate receipt differs from authorized artifact');
const receipt = JSON.parse(bytes);
if (receipt.schemaVersion !== 2 || receipt.sourceRevision !== process.env.SOURCE_REVISION)
  throw new Error('candidate receipt source mismatch');
const release = receipt.release;
if (release?.schemaVersion !== 1 || release.eligible !== true ||
    release.reason !== 'versioned-release' || release.sourceRevision !== receipt.sourceRevision ||
    !/^[0-9a-f]{64}$/.test(release.releasePlanSha256 ?? '') ||
    !Array.isArray(release.pendingPackages) || release.pendingPackages.length !== 0 ||
    !Array.isArray(release.packages) || release.packages.length !== 4)
  throw new Error('candidate does not carry an applied release plan');
for (const [kind, name] of [
  ['agent-method', '@jigging/agent-method'],
  ['agent-acp', '@jigging/agent-acp'],
  ['semantic-router', '@jigging/semantic-router'],
  ['jig', '@jigging/jig'],
]) {
  const planned = release.packages.filter((item) => item.kind === kind);
  const candidates = receipt.packages.filter((item) => item.kind === kind);
  if (planned.length !== 1 || candidates.length !== 1 || planned[0].name !== name ||
      candidates[0].name !== name || planned[0].version !== candidates[0].version)
    throw new Error('candidate package differs from its release plan');
}
NODE

archive_digest() {
  node --input-type=module -e '
    import { createHash } from "node:crypto";
    import { readFile } from "node:fs/promises";
    console.log(createHash("sha256").update(await readFile(process.argv[1])).digest("hex"));
  ' "$1"
}

compare_versions() {
  CANDIDATE_VERSION=$1 CHANNEL_VERSION=$2 node --input-type=module -e '
    const parse = (value) => {
      const match = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/.exec(value);
      if (!match) throw new Error(`invalid registry version: ${value}`);
      const pre = match[4]?.split(".") ?? [];
      if (pre.some((part) => /^\d+$/.test(part) && part.length > 1 && part[0] === "0"))
        throw new Error(`invalid numeric prerelease identifier: ${value}`);
      return { core: match.slice(1, 4).map(BigInt), pre };
    };
    const candidate = parse(process.env.CANDIDATE_VERSION);
    const channel = process.env.CHANNEL_VERSION ? parse(process.env.CHANNEL_VERSION) : null;
    if (channel === null) { console.log("newer"); process.exit(0); }
    const compare = (a, b) => a < b ? -1 : a > b ? 1 : 0;
    let order = 0;
    for (let index = 0; index < 3 && order === 0; index++)
      order = compare(candidate.core[index], channel.core[index]);
    if (order === 0) {
      if (candidate.pre.length === 0 || channel.pre.length === 0)
        order = compare(candidate.pre.length === 0, channel.pre.length === 0);
      else for (let index = 0; index < Math.max(candidate.pre.length, channel.pre.length) && order === 0; index++) {
        const a = candidate.pre[index], b = channel.pre[index];
        if (a === undefined || b === undefined) order = compare(a !== undefined, b !== undefined);
        else {
          const an = /^\d+$/.test(a), bn = /^\d+$/.test(b);
          order = an !== bn ? (an ? -1 : 1) : an ? compare(BigInt(a), BigInt(b)) : compare(a, b);
        }
      }
    }
    console.log(order < 0 ? "older" : order > 0 ? "newer" : "equal");
  '
}

publish_candidate() {
  package_kind=$1
  package_name=$2
  case "$package_kind" in
    agent) archive_kind=agent-method ;;
    acp) archive_kind=agent-acp ;;
    router) archive_kind=semantic-router ;;
    jig) archive_kind=jig ;;
    *) echo 'unknown package kind' >&2; exit 1 ;;
  esac
  set -- "$RUNNER_TEMP"/candidates/"$archive_kind"/*.tgz
  if [ "$#" -ne 1 ] || [ ! -f "$1" ]; then
    echo "$package_name did not persist exactly one candidate archive" >&2
    exit 1
  fi
  archive=$1
  candidate_directory=$(dirname -- "$archive")
  manifest="$RUNNER_TEMP/$package_kind-package.json"
  tar -xOzf "$archive" package/package.json > "$manifest"

  metadata=$(\
    CANDIDATE_ARCHIVE=$archive \
    CANDIDATE_MANIFEST=$manifest \
    CANDIDATE_SUCCESS="$candidate_directory/SUCCESS.json" \
    CANDIDATE_KIND=$archive_kind \
    EXPECTED_NAME=$package_name \
    node --input-type=module -e '
      import { createHash } from "node:crypto";
      import { readFile } from "node:fs/promises";
      import { basename, relative } from "node:path";
      const archive = process.env.CANDIDATE_ARCHIVE;
      const manifest = JSON.parse(await readFile(process.env.CANDIDATE_MANIFEST, "utf8"));
      const success = JSON.parse(await readFile(process.env.CANDIDATE_SUCCESS, "utf8"));
      const digest = createHash("sha256").update(await readFile(archive)).digest("hex");
      const receipt = JSON.parse(await readFile(`${process.env.RUNNER_TEMP}/candidates/CANDIDATE.json`, "utf8"));
      const entries = receipt.packages.filter((item) => item.kind === process.env.CANDIDATE_KIND);
      if (entries.length !== 1 || entries[0].name !== manifest.name || entries[0].version !== manifest.version ||
          entries[0].archive !== relative(`${process.env.RUNNER_TEMP}/candidates`, archive) || entries[0].sha256 !== digest)
        throw new Error("candidate archive differs from authorized receipt");
      const sidecar = await readFile(`${archive}.sha256`, "utf8");
      if (sidecar !== `${digest}  ${basename(archive)}\n`) throw new Error("candidate digest sidecar does not match its archive");
      const match = /^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)-(alpha|next)(?:\.[0-9A-Za-z-]+)*$/.exec(manifest.version);
      if (manifest.name !== process.env.EXPECTED_NAME || match === null) throw new Error(`candidate manifest mismatch for ${process.env.EXPECTED_NAME}`);
      if (manifest.private === true || manifest.publishConfig?.access !== "public") throw new Error(`${manifest.name} candidate is not public`);
      if (success.archive !== basename(archive) || success.sha256 !== digest) throw new Error(`${manifest.name} candidate evidence does not match its archive`);
      if (success.commit !== process.env.SOURCE_REVISION) throw new Error(`${manifest.name} candidate was not built from the successful CI revision`);
      process.stdout.write(`${manifest.version}\n${match[4]}\n`);
    '
  )
  version=$(printf '%s\n' "$metadata" | sed -n '1p')
  release_tag=$(printf '%s\n' "$metadata" | sed -n '2p')

  presence_error="$RUNNER_TEMP/$package_kind-presence-error"
  new_release=false
  if npm_registry view "$package_name@$version" version --json > /dev/null 2> "$presence_error"; then
    present=true
  elif grep -F 'E404' "$presence_error" > /dev/null; then
    present=false
  else
    echo "npm could not determine whether $package_name@$version exists" >&2
    sed -n '1,20p' "$presence_error" >&2
    exit 1
  fi

  tag_error="$RUNNER_TEMP/$package_kind-tag-error"
  if tagged_json=$(npm_registry view "$package_name" "dist-tags.$release_tag" --json 2> "$tag_error"); then
    :
  elif grep -F 'E404' "$tag_error" > /dev/null; then
    tagged_json=
  else
    echo "npm could not read the $release_tag channel for $package_name" >&2
    sed -n '1,20p' "$tag_error" >&2
    exit 1
  fi
  tagged=$(TAGGED_JSON="$tagged_json" node --input-type=module -e '
    const value = process.env.TAGGED_JSON;
    if (!value || value === "null") process.exit(0);
    const parsed = JSON.parse(value);
    if (typeof parsed !== "string") throw new Error("invalid npm dist-tag response");
    process.stdout.write(parsed);
  ')
  relation=$(compare_versions "$version" "$tagged")
  if [ "$present" = true ]; then
    state=verified
  elif [ "$relation" = older ]; then
    state=superseded
  elif [ "$relation" = equal ]; then
    echo "$package_name@$version is tagged but its exact version is unavailable" >&2
    exit 1
  else
    state=published
  fi

  if [ "$state" = superseded ]; then
    echo "$package_name@$version is superseded by $release_tag@$tagged; no archive was published"
  elif [ "$state" = verified ] || [ "${PREFLIGHT:-false}" = false ]; then
    if [ "$state" = published ]; then
      new_release=true
      revalidate_qualification
      set +e
      if [ "$publish_mode" = production ]; then
        npm_registry publish "$archive" --access public --tag "$release_tag" --provenance --ignore-scripts
      else
        npm_registry publish "$archive" --access public --tag "$release_tag" --provenance=false --ignore-scripts
      fi
      publish_status=$?
      set -e
    else
      publish_status=0
    fi

    refetched_directory="$RUNNER_TEMP/refetched-$package_kind"
    mkdir -p "$refetched_directory"
    refetched=
    attempt=1
    while [ "$attempt" -le "$visibility_attempts" ]; do
      rm -f "$refetched_directory"/*.tgz
      if npm_registry pack "$package_name@$version" \
          --pack-destination "$refetched_directory" --ignore-scripts > /dev/null 2>&1; then
        set -- "$refetched_directory"/*.tgz
        if [ "$#" -eq 1 ] && [ -f "$1" ]; then
          refetched=$1
          break
        fi
      fi
      if [ "$attempt" -lt "$visibility_attempts" ]; then
        sleep "$visibility_delay_seconds"
      fi
      attempt=$((attempt + 1))
    done
    if [ -z "$refetched" ]; then
      echo "npm did not expose $package_name@$version before the visibility deadline (publish exit $publish_status)" >&2
      exit 1
    fi

    candidate_digest=$(archive_digest "$archive")
    registry_digest=$(archive_digest "$refetched")
    if [ "$candidate_digest" != "$registry_digest" ]; then
      echo "registry bytes differ from the persisted $package_name candidate; bump its version" >&2
      exit 1
    fi
  fi

  if [ "${PREFLIGHT:-false}" = true ]; then
    echo "$package_name@$version preflight: $state"
    return
  fi
  if [ "$state" = verified ] && [ -z "$tagged" ]; then
    echo "$package_name@$version matches registry bytes; the missing $release_tag tag cannot be changed through trusted-publisher OIDC" >&2
  elif [ "$state" = verified ] && [ "$relation" = older ]; then
    echo "$package_name@$version matches registry bytes; a newer $release_tag tag remains unchanged"
  elif [ "$state" = verified ] && [ "$relation" = newer ]; then
    echo "$package_name@$version matches registry bytes; the older $release_tag tag cannot be changed through trusted-publisher OIDC" >&2
  fi
  if [ "$state" = published ]; then
    attempt=1
    while [ "$attempt" -le "$visibility_attempts" ]; do
      observed=$(npm_registry view "$package_name" "dist-tags.$release_tag" --json 2> /dev/null || true)
      observed=$(TAGGED_JSON="$observed" node --input-type=module -e '
        const value = process.env.TAGGED_JSON;
        if (value && value !== "null") process.stdout.write(JSON.parse(value));
      ')
      relation=$(compare_versions "$version" "$observed")
      if [ "$relation" != newer ]; then break; fi
      if [ "$attempt" -lt "$visibility_attempts" ]; then sleep "$visibility_delay_seconds"; fi
      attempt=$((attempt + 1))
    done
    if [ "$relation" = newer ]; then
      echo "$package_name@$version did not converge on the $release_tag dist-tag (publish exit $publish_status)" >&2
      exit 1
    fi
  fi
  printf '%s_new=%s\n' "$package_kind" "$new_release" >> "$GITHUB_OUTPUT"
  printf '%s_state=%s\n' "$package_kind" "$state" >> "$GITHUB_OUTPUT"
  printf '%s_version=%s\n' "$package_kind" "$version" >> "$GITHUB_OUTPUT"
}

# Keep the independent SDK outside Jig's host qualification path.
# Each group preflights its complete set before any registry mutation.
case "$RELEASE_GROUP" in
  host) package_kinds="agent acp router jig" ;;
  *) echo "unknown release group" >&2; exit 1 ;;
esac
revalidate_qualification
for PREFLIGHT in true false; do
  for kind in $package_kinds; do
    case "$kind" in
      agent) publish_candidate agent @jigging/agent-method ;;
      acp) publish_candidate acp @jigging/agent-acp ;;
      router) publish_candidate router @jigging/semantic-router ;;
      jig) publish_candidate jig @jigging/jig ;;
    esac
  done
done
