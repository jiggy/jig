import type {
  PrivateActivationReviewPlan,
} from "./activation-admission-store.js";
import { ProjectAdministrationError } from "../administration/project.js";
import type { RunTargetIdentity } from "../project/package-project.js";

// Four MiB leaves a conservative JSON/1 envelope after every ASCII backslash
// and quote in the review string is escaped by the outer value encoding.
const MAX_REVIEW_BYTES = 4 * 1024 * 1024;
const BUFFER_BYTES = 8 * 1024;

export interface PrivateProjectPlanReview {
  readonly mediaType: "text/plain; charset=utf-8";
  readonly text: string;
}

/**
 * Render complete current and proposed portable state plus identity deltas
 * without exposing the private Plan, recipe, host-observation, or
 * protected-store representations.
 */
export function renderPrivateProjectPlanReview(
  review: PrivateActivationReviewPlan,
  maximumBytes = MAX_REVIEW_BYTES,
): PrivateProjectPlanReview {
  if (!Number.isSafeInteger(maximumBytes) || maximumBytes < 1 || maximumBytes > MAX_REVIEW_BYTES) {
    throw new TypeError("project plan review byte limit is invalid");
  }
  const plan = review.plan;
  const current = review.baseCandidate === null
    ? null
    : projectCandidate(review.baseCandidate.lock, review.baseCandidate.candidate.targets);
  const proposed = projectCandidate(plan.proposed.lock, plan.proposed.targets);
  const changes = projectChanges(
    current,
    proposed,
    review.baseCandidate?.candidate.targets ?? [],
    plan.proposed.targets,
  );
  const proposal = {
    changes,
    current,
    proposed,
  };
  const writer = new BoundedAsciiWriter(maximumBytes);
  writer.write("Jig project plan review\n\n");
  writer.write("Review the project changes below before applying them.\n\n");
  writeAsciiJson(writer, proposal, 0);
  writer.write("\n");
  const text = writer.finish();
  return Object.freeze({
    mediaType: "text/plain; charset=utf-8" as const,
    text,
  });
}

function projectCandidate(
  lock: PrivateActivationReviewPlan["candidate"]["lock"],
  targetValues: PrivateActivationReviewPlan["candidate"]["candidate"]["targets"],
) {
  const targets = targetValues.map(({ request, disposition }) => ({
    target: request.target,
    mode: request.mode,
    packagePath: request.packagePath,
    entrypoint: request.entrypoint,
    settings: request.settings,
    availability: disposition.state === "ready"
      ? { state: "ready" as const }
      : { state: "unavailable" as const, code: disposition.code },
  }));
  return {
    portablePolicy: {
      packages: Object.fromEntries(Object.entries(lock.packages).map(([path, value]) => [path, {
        digest: value.digest,
        directRun: value.directRun,
      }])),
      bindings: lock.bindings,
    },
    targets,
  };
}

function projectChanges(
  current: ReturnType<typeof projectCandidate> | null,
  proposed: ReturnType<typeof projectCandidate>,
  currentTargets: PrivateActivationReviewPlan["candidate"]["candidate"]["targets"],
  proposedTargets: PrivateActivationReviewPlan["candidate"]["candidate"]["targets"],
) {
  const targetChanges = recordChanges(
    Object.fromEntries(currentTargets.map((target) => [targetKey(target.request.target), target])),
    Object.fromEntries(proposedTargets.map((target) => [targetKey(target.request.target), target])),
  );
  return {
    packages: recordChanges(
      current?.portablePolicy.packages ?? {},
      proposed.portablePolicy.packages,
    ),
    bindings: recordChanges(
      current?.portablePolicy.bindings ?? {},
      proposed.portablePolicy.bindings,
    ),
    targets: targetChanges,
  };
}

function recordChanges(
  current: Readonly<Record<string, unknown>>,
  proposed: Readonly<Record<string, unknown>>,
) {
  const currentKeys = Object.keys(current);
  const proposedKeys = Object.keys(proposed);
  const currentSet = new Set(currentKeys);
  const proposedSet = new Set(proposedKeys);
  return {
    added: proposedKeys.filter((key) => !currentSet.has(key)).sort(compareUtf16),
    removed: currentKeys.filter((key) => !proposedSet.has(key)).sort(compareUtf16),
    changed: proposedKeys.filter((key) => currentSet.has(key) &&
      JSON.stringify(current[key]) !== JSON.stringify(proposed[key])).sort(compareUtf16),
  };
}

function targetKey(
  target: RunTargetIdentity,
): string {
  return target.kind === "flow" ? `flow:${target.path}` : `binding:${target.id}`;
}

/**
 * Review text is deliberately ASCII-only. Project-controlled Unicode and all
 * controls are rendered as JSON escapes so terminal bidi, zero-width, and
 * line-control behavior cannot alter the human consent surface.
 */
class BoundedAsciiWriter {
  readonly #parts: string[] = [];
  #buffer = "";
  #length = 0;

  constructor(readonly maximumBytes: number) {}

  write(value: string): void {
    if (value.length > this.maximumBytes - this.#length) {
      throw new ProjectAdministrationError(
        "UNAVAILABLE",
        "project plan review exceeds the supported display size",
      );
    }
    this.#length += value.length;
    if (this.#buffer.length + value.length <= BUFFER_BYTES) {
      this.#buffer += value;
      return;
    }
    this.#flush();
    if (value.length >= BUFFER_BYTES) this.#parts.push(value);
    else this.#buffer = value;
  }

  finish(): string {
    this.#flush();
    return this.#parts.join("");
  }

  #flush(): void {
    if (this.#buffer.length === 0) return;
    this.#parts.push(this.#buffer);
    this.#buffer = "";
  }
}

function writeAsciiJson(writer: BoundedAsciiWriter, value: unknown, depth: number): void {
  if (value === null) {
    writer.write("null");
    return;
  }
  if (typeof value === "string") {
    writeAsciiJsonString(writer, value);
    return;
  }
  if (typeof value === "boolean") {
    writer.write(value ? "true" : "false");
    return;
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    writer.write(Object.is(value, -0) ? "0" : JSON.stringify(value));
    return;
  }
  if (Array.isArray(value)) {
    writer.write("[");
    for (let index = 0; index < value.length; index += 1) {
      writer.write(index === 0 ? "\n" : ",\n");
      writeIndent(writer, depth + 1);
      writeAsciiJson(writer, value[index], depth + 1);
    }
    if (value.length > 0) {
      writer.write("\n");
      writeIndent(writer, depth);
    }
    writer.write("]");
    return;
  }
  if (typeof value === "object") {
    const object = value as Readonly<Record<string, unknown>>;
    const keys = Object.keys(object).sort(compareUtf16);
    writer.write("{");
    for (let index = 0; index < keys.length; index += 1) {
      const key = keys[index]!;
      writer.write(index === 0 ? "\n" : ",\n");
      writeIndent(writer, depth + 1);
      writeAsciiJsonString(writer, key);
      writer.write(": ");
      writeAsciiJson(writer, object[key], depth + 1);
    }
    if (keys.length > 0) {
      writer.write("\n");
      writeIndent(writer, depth);
    }
    writer.write("}");
    return;
  }
  throw new TypeError("project plan review contains a non-JSON value");
}

function writeIndent(writer: BoundedAsciiWriter, depth: number): void {
  writer.write("  ".repeat(depth));
}

function writeAsciiJsonString(writer: BoundedAsciiWriter, value: string): void {
  writer.write('"');
  let run = 0;
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    const printable = code >= 0x20 && code <= 0x7e && code !== 0x22 && code !== 0x5c;
    if (printable) continue;
    if (run < index) writer.write(value.slice(run, index));
    if (code === 0x22) writer.write('\\"');
    else if (code === 0x5c) writer.write("\\\\");
    else if (code === 0x08) writer.write("\\b");
    else if (code === 0x09) writer.write("\\t");
    else if (code === 0x0a) writer.write("\\n");
    else if (code === 0x0c) writer.write("\\f");
    else if (code === 0x0d) writer.write("\\r");
    else writer.write(`\\u${code.toString(16).padStart(4, "0")}`);
    run = index + 1;
  }
  if (run < value.length) writer.write(value.slice(run));
  writer.write('"');
}

function compareUtf16(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
