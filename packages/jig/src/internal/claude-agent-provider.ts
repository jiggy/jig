import { lstat, realpath } from "node:fs/promises";
import { dirname, join } from "node:path";

import {
  createPrivateAcpAgentProvider,
  type PrivateAcpAgentProvider,
} from "./acp-agent-provider.js";

const CLAUDE_CLIENT = "anthropic-claude-code";
const DEFAULT_MODEL = "default";
const SANDBOX_LAUNCHER_PATH = "/agent/claude-agent-launcher.js";
const SANDBOX_ADAPTER_PATH = "/agent/claude-agent-acp.js";
const SANDBOX_EXECUTABLE_PATH = "/agent/claude";
const HOST_CERTIFICATES_PATH = "/etc/ssl/certs/ca-certificates.crt";
const SANDBOX_CERTIFICATES_PATH = "/etc/ssl/certs/ca-certificates.crt";
const HOST_ELF_INTERPRETER_PATH = "/lib64/ld-linux-x86-64.so.2";
const SANDBOX_RUNTIME_LIBRARY_PATH = "/jig-runtime/lib/librt.so.1";
const MAX_TOKEN_BYTES = 16 * 1024;
const MAX_BASE_URL_CHARACTERS = 4_096;
const encoder = new TextEncoder();

export const PRIVATE_CLAUDE_DEFAULT_ANTHROPIC_BASE_URL = "https://api.anthropic.com" as const;

export interface PrivateClaudeAgentSupport {
  /** Exact Jig-owned startup launcher selected by trusted host policy. */
  readonly launcherPath: string;
  /** Exact release-owned Claude ACP adapter selected by trusted host policy. */
  readonly adapterPath: string;
  /** Exact operator-installed native Claude Code executable. */
  readonly executablePath: string;
  /** Exact host trust bundle selected by the installed Jig host. */
  readonly certificatesPath: string;
  /** Exact glibc realtime library required by the native Claude executable. */
  readonly runtimeLibraryPath: string;
}

export interface PrivateClaudeSubscriptionAgentConfiguration
  extends PrivateClaudeAgentSupport {
  /** A setup-token projection supplied by trusted host policy. */
  readonly token: string;
  /** Omission retains Claude Code's own subscription default. */
  readonly model?: string;
}

export interface PrivateClaudeAnthropicApiAgentConfiguration
  extends PrivateClaudeAgentSupport {
  /** Exact Anthropic-compatible authentication scheme selected by host policy. */
  readonly authentication: "api-key" | "auth-token";
  readonly credential: string;
  readonly model: string;
  /** Exact Anthropic-compatible endpoint selected by trusted host policy. */
  readonly baseURL?: string;
}

/**
 * Open one native Claude Code flavor selected by trusted host configuration.
 * A complete Anthropic-compatible API configuration selects its exact
 * authentication scheme; otherwise an explicit Claude subscription token is
 * projected into the contained process.
 */
export async function openPrivateClaudeAgentProvider(
  releaseRoot: string,
  environment: Readonly<Record<string, string | undefined>> = process.env,
): Promise<PrivateAcpAgentProvider> {
  const executablePath = environment.CLAUDE_PATH;
  if (executablePath === undefined || executablePath.length === 0) {
    throw new Error("the native Claude Code executable is unavailable");
  }
  const support = Object.freeze({
    launcherPath: join(releaseRoot, "libexec", "agent", "claude-agent-launcher.js"),
    adapterPath: join(releaseRoot, "libexec", "agent", "claude-agent-acp.js"),
    executablePath,
    certificatesPath: await ordinaryFile(
      HOST_CERTIFICATES_PATH,
      "host certificate bundle",
    ),
    runtimeLibraryPath: await ordinaryFile(
      join(dirname(await realpath(HOST_ELF_INTERPRETER_PATH)), "librt.so.1"),
      "Claude runtime library",
    ),
  });
  const apiKey = environment.ANTHROPIC_API_KEY;
  const authToken = environment.ANTHROPIC_AUTH_TOKEN;
  const apiModel = environment.ANTHROPIC_MODEL;
  const apiBaseURL = environment.ANTHROPIC_BASE_URL;
  const hasApiKey = apiKey !== undefined && apiKey.length > 0;
  const hasAuthToken = authToken !== undefined && authToken.length > 0;
  if (hasApiKey && hasAuthToken) {
    throw new Error("the Anthropic API authentication is ambiguous");
  }
  if (apiKey !== undefined || authToken !== undefined || apiModel !== undefined ||
      apiBaseURL !== undefined) {
    if (apiModel === undefined || !hasApiKey && !hasAuthToken) {
      throw new Error("the Anthropic API configuration is unavailable");
    }
    return await createPrivateClaudeAnthropicApiAgentProvider({
      ...support,
      authentication: hasAuthToken ? "auth-token" : "api-key",
      credential: (hasAuthToken ? authToken : apiKey)!,
      model: apiModel,
      ...(apiBaseURL === undefined ? {} : { baseURL: apiBaseURL }),
    });
  }
  const token = environment.CLAUDE_CODE_OAUTH_TOKEN;
  if (token === undefined) {
    throw new Error("the Claude subscription credential is unavailable");
  }
  return await createPrivateClaudeSubscriptionAgentProvider({
    ...support,
    token,
    ...(environment.CLAUDE_MODEL === undefined
      ? {}
      : { model: environment.CLAUDE_MODEL }),
  });
}

/** Select native Claude Code with an explicitly supplied subscription token. */
export async function createPrivateClaudeSubscriptionAgentProvider(
  value: PrivateClaudeSubscriptionAgentConfiguration,
): Promise<PrivateAcpAgentProvider> {
  const token = requireToken(value.token, "Claude subscription credential");
  const model = value.model ?? DEFAULT_MODEL;
  const startupInput = frameStartupInput(token);
  try {
    return await createPrivateAcpAgentProvider({
      ...baseConfiguration(value, model, "subscription"),
      credentialMode: "claude-subscription",
      startupInput,
    });
  } finally {
    startupInput.fill(0);
  }
}

/**
 * Select an exact Anthropic-compatible API endpoint for native Claude Code.
 * Endpoint and model are stable identity; the credential remains ephemeral.
 */
export async function createPrivateClaudeAnthropicApiAgentProvider(
  value: PrivateClaudeAnthropicApiAgentConfiguration,
): Promise<PrivateAcpAgentProvider> {
  const authentication = requireAnthropicAuthentication(value.authentication);
  const token = requireToken(value.credential, "Anthropic API credential");
  const baseURL = requireBaseURL(value.baseURL ?? PRIVATE_CLAUDE_DEFAULT_ANTHROPIC_BASE_URL);
  const startupInput = frameStartupInput(token);
  try {
    return await createPrivateAcpAgentProvider({
      ...baseConfiguration(value, value.model, authentication, baseURL),
      credentialMode: `anthropic-${authentication}`,
      startupInput,
    });
  } finally {
    startupInput.fill(0);
  }
}

function baseConfiguration(
  value: PrivateClaudeAgentSupport,
  model: string,
  credential: "subscription" | "api-key" | "auth-token",
  baseURL?: string,
) {
  return {
    client: CLAUDE_CLIENT,
    model,
    adapterPath: value.launcherPath,
    sandboxAdapterPath: SANDBOX_LAUNCHER_PATH,
    executablePath: value.executablePath,
    sandboxExecutablePath: SANDBOX_EXECUTABLE_PATH,
    environment: Object.freeze({
      ANTHROPIC_MODEL: model,
      ANTHROPIC_DEFAULT_HAIKU_MODEL: model,
      ANTHROPIC_DEFAULT_OPUS_MODEL: model,
      ANTHROPIC_DEFAULT_SONNET_MODEL: model,
      ...(credential === "api-key" || credential === "auth-token"
        ? { ANTHROPIC_BASE_URL: baseURL! }
        : {}),
      CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: "1",
      CLAUDE_CODE_DISABLE_TERMINAL_TITLE: "1",
      CLAUDE_CODE_DISABLE_THINKING: "1",
      CLAUDE_CODE_ENABLE_PROMPT_SUGGESTION: "false",
      CLAUDE_CODE_MAX_RETRIES: "0",
      CLAUDE_CODE_SUBAGENT_MODEL: model,
      CLAUDE_CODE_EXECUTABLE: SANDBOX_EXECUTABLE_PATH,
      CLAUDE_CONFIG_DIR: "/tmp/claude-config",
      CLAUDE_MODEL_CONFIG: JSON.stringify({ availableModels: [model] }),
      HOME: "/tmp/claude-home",
      JIG_CLAUDE_STARTUP_INPUT: credential,
      NO_BROWSER: "1",
      SSL_CERT_FILE: SANDBOX_CERTIFICATES_PATH,
    }),
    modeId: "default",
    sessionMeta: Object.freeze({
      claudeCode: Object.freeze({
        options: Object.freeze({
          model,
          persistSession: false,
          settingSources: Object.freeze([]),
          skills: Object.freeze([]),
          tools: Object.freeze([]),
        }),
      }),
    }),
    readOnlyMounts: [
      {
        source: value.adapterPath,
        destination: SANDBOX_ADAPTER_PATH,
        role: "support" as const,
      },
      {
        source: value.certificatesPath,
        destination: SANDBOX_CERTIFICATES_PATH,
        role: "support" as const,
      },
      {
        source: value.runtimeLibraryPath,
        destination: SANDBOX_RUNTIME_LIBRARY_PATH,
        role: "support" as const,
      },
    ],
  };
}

function requireAnthropicAuthentication(value: unknown): "api-key" | "auth-token" {
  if (value !== "api-key" && value !== "auth-token") {
    throw new Error("the Anthropic API authentication is invalid");
  }
  return value;
}

function requireToken(value: string, label: string): Uint8Array {
  if (typeof value !== "string" || value.length === 0 || value.trim() !== value ||
      value.includes("\0")) {
    throw new Error(`${label} is invalid`);
  }
  const bytes = encoder.encode(value);
  if (bytes.byteLength > MAX_TOKEN_BYTES) {
    throw new Error(`${label} is invalid`);
  }
  return bytes;
}

function requireBaseURL(value: string): string {
  if (typeof value !== "string" || value.length === 0 ||
      value.length > MAX_BASE_URL_CHARACTERS) {
    throw new Error("the Anthropic API base URL is invalid");
  }
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("the Anthropic API base URL is invalid");
  }
  if (url.protocol !== "https:" || url.username !== "" || url.password !== "" ||
      url.search !== "" || url.hash !== "") {
    throw new Error("the Anthropic API base URL is invalid");
  }
  return url.href.endsWith("/") ? url.href.slice(0, -1) : url.href;
}

function frameStartupInput(value: Uint8Array): Uint8Array {
  const framed = new Uint8Array(4 + value.byteLength);
  new DataView(framed.buffer).setUint32(0, value.byteLength, false);
  framed.set(value, 4);
  value.fill(0);
  return framed;
}

async function ordinaryFile(path: string, label: string): Promise<string> {
  const exact = await realpath(path);
  const information = await lstat(exact);
  if (!information.isFile() || information.isSymbolicLink()) {
    throw new Error(`${label} is invalid`);
  }
  return exact;
}
