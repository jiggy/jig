import { constants } from "node:fs";
import { access, lstat, readFile, realpath } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";

import {
  createPrivateAcpAgentProvider,
  type PrivateAcpAgentProvider,
} from "./acp-agent-provider.js";

const PI_CLIENT = "pi";
const SANDBOX_LAUNCHER_PATH = "/agent/pi-agent-launcher.js";
const SANDBOX_ADAPTER_PATH = "/agent/pi-acp.js";
const SANDBOX_EXECUTABLE_PATH = "/agent/pi";
const SANDBOX_MANIFEST_PATH = "/agent/package.json";
const SANDBOX_DARK_THEME_PATH = "/agent/theme/dark.json";
const SANDBOX_LIGHT_THEME_PATH = "/agent/theme/light.json";
const SANDBOX_CERTIFICATES_PATH = "/etc/ssl/certs/ca-certificates.crt";
const PI_PACKAGE_NAME = "@earendil-works/pi-coding-agent";
const PI_VERSION = "0.84.4";
const PI_SUBSCRIPTION_PROVIDERS = new Set(["anthropic", "openai-codex"]);
const SUBSCRIPTION_EXPIRY_MARGIN_MS = 5 * 60_000;
const MAX_STARTUP_INPUT_BYTES = 64 * 1024;
const MAX_CREDENTIAL_BYTES = MAX_STARTUP_INPUT_BYTES - 4;
const SELECTION = /^[A-Za-z0-9][A-Za-z0-9._:/+-]{0,255}$/;
const PROVIDER = /^[a-z0-9][a-z0-9._-]{0,127}$/;
const encoder = new TextEncoder();
const decoder = new TextDecoder("utf-8", { fatal: true });

/**
 * Open the explicitly selected installed Pi client. This private alpha opener
 * accepts one explicit Pi provider/model selection. PI_API_KEY selects Pi's
 * built-in API-key path; without it, the same selection names one supported
 * subscription projection. Jig does not define provider endpoints or a Pi
 * provider registry.
 */
export async function openPrivatePiAgentProvider(
  releaseRoot: string,
  environment: Readonly<Record<string, string | undefined>> = process.env,
): Promise<PrivateAcpAgentProvider> {
  const executable = environment.PI_PATH;
  if (executable === undefined || executable.length === 0) {
    throw new Error("the native Pi executable is unavailable");
  }
  const executablePath = await executableFile(executable, "native Pi executable");
  const nativeRoot = dirname(executablePath);
  const manifestPath = await piManifestFile(join(nativeRoot, "package.json"));
  const support: PrivatePiAgentSupport = Object.freeze({
    launcherPath: join(releaseRoot, "libexec", "agent", "pi-agent-launcher.js"),
    adapterPath: join(releaseRoot, "libexec", "agent", "pi-acp.js"),
    executablePath,
    manifestPath,
    darkThemePath: await ordinaryFile(
      join(nativeRoot, "theme", "dark.json"),
      "native Pi dark theme",
    ),
    lightThemePath: await ordinaryFile(
      join(nativeRoot, "theme", "light.json"),
      "native Pi light theme",
    ),
    certificatesPath: await ordinaryFile(
      "/etc/ssl/certs/ca-certificates.crt",
      "host certificate bundle",
    ),
  });

  const provider = environment.PI_PROVIDER;
  const model = environment.PI_MODEL;
  const apiKey = environment.PI_API_KEY;
  if (provider !== undefined || model !== undefined || apiKey !== undefined) {
    if (provider === undefined || model === undefined) {
      throw new Error("the Pi provider configuration is unavailable");
    }
    if (apiKey !== undefined) {
      return await createPrivatePiApiKeyAgentProvider({
        ...support,
        provider,
        model,
        apiKey,
      });
    }
    const selectedProvider = requireSubscriptionProvider(provider);
    const configuredAgentDirectory = environment.PI_CODING_AGENT_DIR;
    if (configuredAgentDirectory !== undefined &&
        (configuredAgentDirectory.length === 0 || configuredAgentDirectory.includes("\0"))) {
      throw new Error("the Pi subscription configuration is unavailable");
    }
    const credentialPath = join(
      configuredAgentDirectory === undefined
        ? join(homedir(), ".pi", "agent")
        : resolve(configuredAgentDirectory),
      "auth.json",
    );
    const sourceCredential = await readCredentialFile(credentialPath);
    let credential: Uint8Array | undefined;
    try {
      credential = projectSubscriptionCredential(sourceCredential, selectedProvider);
      return await createPrivatePiSubscriptionAgentProvider({
        ...support,
        provider: selectedProvider,
        model,
        credential,
      });
    } finally {
      sourceCredential.fill(0);
      credential?.fill(0);
    }
  }
  throw new Error("the Pi provider configuration is unavailable");
}

export interface PrivatePiAgentSupport {
  /** Exact Jig-owned launcher selected by trusted host policy. */
  readonly launcherPath: string;
  /** Exact release-owned pi-acp adapter selected by trusted host policy. */
  readonly adapterPath: string;
  /** Exact operator-installed, self-contained native Pi executable. */
  readonly executablePath: string;
  /** Exact Pi package manifest required by the native executable. */
  readonly manifestPath: string;
  /** Exact sibling theme support required even in no-theme RPC mode. */
  readonly darkThemePath: string;
  /** Exact sibling theme support required even in no-theme RPC mode. */
  readonly lightThemePath: string;
  /** Exact host trust bundle selected by the installed Jig host. */
  readonly certificatesPath: string;
}

export interface PrivatePiApiKeyAgentConfiguration
  extends PrivatePiAgentSupport {
  readonly apiKey: string;
  /** Exact built-in Pi provider ID, for example openrouter or mistral. */
  readonly provider: string;
  readonly model: string;
}

export interface PrivatePiSubscriptionAgentConfiguration
  extends PrivatePiAgentSupport {
  /** Exact Pi provider ID, for example anthropic or openai-codex. */
  readonly provider: string;
  readonly model: string;
  /**
   * Bounded auth.json projection containing exactly one non-refreshable OAuth
   * access token for `provider`.
   */
  readonly credential: Uint8Array;
}

/**
 * Select one API-key-backed provider already implemented by Pi. The key is
 * projected through startup input, never through the process environment or
 * provider identity. Jig supplies no endpoint or provider implementation.
 */
export async function createPrivatePiApiKeyAgentProvider(
  value: PrivatePiApiKeyAgentConfiguration,
): Promise<PrivateAcpAgentProvider> {
  const provider = requireProvider(value.provider);
  const model = requireSelection(value.model, "Pi model");
  const credential = apiKeyCredential(provider, value.apiKey);
  try {
    return await createPiProvider({
      support: value,
      provider,
      model,
      credentialMode: "pi-api-key",
      credentialType: "api-key",
      credential,
    });
  } finally {
    credential.fill(0);
  }
}

/**
 * Select one explicit Pi subscription/provider projection. This consumes an
 * already-bounded in-memory credential; it does not discover an ambient Pi
 * home, invoke a login broker, or retain credentials outside the Run.
 */
export async function createPrivatePiSubscriptionAgentProvider(
  value: PrivatePiSubscriptionAgentConfiguration,
): Promise<PrivateAcpAgentProvider> {
  const provider = requireSubscriptionProvider(value.provider);
  const model = requireSelection(value.model, "Pi model");
  const credential = requireSubscriptionCredential(value.credential, provider);
  try {
    return await createPiProvider({
      support: value,
      provider,
      model,
      credentialMode: "pi-subscription",
      credentialType: "subscription",
      credential,
    });
  } finally {
    credential.fill(0);
  }
}

async function createPiProvider(value: {
  readonly support: PrivatePiAgentSupport;
  readonly provider: string;
  readonly model: string;
  readonly credentialMode: string;
  readonly credentialType: "api-key" | "subscription";
  readonly credential: Uint8Array;
}): Promise<PrivateAcpAgentProvider> {
  const selection = `${value.provider}/${value.model}`;
  if (!SELECTION.test(selection)) throw new Error("Pi model selection is invalid");
  const credential = value.credential.slice();
  const startupInput = frameStartupInput(credential);
  try {
    return await createPrivateAcpAgentProvider({
      client: PI_CLIENT,
      model: selection,
      credentialMode: value.credentialMode,
      adapterPath: value.support.launcherPath,
      sandboxAdapterPath: SANDBOX_LAUNCHER_PATH,
      adapterExecutable: true,
      executablePath: value.support.executablePath,
      sandboxExecutablePath: SANDBOX_EXECUTABLE_PATH,
      environment: Object.freeze({
        HOME: "/tmp/pi-home",
        JIG_PI_MODEL: value.model,
        JIG_PI_PROVIDER: value.provider,
        JIG_PI_STARTUP_INPUT: value.credentialType,
        NO_BROWSER: "1",
        PI_ACP_PI_COMMAND: SANDBOX_LAUNCHER_PATH,
        PI_CODING_AGENT_DIR: "/tmp/pi-agent",
        PI_OFFLINE: "1",
        SSL_CERT_FILE: SANDBOX_CERTIFICATES_PATH,
      }),
      configuration: [{ configId: "model", value: selection }],
      startupInput,
      ...(value.credentialMode === "pi-subscription" ? {
        revalidateStartupInput: (): void => {
          const checked = requireSubscriptionCredential(credential, value.provider);
          checked.fill(0);
        },
      } : {}),
      readOnlyMounts: [
        {
          source: value.support.adapterPath,
          destination: SANDBOX_ADAPTER_PATH,
          role: "support",
        },
        {
          source: value.support.certificatesPath,
          destination: SANDBOX_CERTIFICATES_PATH,
          role: "support",
        },
        {
          source: value.support.manifestPath,
          destination: SANDBOX_MANIFEST_PATH,
          role: "support",
        },
        {
          source: value.support.darkThemePath,
          destination: SANDBOX_DARK_THEME_PATH,
          role: "support",
        },
        {
          source: value.support.lightThemePath,
          destination: SANDBOX_LIGHT_THEME_PATH,
          role: "support",
        },
      ],
    });
  } finally {
    startupInput.fill(0);
    if (value.credentialMode !== "pi-subscription") credential.fill(0);
  }
}

function apiKeyCredential(provider: string, value: string): Uint8Array {
  if (typeof value !== "string" || value.length === 0 || value.trim() !== value ||
      value.includes("\0")) {
    throw new Error("Pi API credential is invalid");
  }
  const bytes = encoder.encode(JSON.stringify({
    [provider]: { type: "api_key", key: value },
  }));
  if (bytes.byteLength > MAX_CREDENTIAL_BYTES) {
    bytes.fill(0);
    throw new Error("Pi API credential is invalid");
  }
  return bytes;
}

function requireSubscriptionCredential(value: Uint8Array, provider: string): Uint8Array {
  const parsed = parseCredential(value, "Pi subscription credential");
  if (!exactKeys(parsed, [provider])) {
    throw new Error("Pi subscription credential is invalid");
  }
  const entry = parsed[provider];
  if (!isRecord(entry) || !exactKeys(entry, ["access", "expires", "refresh", "type"]) ||
      entry.type !== "oauth" ||
      typeof entry.access !== "string" || entry.access.length === 0 || entry.access.includes("\0") ||
      entry.refresh !== "" ||
      typeof entry.expires !== "number" || !Number.isFinite(entry.expires) ||
      entry.expires < Date.now() + SUBSCRIPTION_EXPIRY_MARGIN_MS ||
      !ordinaryJson(entry)) {
    throw new Error("Pi subscription credential is invalid");
  }
  const bytes = encoder.encode(JSON.stringify({
    [provider]: {
      type: "oauth",
      access: entry.access,
      refresh: entry.refresh,
      expires: entry.expires,
    },
  }));
  if (bytes.byteLength > MAX_CREDENTIAL_BYTES) {
    bytes.fill(0);
    throw new Error("Pi subscription credential is invalid");
  }
  return bytes;
}

function projectSubscriptionCredential(value: Uint8Array, provider: string): Uint8Array {
  const parsed = parseCredential(value, "Pi subscription credential");
  const entry = parsed[provider];
  const allowedKeys = provider === "openai-codex" && isRecord(entry) &&
      Object.hasOwn(entry, "accountId")
    ? ["access", "accountId", "expires", "refresh", "type"]
    : ["access", "expires", "refresh", "type"];
  if (!isRecord(entry) || !exactKeys(entry, allowedKeys) || entry.type !== "oauth" ||
      typeof entry.access !== "string" || entry.access.length === 0 || entry.access.includes("\0") ||
      typeof entry.refresh !== "string" || entry.refresh.includes("\0") ||
      typeof entry.expires !== "number" || !Number.isFinite(entry.expires) ||
      Object.hasOwn(entry, "accountId") &&
        (provider !== "openai-codex" || typeof entry.accountId !== "string" ||
          entry.accountId.length === 0 || entry.accountId.includes("\0"))) {
    throw new Error("Pi subscription credential is invalid");
  }
  const projected = encoder.encode(JSON.stringify({
    [provider]: {
      type: "oauth",
      access: entry.access,
      refresh: "",
      expires: entry.expires,
    },
  }));
  try {
    return requireSubscriptionCredential(projected, provider);
  } finally {
    projected.fill(0);
  }
}

function parseCredential(value: Uint8Array, label: string): Record<string, unknown> {
  if (!(value instanceof Uint8Array) || value.byteLength === 0 ||
      value.byteLength > MAX_CREDENTIAL_BYTES) {
    throw new Error(`${label} is invalid`);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(decoder.decode(value));
  } catch {
    throw new Error(`${label} is invalid`);
  }
  if (!isRecord(parsed) || !ordinaryJson(parsed)) {
    throw new Error(`${label} is invalid`);
  }
  return parsed;
}

function frameStartupInput(value: Uint8Array): Uint8Array {
  const framed = new Uint8Array(4 + value.byteLength);
  new DataView(framed.buffer).setUint32(0, value.byteLength, false);
  framed.set(value, 4);
  return framed;
}

function requireProvider(value: string): string {
  if (typeof value !== "string" || !PROVIDER.test(value)) {
    throw new Error("Pi subscription provider is invalid");
  }
  return value;
}

function requireSubscriptionProvider(value: string): string {
  const provider = requireProvider(value);
  if (!PI_SUBSCRIPTION_PROVIDERS.has(provider)) {
    throw new Error("Pi subscription provider is invalid");
  }
  return provider;
}

function requireSelection(value: string, label: string): string {
  if (typeof value !== "string" || !SELECTION.test(value)) {
    throw new Error(`${label} is invalid`);
  }
  return value;
}

function exactKeys(value: Record<string, unknown>, expected: readonly string[]): boolean {
  const keys = Object.keys(value).sort();
  const sorted = [...expected].sort();
  return keys.length === sorted.length &&
    keys.every((key, index) => key === sorted[index]);
}

function ordinaryJson(value: unknown, depth = 0): boolean {
  if (depth > 32) return false;
  if (value === null || typeof value === "string" || typeof value === "boolean") return true;
  if (typeof value === "number") return Number.isFinite(value);
  if (Array.isArray(value)) return value.every((item) => ordinaryJson(item, depth + 1));
  return isRecord(value) && Object.entries(value).every(([key, item]) =>
    key.length > 0 && !key.includes("\0") && ordinaryJson(item, depth + 1));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

async function executableFile(path: string, label: string): Promise<string> {
  const exact = await ordinaryFile(path, label);
  if (((await lstat(exact)).mode & 0o111) === 0) throw new Error(`${label} is invalid`);
  await access(exact, constants.X_OK);
  return exact;
}

async function ordinaryFile(path: string, label: string): Promise<string> {
  const exact = await realpath(path);
  const information = await lstat(exact);
  if (!information.isFile() || information.isSymbolicLink()) {
    throw new Error(`${label} is invalid`);
  }
  return exact;
}

async function piManifestFile(path: string): Promise<string> {
  const exact = await ordinaryFile(path, "native Pi package manifest");
  let parsed: unknown;
  try {
    parsed = JSON.parse(await readFile(exact, "utf8"));
  } catch {
    throw new Error("native Pi package manifest is invalid");
  }
  if (!isRecord(parsed) || parsed.name !== PI_PACKAGE_NAME || parsed.version !== PI_VERSION) {
    throw new Error("native Pi package manifest is invalid");
  }
  return exact;
}

async function readCredentialFile(path: string): Promise<Uint8Array> {
  const exact = await realpath(path);
  const information = await lstat(exact);
  const uid = process.getuid?.();
  if (!information.isFile() || information.isSymbolicLink() || information.nlink !== 1 ||
      information.size <= 0 || information.size > MAX_CREDENTIAL_BYTES ||
      uid === undefined || information.uid !== uid || (information.mode & 0o077) !== 0) {
    throw new Error("Pi subscription credential projection is invalid");
  }
  const bytes = new Uint8Array(await readFile(exact));
  if (bytes.byteLength === 0 || bytes.byteLength > MAX_CREDENTIAL_BYTES) {
    bytes.fill(0);
    throw new Error("Pi subscription credential projection is invalid");
  }
  return bytes;
}
