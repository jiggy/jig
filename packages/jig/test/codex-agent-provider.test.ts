import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { privateAcpAgentRuntime } from "../src/internal/acp-agent-provider.js";
import {
  createPrivateCodexOpenAIApiAgentProvider,
  createPrivateCodexSubscriptionAgentProvider,
  openPrivateCodexAgentProvider,
  projectPrivateCodexSubscriptionCredential,
  PRIVATE_CODEX_DEFAULT_OPENAI_BASE_URL,
  PRIVATE_CODEX_REQUIREMENTS,
} from "../src/internal/codex-agent-provider.js";
import { openPrivateInstalledBunHost } from "../src/internal/installed-bun-host.js";
import { installedBunLocation } from "./fixtures/installed-bun-location.js";

const temporary = new Set<string>();
const encoder = new TextEncoder();
afterEach(async () => {
  await Promise.all([...temporary].map((path) => rm(path, { recursive: true, force: true })));
  temporary.clear();
});

describe("private native Codex Agent provider", () => {
  test("selects the Codex subscription by default and an explicit Responses API", async () => {
    const fixture = await files();
    const codexHome = join(fixture.root, "canonical-home");
    await mkdir(codexHome);
    await writeFile(
      join(codexHome, "auth.json"),
      JSON.stringify(credentialValue("account-one", "subscription-secret", {
        authMode: "chatgpt",
        refreshToken: "canonical-refresh-secret",
      })),
      { mode: 0o600 },
    );

    const subscription = await openPrivateCodexAgentProvider(
      installedBunLocation.releaseRoot,
      {
        CODEX_HOME: codexHome,
        CODEX_PATH: fixture.executablePath,
      },
    );
    const pinnedSubscription = await openPrivateCodexAgentProvider(
      installedBunLocation.releaseRoot,
      {
        CODEX_HOME: codexHome,
        CODEX_PATH: fixture.executablePath,
        CODEX_MODEL: "gpt-5.3-codex-spark",
      },
    );
    const gateway = await openPrivateCodexAgentProvider(
      installedBunLocation.releaseRoot,
      {
        CODEX_HOME: join(fixture.root, "missing-home"),
        CODEX_PATH: fixture.executablePath,
        OPENAI_API: "responses",
        OPENAI_API_KEY: "gateway-secret",
        OPENAI_BASE_URL: "https://gateway.example/v1",
        OPENAI_MODEL: "provider/test-model",
      },
    );

    expect(subscription).toMatchObject({
      client: "openai-codex",
      credentialMode: "openai-subscription",
      model: "client-default",
    });
    expect(pinnedSubscription.model).toBe("gpt-5.3-codex-spark");
    expect(gateway).toMatchObject({
      client: "openai-codex",
      credentialMode: "openai-responses-api-key",
      model: "provider/test-model",
    });
    await expect(openPrivateCodexAgentProvider(installedBunLocation.releaseRoot, {
      CODEX_PATH: fixture.executablePath,
      OPENAI_MODEL: "provider/test-model",
    })).rejects.toThrow("Responses API configuration is unavailable");
    await expect(openPrivateCodexAgentProvider(installedBunLocation.releaseRoot, {
      CODEX_PATH: fixture.executablePath,
      OPENAI_API: "chat-completions",
      OPENAI_API_KEY: "gateway-secret",
      OPENAI_MODEL: "provider/test-model",
    })).rejects.toThrow("requires the OpenAI Responses API");
    const unsupported = await openPrivateInstalledBunHost(installedBunLocation, {
      JIG_AGENT_CLIENT: "unknown",
    });
    expect(unsupported.agentProvider).toBeUndefined();
  });

  test("projects canonical subscription state without its refresh credential", async () => {
    const root = await mkdtemp(join(tmpdir(), "jig-codex-canonical-"));
    temporary.add(root);
    const path = join(root, "auth.json");
    const source = credentialValue("account-one", "secret-one", {
      authMode: "chatgpt",
      refreshToken: "canonical-refresh-secret",
    });
    source.tokens.id_token = "canonical-id-secret";
    await writeFile(path, JSON.stringify(source), { mode: 0o600 });

    const projected = JSON.parse(new TextDecoder().decode(
      await projectPrivateCodexSubscriptionCredential(path),
    ));
    expect(projected.auth_mode).toBe("chatgptAuthTokens");
    expect(projected.tokens.refresh_token).toBe("");
    expect(projected.tokens.id_token).toBe(projected.tokens.access_token);
    expect(JSON.stringify(projected)).not.toContain("canonical-refresh-secret");
    expect(JSON.stringify(projected)).not.toContain("canonical-id-secret");
  });

  test("preserves the client subscription default without exposing canonical credentials", async () => {
    const support = await files();
    const credential = credentialBytes("account-one", "secret-one");
    const originalCredential = credential.slice();
    const provider = await createPrivateCodexSubscriptionAgentProvider({
      ...support,
      credential,
    });
    credential.fill(0);
    const runtime = privateAcpAgentRuntime(provider);

    expect(provider).toMatchObject({
      client: "openai-codex",
      model: "client-default",
      credentialMode: "openai-subscription",
    });
    expect(runtime.configuration).toEqual([]);
    expect(runtime.modeId).toBe("read-only");
    expect(runtime.authentication).toBeUndefined();
    expect(runtime.environment).toEqual({
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
        sqlite_home: "/tmp/codex-state",
      }),
      CODEX_HOME: "/tmp/codex-home",
      CODEX_PATH: "/agent/codex",
      CODEX_SQLITE_HOME: "/tmp/codex-state",
      INITIAL_AGENT_MODE: "read-only",
      JIG_CODEX_STARTUP_INPUT: "subscription",
      NO_BROWSER: "1",
      SSL_CERT_FILE: "/etc/ssl/certs/ca-certificates.crt",
    });
    expect(runtime.readOnlyMounts).toEqual([
      { source: support.requirementsPath, destination: "/etc/codex/requirements.toml" },
      { source: support.adapterPath, destination: "/agent/codex-acp.js" },
      { source: support.nativeBubblewrapPath, destination: "/agent/codex-resources/bwrap" },
      { source: support.certificatesPath, destination: "/etc/ssl/certs/ca-certificates.crt" },
    ]);
    expect(runtime.nestedUserNamespaces).toBe(true);
    const startup = runtime.startupInput!();
    expect(new DataView(startup.buffer, startup.byteOffset, 4).getUint32(0, false))
      .toBe(originalCredential.byteLength);
    expect(startup.slice(4)).toEqual(originalCredential);
    startup.fill(0);
    expect(runtime.startupInput!().slice(4)).toEqual(originalCredential);
    expect(JSON.stringify(provider)).not.toContain("secret-one");
    expect(JSON.stringify(provider)).not.toContain("account-one");
    expect(JSON.stringify(runtime.environment)).not.toContain("secret-one");
    expect(Object.keys(runtime.environment).some((name) =>
      /(AUTH|CREDENTIAL|KEY|SECRET|TOKEN)/i.test(name))).toBe(false);
  });

  test("allows bearer rotation without changing admitted provider identity", async () => {
    const support = await files();
    const first = await createPrivateCodexSubscriptionAgentProvider({
      ...support,
      credential: credentialBytes("account-one", "secret-one"),
    });
    const second = await createPrivateCodexSubscriptionAgentProvider({
      ...support,
      credential: credentialBytes("account-two", "secret-two"),
    });

    expect(first.digest).toBe(second.digest);
  });

  test("rechecks bearer expiry immediately before launch", async () => {
    const support = await files();
    const now = Date.now();
    const provider = await createPrivateCodexSubscriptionAgentProvider({
      ...support,
      credential: encoder.encode(JSON.stringify(credentialValue("account", "secret", {
        expiresAt: now + 6 * 60_000,
      }))),
    });
    const runtime = privateAcpAgentRuntime(provider);
    const originalNow = Date.now;
    try {
      Date.now = () => now + 2 * 60_000;
      expect(() => runtime.startupInput!()).toThrow("subscription credential is invalid");
    } finally {
      Date.now = originalNow;
    }
  });

  test("rejects canonical, refreshable, expired, and mismatched subscription credentials", async () => {
    const support = await files();
    for (const value of [
      credentialValue("account", "secret", { authMode: "chatgpt" }),
      credentialValue("account", "secret", { refreshToken: "must-not-enter-jig" }),
      credentialValue("account", "secret", { expiresAt: Date.now() + 1_000 }),
      credentialValue("account", "secret", { claimAccountId: "different-account" }),
    ]) {
      await expect(createPrivateCodexSubscriptionAgentProvider({
        ...support,
        credential: encoder.encode(JSON.stringify(value)),
      })).rejects.toThrow("subscription credential is invalid");
    }
  });

  test("rejects malformed and oversized in-memory subscription credentials", async () => {
    const support = await files();
    await expect(createPrivateCodexSubscriptionAgentProvider({
      ...support,
      credential: new Uint8Array([0xff]),
    })).rejects.toThrow("subscription credential is invalid");
    await expect(createPrivateCodexSubscriptionAgentProvider({
      ...support,
      credential: new Uint8Array(64 * 1024),
    })).rejects.toThrow("subscription credential is invalid");
  });

  test("uses an exact Responses-compatible endpoint without naming its operator", async () => {
    const support = await files();
    const first = await createPrivateCodexOpenAIApiAgentProvider({
      ...support,
      apiKey: "first-secret",
      baseURL: "https://gateway.example/v1",
      model: "provider/test-model",
    });
    const rotated = await createPrivateCodexOpenAIApiAgentProvider({
      ...support,
      apiKey: "rotated-secret",
      baseURL: "https://gateway.example/v1",
      model: "provider/test-model",
    });
    const otherModel = await createPrivateCodexOpenAIApiAgentProvider({
      ...support,
      apiKey: "first-secret",
      baseURL: "https://gateway.example/v1",
      model: "provider/other-model",
    });
    const otherEndpoint = await createPrivateCodexOpenAIApiAgentProvider({
      ...support,
      apiKey: "first-secret",
      baseURL: "https://other.example/v1",
      model: "provider/test-model",
    });
    const defaultEndpoint = await createPrivateCodexOpenAIApiAgentProvider({
      ...support,
      apiKey: "first-secret",
      model: "provider/test-model",
    });
    const runtime = privateAcpAgentRuntime(first);

    expect(first).toMatchObject({
      client: "openai-codex",
      credentialMode: "openai-responses-api-key",
      model: "provider/test-model",
    });
    expect(first.digest).toBe(rotated.digest);
    expect(first.digest).not.toBe(otherModel.digest);
    expect(first.digest).not.toBe(otherEndpoint.digest);
    expect(privateAcpAgentRuntime(defaultEndpoint).authentication?.identity.baseURL)
      .toBe(PRIVATE_CODEX_DEFAULT_OPENAI_BASE_URL);
    expect(runtime.configuration).toEqual([{ configId: "model", value: "provider/test-model" }]);
    expect(runtime.modeId).toBe("read-only");
    expect(runtime.authentication).toEqual({
      identity: {
        method: "api-key",
        protocol: "openai-responses",
        baseURL: "https://gateway.example/v1",
      },
      clientAuthCapabilities: { _meta: { gateway: true } },
      request: {
        methodId: "gateway",
        _meta: {
          gateway: {
            baseUrl: "https://gateway.example/v1",
            headers: { Authorization: "Bearer first-secret" },
            providerName: "OpenAI Responses-compatible endpoint",
          },
        },
      },
    });
    expect(runtime.readOnlyMounts).toEqual([
      { source: support.requirementsPath, destination: "/etc/codex/requirements.toml" },
      { source: support.adapterPath, destination: "/agent/codex-acp.js" },
      { source: support.nativeBubblewrapPath, destination: "/agent/codex-resources/bwrap" },
      { source: support.certificatesPath, destination: "/etc/ssl/certs/ca-certificates.crt" },
    ]);
    expect(runtime.nestedUserNamespaces).toBe(true);
    expect(runtime.startupInput).toBeUndefined();
    expect(JSON.stringify(first)).not.toContain("first-secret");
    expect(JSON.stringify(runtime.environment)).not.toContain("first-secret");
  });

  test("rejects malformed Responses API configuration", async () => {
    const support = await files();
    await expect(createPrivateCodexOpenAIApiAgentProvider({
      ...support,
      apiKey: " ",
      model: "provider/test-model",
    })).rejects.toThrow("Responses API credential is invalid");
    await expect(createPrivateCodexOpenAIApiAgentProvider({
      ...support,
      apiKey: "secret",
      model: "invalid model",
    })).rejects.toThrow("model is invalid");
    await expect(createPrivateCodexOpenAIApiAgentProvider({
      ...support,
      apiKey: "secret",
      baseURL: "http://gateway.example/v1",
      model: "provider/test-model",
    })).rejects.toThrow("base URL is invalid");
  });

  test("requires the exact managed Codex constraints", async () => {
    const support = await files();
    await writeFile(support.requirementsPath, "allowed_sandbox_modes = []\n");
    await expect(createPrivateCodexOpenAIApiAgentProvider({
      ...support,
      apiKey: "secret",
      model: "provider/test-model",
    })).rejects.toThrow("managed requirements are invalid");
  });
});

async function files(): Promise<{
  readonly root: string;
  readonly launcherPath: string;
  readonly adapterPath: string;
  readonly executablePath: string;
  readonly nativeBubblewrapPath: string;
  readonly certificatesPath: string;
  readonly requirementsPath: string;
}> {
  const root = await mkdtemp(join(tmpdir(), "jig-codex-provider-"));
  temporary.add(root);
  const launcherPath = join(root, "codex-agent-launcher.js");
  const adapterPath = join(root, "codex-acp.js");
  const nativeRoot = join(root, "native");
  const executablePath = join(nativeRoot, "bin", "codex");
  const nativeBubblewrapPath = join(nativeRoot, "codex-resources", "bwrap");
  const certificatesPath = join(root, "ca-certificates.crt");
  const requirementsPath = join(root, "requirements.toml");
  await Promise.all([
    mkdir(join(nativeRoot, "bin"), { recursive: true }),
    mkdir(join(nativeRoot, "codex-resources"), { recursive: true }),
  ]);
  await Promise.all([
    writeFile(launcherPath, "launcher\n"),
    writeFile(adapterPath, "adapter\n"),
    writeFile(executablePath, "codex\n", { mode: 0o700 }),
    writeFile(nativeBubblewrapPath, "bwrap\n", { mode: 0o700 }),
    writeFile(certificatesPath, "certificates\n"),
    writeFile(requirementsPath, PRIVATE_CODEX_REQUIREMENTS),
  ]);
  return {
    root,
    launcherPath,
    adapterPath,
    executablePath,
    nativeBubblewrapPath,
    certificatesPath,
    requirementsPath,
  };
}

function credentialBytes(
  accountId: string,
  secret: string,
): Uint8Array {
  return encoder.encode(JSON.stringify(credentialValue(accountId, secret)));
}

function credentialValue(
  accountId: string,
  secret: string,
  options: {
    readonly authMode?: string;
    readonly refreshToken?: string;
    readonly expiresAt?: number;
    readonly claimAccountId?: string;
  } = {},
) {
  const accessToken = jwt({
    exp: Math.floor((options.expiresAt ?? Date.now() + 60 * 60_000) / 1_000),
    "https://api.openai.com/auth": {
      chatgpt_account_id: options.claimAccountId ?? accountId,
    },
    marker: secret,
  });
  return {
    OPENAI_API_KEY: null,
    auth_mode: options.authMode ?? "chatgptAuthTokens",
    last_refresh: new Date().toISOString(),
    tokens: {
      access_token: accessToken,
      account_id: accountId,
      id_token: accessToken,
      refresh_token: options.refreshToken ?? "",
    },
  };
}

function jwt(claims: Record<string, unknown>): string {
  return [
    Buffer.from(JSON.stringify({ alg: "none", typ: "JWT" })).toString("base64url"),
    Buffer.from(JSON.stringify(claims)).toString("base64url"),
    "signature",
  ].join(".");
}
