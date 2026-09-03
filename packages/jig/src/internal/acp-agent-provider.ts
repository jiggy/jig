import { constants } from "node:fs";
import { access, lstat, realpath } from "node:fs/promises";

import type * as acp from "@agentclientprotocol/sdk";

import type { JsonObject, JsonValue } from "../json.js";
import type { PrivateLinuxReadOnlyMount } from "./linux-rootless-backend.js";
import { privateDomainDigest, privateFileDigest } from "./identity.js";
import { AGENT_RUN_CONTRACT_DIGEST } from "./private-agent-run.js";
import type { PrivateAcpSessionConfiguration } from "./acp-agent-client.js";
import { snapshotPrivateOrdinaryJson } from "./private-ordinary-json.js";

const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9._:/+-]{0,255}$/;
const SECRET_ENVIRONMENT_NAME = /(AUTH|CREDENTIAL|KEY|SECRET|TOKEN)/i;
const STARTUP_INPUT_BYTES = 64 * 1024;
const authenticProviders = new WeakMap<PrivateAcpAgentProvider, PrivateAcpAgentRuntime>();

export interface PrivateAcpAgentProvider {
  readonly kind: "private-acp-agent-provider/1";
  readonly digest: string;
  readonly contractDigest: typeof AGENT_RUN_CONTRACT_DIGEST;
  readonly client: string;
  readonly model: string;
  readonly credentialMode: string;
  readonly adapterDigest: string;
  readonly executableDigest: string;
}

export interface PrivateAcpAgentProviderConfiguration {
  readonly client: string;
  readonly model: string;
  readonly credentialMode: string;
  readonly adapterPath: string;
  readonly sandboxAdapterPath: string;
  /** Whether the ACP adapter is also invoked directly by its native bridge. */
  readonly adapterExecutable?: boolean;
  readonly executablePath: string;
  readonly sandboxExecutablePath: string;
  readonly environment: Readonly<Record<string, string>>;
  readonly configuration?: readonly PrivateAcpSessionConfiguration[];
  readonly modeId?: string;
  readonly sessionMeta?: Readonly<Record<string, unknown>>;
  /** The native client starts its own unprivileged Linux sandbox. */
  readonly nestedUserNamespaces?: boolean;
  /** Secret or ephemeral client bootstrap bytes, never part of provider identity. */
  readonly startupInput?: Uint8Array;
  /** Recheck ephemeral startup authority immediately before each launch. */
  readonly revalidateStartupInput?: () => void;
  readonly authentication?: {
    readonly request: acp.AuthenticateRequest;
    readonly clientAuthCapabilities?: NonNullable<acp.ClientCapabilities["auth"]>;
    /** Non-secret endpoint and method facts which affect provider behavior. */
    readonly identity: JsonObject;
  };
  readonly readOnlyMounts?: readonly PrivateAcpReadOnlyMount[];
}

export interface PrivateAcpReadOnlyMount extends PrivateLinuxReadOnlyMount {
  /** Credential bytes may rotate without changing admitted provider identity. */
  readonly role: "credential" | "support";
}

export interface PrivateAcpAgentRuntime {
  readonly adapterPath: string;
  readonly sandboxAdapterPath: string;
  readonly adapterExecutable: boolean;
  readonly executablePath: string;
  readonly sandboxExecutablePath: string;
  readonly environment: Readonly<Record<string, string>>;
  readonly configuration: readonly PrivateAcpSessionConfiguration[];
  readonly modeId?: string;
  readonly sessionMeta?: Readonly<Record<string, unknown>>;
  readonly nestedUserNamespaces: boolean;
  readonly authentication?: PrivateAcpAgentProviderConfiguration["authentication"];
  readonly readOnlyMounts: readonly PrivateLinuxReadOnlyMount[];
  /** Return a fresh copy of bounded bootstrap bytes for one process. */
  readonly startupInput?: () => Uint8Array;
}

interface ExactMount extends PrivateLinuxReadOnlyMount {
  readonly role: PrivateAcpReadOnlyMount["role"];
  readonly digest?: string;
}

interface StoredRuntime extends PrivateAcpAgentRuntime {
  readonly exactMounts: readonly ExactMount[];
}

/**
 * Construct one exact private native-client recipe. Client-specific modules
 * decide configuration and authentication; this layer owns only ACP launch
 * identity, bounded secret separation, and artifact revalidation.
 */
export async function createPrivateAcpAgentProvider(
  value: PrivateAcpAgentProviderConfiguration,
): Promise<PrivateAcpAgentProvider> {
  requireIdentifier(value.client, "client");
  requireIdentifier(value.model, "model");
  requireIdentifier(value.credentialMode, "credential mode");
  const adapterExecutable = value.adapterExecutable ?? false;
  if (typeof adapterExecutable !== "boolean") {
    throw new Error("ACP Agent adapter policy is invalid");
  }
  const adapterPath = await exactFile(value.adapterPath, adapterExecutable, "ACP adapter");
  const executablePath = await exactFile(value.executablePath, true, "native Agent client");
  if (adapterPath !== value.adapterPath || executablePath !== value.executablePath) {
    throw new Error("ACP Agent support paths must be canonical");
  }
  requireSandboxPath(value.sandboxAdapterPath);
  requireSandboxPath(value.sandboxExecutablePath);
  if (value.sandboxAdapterPath === value.sandboxExecutablePath) {
    throw new Error("ACP Agent support destinations overlap");
  }
  const environment = normalizeEnvironment(value.environment);
  const configuration = normalizeConfiguration(value.configuration ?? []);
  const sessionMeta = value.sessionMeta === undefined
    ? undefined
    : requireJsonObject(snapshot(value.sessionMeta, "ACP session metadata"));
  const authentication = value.authentication === undefined
    ? undefined
    : normalizeAuthentication(value.authentication);
  const startupInput = value.startupInput === undefined
    ? undefined
    : normalizeStartupInput(value.startupInput);
  const revalidateStartupInput = value.revalidateStartupInput;
  if (revalidateStartupInput !== undefined && typeof revalidateStartupInput !== "function") {
    throw new Error("ACP Agent startup-input validation is invalid");
  }
  if (revalidateStartupInput !== undefined && startupInput === undefined) {
    throw new Error("ACP Agent startup-input validation has no input");
  }
  const nestedUserNamespaces = value.nestedUserNamespaces ?? false;
  if (typeof nestedUserNamespaces !== "boolean") {
    throw new Error("ACP Agent nested-user-namespace policy is invalid");
  }
  const exactMounts = Object.freeze(await Promise.all((value.readOnlyMounts ?? []).map(
    normalizeMount,
  )));
  const readOnlyMounts = Object.freeze(exactMounts.map(({ source, destination }) =>
    Object.freeze({ source, destination })));
  const [adapterDigest, executableDigest] = await Promise.all([
    privateFileDigest(adapterPath),
    privateFileDigest(executablePath),
  ]);
  const identity = Object.freeze({
    kind: "private-acp-agent-provider/1" as const,
    contractDigest: AGENT_RUN_CONTRACT_DIGEST,
    client: value.client,
    model: value.model,
    credentialMode: value.credentialMode,
    adapterDigest,
    adapterExecutable,
    executableDigest,
    sandboxAdapterPath: value.sandboxAdapterPath,
    sandboxExecutablePath: value.sandboxExecutablePath,
    environment,
    configuration,
    sessionMeta: sessionMeta ?? null,
    ...(value.modeId === undefined ? {} : { modeId: value.modeId }),
    authentication: authentication?.identity ?? null,
    hasStartupInput: startupInput !== undefined,
    nestedUserNamespaces,
    mounts: exactMounts.map(({ destination, role, digest }) => Object.freeze({
      destination,
      role,
      ...(digest === undefined ? {} : { digest }),
    })),
  });
  const provider = Object.freeze({
    kind: identity.kind,
    digest: privateDomainDigest(
      "JIG-Private-ACP-Agent-Provider/1",
      identity as unknown as JsonValue,
    ),
    contractDigest: identity.contractDigest,
    client: value.client,
    model: value.model,
    credentialMode: value.credentialMode,
    adapterDigest,
    executableDigest,
  });
  authenticProviders.set(provider, Object.freeze({
    adapterPath,
    sandboxAdapterPath: value.sandboxAdapterPath,
    adapterExecutable,
    executablePath,
    sandboxExecutablePath: value.sandboxExecutablePath,
    environment,
    configuration,
    ...(value.modeId === undefined ? {} : { modeId: value.modeId }),
    ...(sessionMeta === undefined ? {} : { sessionMeta }),
    ...(authentication === undefined ? {} : { authentication }),
    ...(startupInput === undefined ? {} : {
      startupInput: (): Uint8Array => {
        revalidateStartupInput?.();
        return startupInput.slice();
      },
    }),
    nestedUserNamespaces,
    readOnlyMounts,
    exactMounts,
  }) as StoredRuntime);
  return provider;
}

function normalizeStartupInput(value: Uint8Array): Uint8Array {
  if (!(value instanceof Uint8Array) || value.byteLength === 0 ||
      value.byteLength > STARTUP_INPUT_BYTES) {
    throw new Error("ACP Agent startup input is invalid");
  }
  return value.slice();
}

export function requirePrivateAcpAgentProvider(value: unknown): PrivateAcpAgentProvider {
  if (value === null || typeof value !== "object" || !Object.isFrozen(value) ||
      !authenticProviders.has(value as PrivateAcpAgentProvider)) {
    throw new TypeError("Agent provider was not produced by an ACP client factory");
  }
  return value as PrivateAcpAgentProvider;
}

export function privateAcpAgentRuntime(value: PrivateAcpAgentProvider): PrivateAcpAgentRuntime {
  return authenticProviders.get(requirePrivateAcpAgentProvider(value))!;
}

export async function revalidatePrivateAcpAgentProvider(value: unknown): Promise<void> {
  const provider = requirePrivateAcpAgentProvider(value);
  const runtime = privateAcpAgentRuntime(provider);
  const [adapterPath, executablePath] = await Promise.all([
    exactFile(runtime.adapterPath, runtime.adapterExecutable, "ACP adapter"),
    exactFile(runtime.executablePath, true, "native Agent client"),
  ]);
  const [adapterDigest, executableDigest] = await Promise.all([
    privateFileDigest(adapterPath),
    privateFileDigest(executablePath),
  ]);
  if (adapterPath !== runtime.adapterPath || executablePath !== runtime.executablePath ||
      adapterDigest !== provider.adapterDigest || executableDigest !== provider.executableDigest) {
    throw new Error("ACP Agent support changed after selection");
  }
  const exactMounts = (runtime as StoredRuntime).exactMounts;
  await Promise.all(exactMounts.map(async (mount) => {
    const source = await exactFile(mount.source, false, "ACP Agent mount");
    if (source !== mount.source || mount.digest !== undefined &&
        await privateFileDigest(source) !== mount.digest) {
      throw new Error("ACP Agent support changed after selection");
    }
  }));
}

function normalizeConfiguration(
  value: readonly PrivateAcpSessionConfiguration[],
): readonly PrivateAcpSessionConfiguration[] {
  if (value.length > 16) throw new Error("ACP Agent session configuration is invalid");
  return Object.freeze(value.map((item) => {
    if (item === null || typeof item !== "object" || !validIdentifier(item.configId) ||
        (typeof item.value !== "string" && typeof item.value !== "boolean") ||
        typeof item.value === "string" && !validIdentifier(item.value) ||
        typeof item.value === "boolean" && item.type !== "boolean") {
      throw new Error("ACP Agent session configuration is invalid");
    }
    return Object.freeze({ ...item });
  }));
}

function normalizeAuthentication(
  value: NonNullable<PrivateAcpAgentProviderConfiguration["authentication"]>,
): NonNullable<PrivateAcpAgentProviderConfiguration["authentication"]> {
  const request = requireJsonObject(snapshot(value.request, "ACP authentication request"));
  if (!validIdentifier(request.methodId as string)) {
    throw new Error("ACP Agent authentication is invalid");
  }
  const identity = requireJsonObject(snapshot(value.identity, "ACP authentication identity"));
  const clientAuthCapabilities = value.clientAuthCapabilities === undefined
    ? undefined
    : requireJsonObject(snapshot(value.clientAuthCapabilities, "ACP authentication capabilities"));
  return Object.freeze({
    request: request as unknown as acp.AuthenticateRequest,
    ...(clientAuthCapabilities === undefined ? {} : {
      clientAuthCapabilities: clientAuthCapabilities as NonNullable<acp.ClientCapabilities["auth"]>,
    }),
    identity,
  });
}

async function normalizeMount(mount: PrivateAcpReadOnlyMount): Promise<ExactMount> {
  if (mount.role !== "credential" && mount.role !== "support") {
    throw new Error("ACP Agent mount role is invalid");
  }
  const source = await exactFile(mount.source, false, "ACP Agent mount");
  if (source !== mount.source) throw new Error("ACP Agent mount paths must be canonical");
  requireSandboxPath(mount.destination);
  return Object.freeze({
    source,
    destination: mount.destination,
    role: mount.role,
    ...(mount.role === "support" ? { digest: await privateFileDigest(source) } : {}),
  });
}

function snapshot(value: unknown, label: string): JsonValue {
  return snapshotPrivateOrdinaryJson(value, label, (message) => new Error(message));
}

function requireJsonObject(value: JsonValue): JsonObject {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("ACP Agent configuration must be an object");
  }
  return value as JsonObject;
}

function normalizeEnvironment(value: Readonly<Record<string, string>>): Readonly<Record<string, string>> {
  const result: Record<string, string> = Object.create(null) as Record<string, string>;
  for (const [name, content] of Object.entries(value)) {
    if (!/^[A-Z][A-Z0-9_]{0,127}$/.test(name) || SECRET_ENVIRONMENT_NAME.test(name) ||
        typeof content !== "string" || content.includes("\0")) {
      throw new Error("ACP Agent launch environment is invalid");
    }
    result[name] = content;
  }
  return Object.freeze(result);
}

function requireIdentifier(value: string, label: string): void {
  if (!IDENTIFIER.test(value)) throw new Error(`ACP Agent ${label} is invalid`);
}

function validIdentifier(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= 1_024 &&
    !value.includes("\0");
}

function requireSandboxPath(value: string): void {
  if (!value.startsWith("/") || value === "/" || value.includes("\0") || value.includes("/../")) {
    throw new Error("ACP Agent sandbox path is invalid");
  }
}

async function exactFile(path: string, executable: boolean, label: string): Promise<string> {
  const resolved = await realpath(path);
  const information = await lstat(resolved);
  if (!information.isFile() || information.isSymbolicLink() ||
      executable && (information.mode & 0o111) === 0) {
    throw new Error(`${label} is unavailable`);
  }
  if (executable) await access(resolved, constants.X_OK);
  return resolved;
}
