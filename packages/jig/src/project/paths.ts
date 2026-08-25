import { validateJson1 } from "../json.js";
import { fullCaseFold15_1 } from "../package/paths.js";

const encoder = new TextEncoder();

export function normalizeProjectPath(value: unknown, label: string): string {
  if (typeof value !== "string") throw new TypeError(`${label} must be a string`);
  const path = value.startsWith("./") ? value.slice(2) : value;
  validateProjectPath(path, label);
  return path;
}

export function validateProjectPath(path: unknown, label: string): asserts path is string {
  if (typeof path !== "string") throw new TypeError(`${label} must be a string`);
  validateJson1(path);
  if (path.length === 0 || path.startsWith("/") || path.includes("\\") || path.includes("\0")) {
    throw new TypeError(`${label} must be a project-relative slash path`);
  }
  if (path !== path.normalize("NFC")) throw new TypeError(`${label} must be NFC`);
  for (const segment of path.split("/")) {
    if (segment.length === 0 || segment === "." || segment === "..") {
      throw new TypeError(`${label} contains an invalid path segment`);
    }
  }
}

export function assertNoProjectPathCollisions(paths: readonly string[], label: string): void {
  const folded = new Map<string, string>();
  for (const path of paths) {
    validateProjectPath(path, label);
    const key = fullCaseFold15_1(path);
    const prior = folded.get(key);
    if (prior !== undefined) throw new TypeError(`${label} paths collide: ${prior} and ${path}`);
    folded.set(key, path);
  }
}

export function compareProjectPaths(left: string, right: string): number {
  const leftBytes = encoder.encode(left);
  const rightBytes = encoder.encode(right);
  const length = Math.min(leftBytes.length, rightBytes.length);
  for (let index = 0; index < length; index += 1) {
    const difference = leftBytes[index]! - rightBytes[index]!;
    if (difference !== 0) return difference;
  }
  return leftBytes.length - rightBytes.length;
}
