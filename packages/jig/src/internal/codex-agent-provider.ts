import { lstat, readFile, realpath } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

import {
  createPrivateAcpAgentProvider,
  type PrivateAcpAgentProvider,
} from "./acp-agent-provider.js";

const CODEX_CLIENT = "openai-codex";
const SANDBOX_LAUNCHER_PATH = "/agent/codex-agent-launcher.js";
const SANDBOX_ADAPTER_PATH = "/agent/codex-acp.js";
const SANDBOX_EXECUTABLE_PATH = "/agent/codex";
const SANDBOX_NATIVE_BUBBLEWRAP_PATH = "/agent/codex-resources/bwrap";
const HOST_CERTIFICATES_PATH = "/etc/ssl/certs/ca-certificates.crt";
const SANDBOX_CERTIFICATES_PATH = "/etc/ssl/certs/ca-certificates.crt";
const SANDBOX_CODEX_HOME = "/tmp/codex-home";
const SANDBOX_SUBSCRIPTION_CREDENTIAL_PATH = "/tmp/codex-home/auth.json";
const SANDBOX_REQUIREMENTS_PATH = "/etc/codex/requirements.toml";
const SUBSCRIPTION_EXPIRY_MARGIN_MS = 5 * 60_000;
const MAX_CREDENTIAL_BYTES = 64 * 1024 - 4;
const MAX_SECRET_BYTES = 16 * 1024;
const encoder = new TextEncoder();
const decoder = new TextDecoder("utf-8", { fatal: true });
const OPENROUTER_API_KEY = "OPENROUTER_API_KEY";
const OPENROUTER_MODEL = "OPENROUTER_MODEL";

export const PRIVATE_CODEX_SUBSCRIPTION_MODEL = "gpt-5.3-codex-spark" as const;
export const PRIVATE_CODEX_OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1" as const;
export const PRIVATE_CODEX_REQUIREMENTS = [
  'allowed_approval_policies = ["on-request"]',
  'allowed_sandbox_modes = ["read-only", "workspace-write"]',
  "",
  "[permissions.filesystem]",
  `deny_read = ["${SANDBOX_SUBSCRIPTION_CREDENTIAL_PATH}"]`,
  "",
].join("\n");

export interface PrivateCodexAgentSupport {
  /** Exact Jig-owned startup launcher selected by trusted host policy. */
  readonly launcherPath: string;
  /** Exact official codex-acp adapter selected by trusted host policy. */
  readonly adapterPath: string;
  /** Exact native OpenAI Codex executable selected by trusted host policy. */
  readonly executablePath: string;
  /** Exact native Bubblewrap shipped beside that Codex executable. */
  readonly nativeBubblewrapPath: string;
  /** Exact host trust bundle selected by the installed Jig host. */
  readonly certificatesPath: string;
  /** Exact managed constraints containing PRIVATE_CODEX_REQUIREMENTS. */
  readonly requirementsPath: string;
}

export interface PrivateCodexSubscriptionAgentConfiguration extends PrivateCodexAgentSupport {
  /**
   * In-memory external-bearer projection. A canonical Codex auth.json,
   * refresh token, or complete CODEX_HOME is deliberately rejected.
   */
  readonly credential: Uint8Array;
}

export interface PrivateCodexOpenRouterAgentConfiguration extends PrivateCodexAgentSupport {
  readonly apiKey: string;
  readonly model: string;
}

/**
 * Open the one native Codex flavor selected by trusted host configuration.
 * OpenRouter is used only when its model is explicitly selected; otherwise
 * Codex consumes the operator's existing ChatGPT subscription projection.
 */
export async function openPrivateCodexAgentProvider(
  releaseRoot: string,
  environment: Readonly<Record<string, string | undefined>> = process.env,
): Promise<PrivateAcpAgentProvider> {
  const executablePath = environment.CODEX_PATH;
  if (executablePath === undefined || executablePath.length === 0) {
    throw new Error("the native Codex executable is unavailable");
  }
  const support = Object.freeze({
    launcherPath: join(releaseRoot, "libexec", "agent", "codex-agent-launcher.js"),
    adapterPath: join(releaseRoot, "libexec", "agent", "codex-acp.js"),
    executablePath,
    nativeBubblewrapPath: await nativeBubblewrapFor(executablePath),
    certificatesPath: await ordinaryFile(HOST_CERTIFICATES_PATH, "host certificate bundle"),
    requirementsPath: join(releaseRoot, "libexec", "agent", "codex-requirements.toml"),
  });
  const model = environment[OPENROUTER_MODEL];
  if (model !== undefined) {
    const apiKey = environment[OPENROUTER_API_KEY];
    if (apiKey === undefined) {
      throw new Error("the OpenRouter gateway credential is unavailable");
    }
    return await createPrivateCodexOpenRouterAgentProvider({ ...support, apiKey, model });
  }
  const sourceHome = environment.CODEX_HOME ?? join(homedir(), ".codex");
  const credential = await projectPrivateCodexSubscriptionCredential(
    join(sourceHome, "auth.json"),
  );
  return await createPrivateCodexSubscriptionAgentProvider({ ...support, credential });
}

/**
 * Read the native client's canonical subscription file in trusted host code
 * and retain only a short-lived, non-refreshable bearer projection for the
 * contained Run. The source file itself is never mounted.
 */
export async function projectPrivateCodexSubscriptionCredential(
  path: string,
): Promise<Uint8Array> {
  const exact = await exactFile(path, "Codex subscription credential");
  const information = await lstat(exact);
  const uid = typeof process.getuid === "function" ? process.getuid() : -1;
  if (information.uid !== uid || information.nlink !== 1 ||
      (information.mode & 0o077) !== 0 || information.size > MAX_CREDENTIAL_BYTES) {
    throw new Error("Codex subscription credential is invalid");
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(await readFile(exact, "utf8"));
  } catch {
    throw new Error("Codex subscription credential is invalid");
  }
  if (!isRecord(parsed) || !exactKeys(parsed, [
    "OPENAI_API_KEY", "auth_mode", "last_refresh", "tokens",
  ]) || parsed.auth_mode !== "chatgpt" || parsed.OPENAI_API_KEY !== null ||
      !isRecord(parsed.tokens) || !exactKeys(parsed.tokens, [
        "access_token", "account_id", "id_token", "refresh_token",
      ])) {
    throw new Error("Codex subscription credential is invalid");
  }
  const accessToken = parsed.tokens.access_token;
  const accountId = parsed.tokens.account_id;
  if (typeof accessToken !== "string" || typeof accountId !== "string" ||
      typeof parsed.tokens.id_token !== "string" ||
      typeof parsed.tokens.refresh_token !== "string") {
    throw new Error("Codex subscription credential is invalid");
  }
  const projected = encoder.encode(JSON.stringify({
    OPENAI_API_KEY: null,
    auth_mode: "chatgptAuthTokens",
    last_refresh: new Date().toISOString(),
    tokens: {
      access_token: accessToken,
      account_id: accountId,
      id_token: accessToken,
      refresh_token: "",
    },
  }));
  return requireSubscriptionCredential(projected);
}

/**
 * Select native Codex with an existing OpenAI subscription. The subscription
 * model is deliberately fixed; callers cannot turn this convenience path into
 * a general model-selection policy.
 */
export async function createPrivateCodexSubscriptionAgentProvider(
  value: PrivateCodexSubscriptionAgentConfiguration,
): Promise<PrivateAcpAgentProvider> {
  await requireManagedRequirements(value.requirementsPath);
  const credential = requireSubscriptionCredential(value.credential);
  return await createPrivateAcpAgentProvider({
    client: CODEX_CLIENT,
    model: PRIVATE_CODEX_SUBSCRIPTION_MODEL,
    credentialMode: "openai-subscription",
    adapterPath: value.launcherPath,
    sandboxAdapterPath: SANDBOX_LAUNCHER_PATH,
    executablePath: value.executablePath,
    sandboxExecutablePath: SANDBOX_EXECUTABLE_PATH,
    environment: codexEnvironment(true, PRIVATE_CODEX_SUBSCRIPTION_MODEL),
    configuration: [{ configId: "model", value: PRIVATE_CODEX_SUBSCRIPTION_MODEL }],
    modeId: "read-only",
    startupInput: frameStartupInput(credential),
    revalidateStartupInput: (): void => {
      const checked = requireSubscriptionCredential(credential);
      checked.fill(0);
    },
    nestedUserNamespaces: true,
    readOnlyMounts: [
      {
        source: value.requirementsPath,
        destination: SANDBOX_REQUIREMENTS_PATH,
        role: "support",
      },
      {
        source: value.adapterPath,
        destination: SANDBOX_ADAPTER_PATH,
        role: "support",
      },
      {
        source: value.nativeBubblewrapPath,
        destination: SANDBOX_NATIVE_BUBBLEWRAP_PATH,
        role: "support",
      },
      {
        source: value.certificatesPath,
        destination: SANDBOX_CERTIFICATES_PATH,
        role: "support",
      },
    ],
  });
}

/**
 * Select OpenRouter only as an explicit OpenAI-compatible gateway for native
 * Codex. The model and credential are supplied by trusted host policy; neither
 * becomes a global Codex default or a process environment variable.
 */
export async function createPrivateCodexOpenRouterAgentProvider(
  value: PrivateCodexOpenRouterAgentConfiguration,
): Promise<PrivateAcpAgentProvider> {
  requireApiKey(value.apiKey);
  await requireManagedRequirements(value.requirementsPath);
  return await createPrivateAcpAgentProvider({
    client: CODEX_CLIENT,
    model: value.model,
    credentialMode: "openrouter-gateway",
    adapterPath: value.launcherPath,
    sandboxAdapterPath: SANDBOX_LAUNCHER_PATH,
    executablePath: value.executablePath,
    sandboxExecutablePath: SANDBOX_EXECUTABLE_PATH,
    environment: codexEnvironment(false, value.model),
    configuration: [{ configId: "model", value: value.model }],
    modeId: "read-only",
    nestedUserNamespaces: true,
    readOnlyMounts: [
      {
        source: value.requirementsPath,
        destination: SANDBOX_REQUIREMENTS_PATH,
        role: "support",
      },
      {
        source: value.adapterPath,
        destination: SANDBOX_ADAPTER_PATH,
        role: "support",
      },
      {
        source: value.nativeBubblewrapPath,
        destination: SANDBOX_NATIVE_BUBBLEWRAP_PATH,
        role: "support",
      },
      {
        source: value.certificatesPath,
        destination: SANDBOX_CERTIFICATES_PATH,
        role: "support",
      },
    ],
    authentication: {
      identity: {
        method: "gateway",
        provider: "openrouter",
        protocol: "openai-responses",
        baseURL: PRIVATE_CODEX_OPENROUTER_BASE_URL,
      },
      clientAuthCapabilities: { _meta: { gateway: true } },
      request: {
        methodId: "gateway",
        _meta: {
          gateway: {
            baseUrl: PRIVATE_CODEX_OPENROUTER_BASE_URL,
            headers: { Authorization: `Bearer ${value.apiKey}` },
            providerName: "OpenRouter",
          },
        },
      },
    },
  });
}

function codexEnvironment(subscription: boolean, model: string): Readonly<Record<string, string>> {
  return Object.freeze({
    CODEX_CONFIG: JSON.stringify({
      analytics: { enabled: false },
      check_for_update_on_startup: false,
      features: {
        apps: false,
        plugins: false,
        remote_plugin: false,
        tool_suggest: false,
      },
      history: { persistence: "none" },
      log_dir: "/tmp/codex-log",
      model,
      sqlite_home: "/tmp/codex-state",
    }),
    CODEX_HOME: SANDBOX_CODEX_HOME,
    CODEX_PATH: SANDBOX_EXECUTABLE_PATH,
    CODEX_SQLITE_HOME: "/tmp/codex-state",
    INITIAL_AGENT_MODE: "read-only",
    ...(subscription ? { JIG_CODEX_STARTUP_INPUT: "subscription" } : {}),
    NO_BROWSER: "1",
    SSL_CERT_FILE: SANDBOX_CERTIFICATES_PATH,
  });
}

async function nativeBubblewrapFor(executablePath: string): Promise<string> {
  const path = await exactFile(
    join(executablePath, "..", "..", "codex-resources", "bwrap"),
    "Codex native Bubblewrap",
  );
  if (((await lstat(path)).mode & 0o111) === 0) {
    throw new Error("Codex native Bubblewrap is invalid");
  }
  return path;
}

async function ordinaryFile(path: string, label: string): Promise<string> {
  const exact = await realpath(path);
  const information = await lstat(exact);
  if (!information.isFile() || information.isSymbolicLink()) {
    throw new Error(`${label} is invalid`);
  }
  return exact;
}

async function requireManagedRequirements(path: string): Promise<void> {
  const exact = await exactFile(path, "Codex managed requirements");
  const bytes = await readFile(exact, "utf8");
  if (bytes !== PRIVATE_CODEX_REQUIREMENTS) {
    throw new Error("Codex managed requirements are invalid");
  }
}

function requireSubscriptionCredential(value: Uint8Array): Uint8Array {
  if (!(value instanceof Uint8Array) || value.byteLength === 0 ||
      value.byteLength > MAX_CREDENTIAL_BYTES) {
    throw new Error("Codex subscription credential is invalid");
  }
  const bytes = value.slice();
  let parsed: unknown;
  try {
    parsed = JSON.parse(decoder.decode(bytes));
  } catch {
    throw new Error("Codex subscription credential is invalid");
  }
  if (!isRecord(parsed) || !exactKeys(parsed, [
    "OPENAI_API_KEY", "auth_mode", "last_refresh", "tokens",
  ]) || parsed.auth_mode !== "chatgptAuthTokens" || parsed.OPENAI_API_KEY !== null ||
      typeof parsed.last_refresh !== "string" || !Number.isFinite(Date.parse(parsed.last_refresh)) ||
      !isRecord(parsed.tokens) || !exactKeys(parsed.tokens, [
        "access_token", "account_id", "id_token", "refresh_token",
      ])) {
    throw new Error("Codex subscription credential is invalid");
  }
  const { access_token: accessToken, account_id: accountId, id_token: idToken,
    refresh_token: refreshToken } = parsed.tokens;
  if (typeof accessToken !== "string" || accessToken.length === 0 ||
      encoder.encode(accessToken).byteLength > MAX_SECRET_BYTES || idToken !== accessToken ||
      refreshToken !== "" || typeof accountId !== "string" || accountId.length === 0 ||
      accountId.length > 1_024 || accountId.includes("\0")) {
    throw new Error("Codex subscription credential is invalid");
  }
  const claims = jwtClaims(accessToken);
  const auth = claims["https://api.openai.com/auth"];
  if (!Number.isSafeInteger(claims.exp) ||
      (claims.exp as number) * 1_000 < Date.now() + SUBSCRIPTION_EXPIRY_MARGIN_MS ||
      !isRecord(auth) || auth.chatgpt_account_id !== accountId) {
    throw new Error("Codex subscription credential is invalid");
  }
  return bytes;
}

async function exactFile(
  path: string,
  label: string,
): Promise<string> {
  const exact = await realpath(path);
  const information = await lstat(exact);
  if (exact !== path || !information.isFile() || information.isSymbolicLink()) {
    throw new Error(`${label} is invalid`);
  }
  return exact;
}

function frameStartupInput(value: Uint8Array): Uint8Array {
  const framed = new Uint8Array(4 + value.byteLength);
  new DataView(framed.buffer).setUint32(0, value.byteLength, false);
  framed.set(value, 4);
  return framed;
}

function jwtClaims(value: string): Record<string, unknown> {
  const pieces = value.split(".");
  if (pieces.length !== 3 || pieces.some((piece) => piece.length === 0)) {
    throw new Error("Codex subscription credential is invalid");
  }
  try {
    const claims = JSON.parse(Buffer.from(pieces[1]!, "base64url").toString("utf8"));
    if (!isRecord(claims)) throw new Error();
    return claims;
  } catch {
    throw new Error("Codex subscription credential is invalid");
  }
}

function exactKeys(value: Record<string, unknown>, expected: readonly string[]): boolean {
  const keys = Object.keys(value).sort();
  const sortedExpected = [...expected].sort();
  return keys.length === sortedExpected.length && keys.every((key, index) => key === sortedExpected[index]);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function requireApiKey(value: string): void {
  if (typeof value !== "string" || value.trim().length === 0 || value.includes("\0") ||
      encoder.encode(value).byteLength > MAX_SECRET_BYTES) {
    throw new Error("the OpenRouter gateway credential is invalid");
  }
}
