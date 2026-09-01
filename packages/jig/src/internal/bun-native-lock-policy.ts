/** Closed Bun 1.3.3 lock policy for the direct alpha's one preparer. */
export function requirePrivateBunLockPolicy(value: unknown): void {
  const lock = ordinaryRecord(value);
  const workspaces = ordinaryRecord(lock?.workspaces);
  const rootWorkspace = ordinaryRecord(workspaces?.[""]);
  const packages = ordinaryRecord(lock?.packages);
  if (lock?.lockfileVersion !== 1 || workspaces === undefined || rootWorkspace === undefined ||
      packages === undefined || Object.keys(workspaces).length !== 1 ||
      lock.patchedDependencies !== undefined) {
    throw new TypeError("unsupported Bun lock source");
  }
  for (const resolution of Object.values(packages)) {
    if (!Array.isArray(resolution) || resolution.length !== 4 ||
        typeof resolution[0] !== "string" || typeof resolution[1] !== "string" ||
        resolution[1] !== "" && resolution[1] !== "https://registry.npmjs.org" &&
        resolution[1] !== "https://registry.npmjs.org/" ||
        ordinaryRecord(resolution[2]) === undefined ||
        typeof resolution[3] !== "string" ||
        !/^sha(?:256|512)-[A-Za-z0-9+/]+={0,2}$/.test(resolution[3])) {
      throw new TypeError("unsupported Bun lock source");
    }
  }
}

function ordinaryRecord(value: unknown): Record<string, unknown> | undefined {
  if (value === null || typeof value !== "object" || Array.isArray(value) ||
      Object.getPrototypeOf(value) !== Object.prototype) return undefined;
  return value as Record<string, unknown>;
}
