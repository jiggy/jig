import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { privateAcpAgentRuntime } from "../src/internal/acp-agent-provider.js";
import {
  privatePiModels,
  PRIVATE_PI_NATIVE_ARGUMENTS,
  PRIVATE_PI_SETTINGS,
} from "../src/internal/pi-agent-launcher.js";
import {
  createPrivatePiApiKeyAgentProvider,
  createPrivatePiSubscriptionAgentProvider,
  openPrivatePiAgentProvider,
} from "../src/internal/pi-agent-provider.js";
import { renderPrivateAgentRunInstructions } from
  "../src/internal/root-agent-run-controller.js";

const temporary = new Set<string>();
const encoder = new TextEncoder();
const decoder = new TextDecoder();

afterEach(async () => {
  await Promise.all([...temporary].map((path) =>
    rm(path, { recursive: true, force: true })));
  temporary.clear();
});

describe("private native Pi Agent provider", () => {
  test("opens Pi only from an explicit native path and provider selection", async () => {
    const support = await files();
    const releaseRoot = join(support.launcherPath, "..", "..", "..");
    const provider = await openPrivatePiAgentProvider(releaseRoot, {
      PI_PATH: support.executablePath,
      PI_PROVIDER: "openrouter",
      PI_MODEL: "google/test-model:free",
      PI_API_KEY: "gateway-secret",
    });
    expect(provider).toMatchObject({
      client: "pi",
      credentialMode: "pi-api-key",
      model: "openrouter/google/test-model:free",
    });
    for (const environment of [
      {
        PI_PROVIDER: "openrouter",
        PI_MODEL: "google/test-model:free",
        PI_API_KEY: "secret",
      },
      { PI_PATH: support.executablePath, PI_API_KEY: "secret" },
      { PI_PATH: support.executablePath, PI_MODEL: "google/test-model:free" },
    ]) {
      await expect(openPrivatePiAgentProvider(releaseRoot, environment))
        .rejects.toThrow();
    }
  });

  test("opens one explicit subscription projection without mounting its host path", async () => {
    const support = await files();
    const releaseRoot = join(support.launcherPath, "..", "..", "..");
    const agentDirectory = join(dirname(support.executablePath), "pi-agent");
    const credentialPath = join(agentDirectory, "auth.json");
    await mkdir(agentDirectory);
    await writeFile(credentialPath, JSON.stringify({
      anthropic: {
        type: "oauth",
        access: "subscription-access",
        refresh: "subscription-refresh",
        expires: 4_102_444_800_000,
      },
      google: {
        type: "oauth",
        access: "unselected-access",
        refresh: "unselected-refresh",
        expires: 4_102_444_800_000,
      },
    }), { mode: 0o600 });
    const provider = await openPrivatePiAgentProvider(releaseRoot, {
      PI_PATH: support.executablePath,
      PI_PROVIDER: "anthropic",
      PI_MODEL: "claude-test",
      PI_CODING_AGENT_DIR: agentDirectory,
    });
    const runtime = privateAcpAgentRuntime(provider);
    expect(provider).toMatchObject({
      client: "pi",
      credentialMode: "pi-subscription",
      model: "anthropic/claude-test",
    });
    expect(startupJson(runtime.startupInput!())).toEqual({
      anthropic: {
        type: "oauth",
        access: "subscription-access",
        refresh: "",
        expires: 4_102_444_800_000,
      },
    });
    expect(runtime.readOnlyMounts.some(({ source }) => source === credentialPath)).toBe(false);
    expect(JSON.stringify(provider)).not.toContain("subscription-access");
    expect(decoder.decode(runtime.startupInput!())).not.toContain("unselected-access");
    expect(JSON.stringify(runtime.environment)).not.toContain("subscription-access");
  });

  test("uses Pi's explicit built-in API-key provider and model selection", async () => {
    const support = await files();
    const first = await createPrivatePiApiKeyAgentProvider({
      ...support,
      apiKey: "first-gateway-secret",
      provider: "openrouter",
      model: "google/test-model:free",
    });
    const rotated = await createPrivatePiApiKeyAgentProvider({
      ...support,
      apiKey: "rotated-gateway-secret",
      provider: "openrouter",
      model: "google/test-model:free",
    });
    const otherModel = await createPrivatePiApiKeyAgentProvider({
      ...support,
      apiKey: "first-gateway-secret",
      provider: "openrouter",
      model: "other/test-model",
    });
    const mistral = await createPrivatePiApiKeyAgentProvider({
      ...support,
      apiKey: "first-gateway-secret",
      provider: "mistral",
      model: "ministral-test",
    });
    const runtime = privateAcpAgentRuntime(first);

    expect(first.digest).toBe(rotated.digest);
    expect(first.digest).not.toBe(otherModel.digest);
    expect(first.digest).not.toBe(mistral.digest);
    expect(first).toMatchObject({
      client: "pi",
      credentialMode: "pi-api-key",
      model: "openrouter/google/test-model:free",
    });
    expect(runtime.environment).toEqual(environment(
      "openrouter",
      "google/test-model:free",
    ));
    expect(runtime.configuration).toEqual([{
      configId: "model",
      value: "openrouter/google/test-model:free",
    }]);
    expect(runtime.modeId).toBeUndefined();
    expect(runtime.authentication).toBeUndefined();
    expect(runtime.nestedUserNamespaces).toBe(false);
    expect(runtime.readOnlyMounts).toEqual([
      { source: support.adapterPath, destination: "/agent/pi-acp.js" },
      { source: support.certificatesPath, destination: "/etc/ssl/certs/ca-certificates.crt" },
      { source: support.manifestPath, destination: "/agent/package.json" },
      { source: support.darkThemePath, destination: "/agent/theme/dark.json" },
      { source: support.lightThemePath, destination: "/agent/theme/light.json" },
    ]);
    expect(runtime.readOnlyMounts.every(({ destination }) =>
      destination !== "/work" && !destination.startsWith("/work/"))).toBe(true);

    const projected = startupJson(runtime.startupInput!());
    expect(projected).toEqual({
      openrouter: { type: "api_key", key: "first-gateway-secret" },
    });
    expect(JSON.stringify(first)).not.toContain("secret");
    expect(JSON.stringify(runtime.environment)).not.toContain("secret");
    expect(Object.keys(runtime.environment).some((name) =>
      /(AUTH|CREDENTIAL|KEY|SECRET|TOKEN)/i.test(name))).toBe(false);
  });

  test("accepts one bounded explicit OAuth projection without an ambient Pi home", async () => {
    const support = await files();
    const credential = encoder.encode(JSON.stringify({
      "openai-codex": {
        type: "oauth",
        access: "first-access-token",
        refresh: "",
        expires: 4_102_444_800_000,
      },
    }));
    const rotatedCredential = encoder.encode(JSON.stringify({
      "openai-codex": {
        type: "oauth",
        access: "rotated-access-token",
        refresh: "",
        expires: 4_102_444_800_000,
      },
    }));
    const first = await createPrivatePiSubscriptionAgentProvider({
      ...support,
      provider: "openai-codex",
      model: "test-model",
      credential,
    });
    const rotated = await createPrivatePiSubscriptionAgentProvider({
      ...support,
      provider: "openai-codex",
      model: "test-model",
      credential: rotatedCredential,
    });
    credential.fill(0);
    rotatedCredential.fill(0);
    const runtime = privateAcpAgentRuntime(first);

    expect(first.digest).toBe(rotated.digest);
    expect(first).toMatchObject({
      client: "pi",
      credentialMode: "pi-subscription",
      model: "openai-codex/test-model",
    });
    expect(runtime.environment).toEqual(environment("openai-codex", "test-model", true));
    expect(runtime.configuration).toEqual([{
      configId: "model",
      value: "openai-codex/test-model",
    }]);
    expect(startupJson(runtime.startupInput!())).toEqual({
      "openai-codex": {
        type: "oauth",
        access: "first-access-token",
        refresh: "",
        expires: 4_102_444_800_000,
      },
    });
    expect(JSON.stringify(first)).not.toContain("access-token");
    expect(JSON.stringify(runtime.environment)).not.toContain("access-token");
  });

  test("forces a tool-free, resource-free, ephemeral native Pi RPC process", () => {
    expect(PRIVATE_PI_NATIVE_ARGUMENTS).toEqual([
      "--mode", "rpc",
      "--no-session",
      "--no-tools",
      "--no-extensions",
      "--no-skills",
      "--no-prompt-templates",
      "--no-themes",
      "--no-context-files",
      "--no-approve",
      "--offline",
    ]);
    expect(PRIVATE_PI_SETTINGS).toEqual({
      defaultProjectTrust: "never",
      enableAnalytics: false,
      enableInstallTelemetry: false,
      enableSkillCommands: false,
      extensions: [],
      packages: [],
      prompts: [],
      quietStartup: true,
      retry: { enabled: false, maxRetries: 0, provider: { maxRetries: 0 } },
      skills: [],
      themes: [],
      compaction: { enabled: false },
      images: { blockImages: true },
    });
    expect(privatePiModels("openrouter", "google/test-model:free")).toEqual({
      providers: {
        openrouter: {
          modelOverrides: {
            "google/test-model:free": { maxTokens: 4_096 },
          },
        },
      },
    });
  });

  test("requires the exact Pi 0.84.4 sibling support closure", async () => {
    const support = await files();
    const releaseRoot = join(support.launcherPath, "..", "..", "..");
    await writeFile(support.manifestPath, JSON.stringify({
      name: "@earendil-works/pi-coding-agent",
      version: "0.84.5",
    }));
    await expect(openPrivatePiAgentProvider(releaseRoot, {
      PI_PATH: support.executablePath,
      PI_PROVIDER: "openrouter",
      PI_MODEL: "google/test-model:free",
      PI_API_KEY: "gateway-secret",
    })).rejects.toThrow("native Pi package manifest is invalid");
    await rm(support.darkThemePath);
    await expect(createPrivatePiApiKeyAgentProvider({
      ...support,
      apiKey: "gateway-secret",
      provider: "openrouter",
      model: "google/test-model:free",
    })).rejects.toThrow();
  });

  test("keeps hostile leading slash instructions behind Jig's fixed prefix", () => {
    for (const instructions of ["/export", "  /changelog", "/export ../../outside"]) {
      const rendered = renderPrivateAgentRunInstructions(instructions, {
        skills: [],
        fileCount: 0,
        contentBytes: 0,
      });
      // pi-acp dispatches built-ins only when the complete ACP message,
      // after trimStart(), begins with '/'. Jig's prefix makes that false.
      expect(rendered.trimStart().startsWith("/")).toBe(false);
      expect(rendered).toContain(JSON.stringify(instructions));
    }
  });

  test("rejects mixed, ambient, malformed, and oversized credential projections", async () => {
    const support = await files();
    const invalidSubscriptions = [
      new Uint8Array(),
      encoder.encode("not-json"),
      encoder.encode(JSON.stringify({
        "openai-codex": { type: "api_key", key: "ambient" },
      })),
      encoder.encode(JSON.stringify({
        "openai-codex": { type: "oauth", access: "a", refresh: "r", expires: 1 },
        anthropic: { type: "oauth", access: "a", refresh: "r", expires: 1 },
      })),
      encoder.encode(JSON.stringify({
        "openai-codex": { type: "oauth", access: "", refresh: "r", expires: 1 },
      })),
      encoder.encode(JSON.stringify({
        "openai-codex": {
          type: "oauth",
          access: "a",
          refresh: "r",
          expires: 1,
          baseUrl: "https://unadmitted.example",
        },
      })),
      new Uint8Array(64 * 1024),
    ];
    for (const credential of invalidSubscriptions) {
      await expect(createPrivatePiSubscriptionAgentProvider({
        ...support,
        provider: "openai-codex",
        model: "test-model",
        credential,
      })).rejects.toThrow("subscription credential is invalid");
    }
    await expect(createPrivatePiSubscriptionAgentProvider({
      ...support,
      provider: "openrouter",
      model: "test-model",
      credential: encoder.encode("{}"),
    })).rejects.toThrow("subscription provider is invalid");
    await expect(createPrivatePiSubscriptionAgentProvider({
      ...support,
      provider: "github-copilot",
      model: "test-model",
      credential: encoder.encode(JSON.stringify({
        "github-copilot": { type: "oauth", access: "a", refresh: "r", expires: 1 },
      })),
    })).rejects.toThrow("subscription provider is invalid");
    for (const apiKey of ["", " padded ", "bad\0key", "x".repeat(64 * 1024)]) {
      await expect(createPrivatePiApiKeyAgentProvider({
        ...support,
        apiKey,
        provider: "openrouter",
        model: "test-model",
      })).rejects.toThrow("API credential is invalid");
    }
    await expect(createPrivatePiApiKeyAgentProvider({
      ...support,
      apiKey: "secret",
      provider: "openrouter",
      model: "invalid model",
    })).rejects.toThrow("Pi model is invalid");
  });
});

function startupJson(startup: Uint8Array): unknown {
  const size = new DataView(startup.buffer, startup.byteOffset, 4).getUint32(0, false);
  expect(size).toBe(startup.byteLength - 4);
  return JSON.parse(decoder.decode(startup.slice(4)));
}

function environment(provider: string, model: string, subscription = false) {
  return {
    HOME: "/tmp/pi-home",
    JIG_PI_MODEL: model,
    JIG_PI_PROVIDER: provider,
    JIG_PI_STARTUP_INPUT: subscription ? "subscription" : "api-key",
    NO_BROWSER: "1",
    PI_ACP_PI_COMMAND: "/agent/pi-agent-launcher.js",
    PI_CODING_AGENT_DIR: "/tmp/pi-agent",
    PI_OFFLINE: "1",
    SSL_CERT_FILE: "/etc/ssl/certs/ca-certificates.crt",
  };
}

async function files(): Promise<PrivatePiAgentSupportFixture> {
  const root = await mkdtemp(join(tmpdir(), "jig-pi-provider-"));
  temporary.add(root);
  const releaseRoot = join(root, "release");
  const agentRoot = join(releaseRoot, "libexec", "agent");
  const launcherPath = join(agentRoot, "pi-agent-launcher.js");
  const adapterPath = join(agentRoot, "pi-acp.js");
  const nativeRoot = join(root, "native-pi");
  const executablePath = join(nativeRoot, "pi");
  const manifestPath = join(nativeRoot, "package.json");
  const darkThemePath = join(nativeRoot, "theme", "dark.json");
  const lightThemePath = join(nativeRoot, "theme", "light.json");
  const certificatesPath = await realpath("/etc/ssl/certs/ca-certificates.crt");
  await Promise.all([
    mkdir(agentRoot, { recursive: true }),
    mkdir(join(nativeRoot, "theme"), { recursive: true }),
  ]);
  await Promise.all([
    writeFile(launcherPath, "launcher\n", { mode: 0o700 }),
    writeFile(adapterPath, "adapter\n"),
    writeFile(executablePath, "pi\n", { mode: 0o700 }),
    writeFile(manifestPath, JSON.stringify({
      name: "@earendil-works/pi-coding-agent",
      version: "0.84.4",
    })),
    writeFile(darkThemePath, "{}\n"),
    writeFile(lightThemePath, "{}\n"),
  ]);
  return {
    launcherPath,
    adapterPath,
    executablePath,
    manifestPath,
    darkThemePath,
    lightThemePath,
    certificatesPath,
  };
}

interface PrivatePiAgentSupportFixture {
  readonly launcherPath: string;
  readonly adapterPath: string;
  readonly executablePath: string;
  readonly manifestPath: string;
  readonly darkThemePath: string;
  readonly lightThemePath: string;
  readonly certificatesPath: string;
}
