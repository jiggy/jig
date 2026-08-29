import vm from "node:vm";

import { canonicalJson, type JsonValue } from "../json.js";

const PROTOCOL = "jig-author-evaluator/1";
const MAX_REQUEST_BYTES = 2 * 1024 * 1024;
const VM_TIMEOUT_MS = 1_000;
const SDK_ENTRY = "/jig-evaluator/internal/project-evaluator-sdk.bundle.js";
const HOOK_SDK_ENTRY = "/jig-evaluator/internal/experimental-hook-evaluator-sdk.bundle.js";
const PROJECT_RUN_TARGETS_SDK_ENTRY =
  "/jig-evaluator/internal/private-project-run-targets-evaluator-sdk.bundle.js";
type AuthoringProfile =
  | "project-authoring/1"
  | "private-project-authoring-hooks/1"
  | "private-project-run-targets-authoring/1";
const EVALUATION_CODES = new Set([
  "PROJECT_AUTHORING_VALUE",
  "PROJECT_DEFAULT_EXPORT",
  "PROJECT_EVALUATION_FAILED",
  "PROJECT_EVALUATION_LIMIT",
  "PROJECT_EVALUATOR_COMPILE",
  "PROJECT_EVALUATOR_IMPORT",
  "PROJECT_EVALUATOR_PROTOCOL",
]);

interface WorkerRequest {
  readonly protocol: typeof PROTOCOL;
  readonly authoringProfile: AuthoringProfile;
  readonly entryProjectPath: string;
  readonly modules: readonly WorkerModule[];
}

interface WorkerModule {
  readonly projectPath: string;
  readonly source: string;
  readonly imports: readonly WorkerImport[];
}

interface WorkerImport {
  readonly specifier: string;
  readonly projectPath: string;
}

interface BuildMessage {
  readonly message?: string;
}

interface BuildOutput {
  text(): Promise<string>;
}

interface BuildResult {
  readonly success: boolean;
  readonly logs: readonly BuildMessage[];
  readonly outputs: readonly BuildOutput[];
}

interface PluginBuilder {
  onResolve(
    options: { readonly filter: RegExp; readonly namespace?: string },
    callback: (arguments_: {
      readonly path: string;
      readonly namespace: string;
      readonly importer: string;
      readonly kind: string;
    }) =>
      { readonly path: string; readonly namespace?: string } | undefined,
  ): void;
  onLoad(
    options: { readonly filter: RegExp; readonly namespace?: string },
    callback: (arguments_: { readonly path: string }) =>
      { readonly loader: "ts" | "js"; readonly contents: string } | undefined,
  ): void;
}

interface BunRuntime {
  readonly stdin: { arrayBuffer(): Promise<ArrayBuffer> };
  file(path: string): { text(): Promise<string> };
  build(options: {
    readonly entrypoints: readonly string[];
    readonly format: "cjs";
    readonly target: "bun";
    readonly write: false;
    readonly sourcemap: "none";
    readonly plugins: readonly {
      readonly name: string;
      setup(builder: PluginBuilder): void;
    }[];
  }): Promise<BuildResult>;
}

const runtime = (globalThis as unknown as { readonly Bun: BunRuntime }).Bun;

try {
  const request = await readRequest();
  const code = await build(request);
  const value = evaluate(code);
  write({ protocol: PROTOCOL, status: "ok", value } as unknown as JsonValue);
} catch (error) {
  write({
    protocol: PROTOCOL,
    status: "error",
    code: errorCode(error),
    message: boundedMessage(error),
  });
}

async function readRequest(): Promise<WorkerRequest> {
  const bytes = new Uint8Array(await runtime.stdin.arrayBuffer());
  if (bytes.byteLength === 0 || bytes.byteLength > MAX_REQUEST_BYTES) {
    throw tagged("PROJECT_EVALUATION_LIMIT", "evaluator request exceeds its byte bound");
  }
  let value: unknown;
  try {
    value = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch {
    throw tagged("PROJECT_EVALUATOR_PROTOCOL", "evaluator request is not valid JSON");
  }
  if (!isRecord(value) || value.protocol !== PROTOCOL ||
      !isAuthoringProfile(value.authoringProfile) ||
      typeof value.entryProjectPath !== "string" || !Array.isArray(value.modules) ||
      Object.keys(value).length !== 4) {
    throw tagged("PROJECT_EVALUATOR_PROTOCOL", "evaluator request has an invalid shape");
  }
  const paths = new Set<string>();
  const modules: WorkerModule[] = [];
  for (const candidate of value.modules) {
    if (!isRecord(candidate) || typeof candidate.projectPath !== "string" ||
        typeof candidate.source !== "string" || !Array.isArray(candidate.imports) ||
        Object.keys(candidate).length !== 3 || paths.has(candidate.projectPath)) {
      throw tagged("PROJECT_EVALUATOR_PROTOCOL", "evaluator module has an invalid shape");
    }
    paths.add(candidate.projectPath);
    const imports: WorkerImport[] = [];
    const edges = new Set<string>();
    for (const edge of candidate.imports) {
      if (!isRecord(edge) || typeof edge.specifier !== "string" ||
          typeof edge.projectPath !== "string" || Object.keys(edge).length !== 2) {
        throw tagged("PROJECT_EVALUATOR_PROTOCOL", "evaluator import has an invalid shape");
      }
      const key = `${edge.specifier}\0${edge.projectPath}`;
      if (edges.has(key)) {
        throw tagged("PROJECT_EVALUATOR_PROTOCOL", "evaluator request repeats an import edge");
      }
      edges.add(key);
      imports.push({ specifier: edge.specifier, projectPath: edge.projectPath });
    }
    modules.push({
      projectPath: candidate.projectPath,
      source: candidate.source,
      imports,
    });
  }
  if (!paths.has(value.entryProjectPath)) {
    throw tagged("PROJECT_EVALUATOR_PROTOCOL", "evaluator entry is absent from its module closure");
  }
  for (const module of modules) {
    for (const edge of module.imports) {
      if (!paths.has(edge.projectPath)) {
        throw tagged("PROJECT_EVALUATOR_PROTOCOL", "evaluator import target is absent from its module closure");
      }
    }
  }
  return {
    protocol: PROTOCOL,
    authoringProfile: value.authoringProfile,
    entryProjectPath: value.entryProjectPath,
    modules,
  };
}

async function build(request: WorkerRequest): Promise<string> {
  const sdkSource = await runtime.file(SDK_ENTRY).text();
  const hookSdkSource = await runtime.file(HOOK_SDK_ENTRY).text();
  const projectRunTargetsSdkSource = await runtime.file(PROJECT_RUN_TARGETS_SDK_ENTRY).text();
  const modules = new Map(request.modules.map((module) => [module.projectPath, module]));
  const edges = new Map<string, string>();
  for (const module of request.modules) {
    for (const edge of module.imports) {
      edges.set(`${module.projectPath}\0${edge.specifier}`, edge.projectPath);
    }
  }
  const bridge = [
    'import * as declaration from "jig-author:entry";',
    'const keys = Object.keys(declaration);',
    'if (keys.length !== 1 || keys[0] !== "default") {',
    '  const error = new Error("author module must export only default");',
    '  error.code = "PROJECT_DEFAULT_EXPORT";',
    '  throw error;',
    '}',
    "export default declaration.default;",
  ].join("\n");

  let result: BuildResult;
  try {
    result = await runtime.build({
      entrypoints: ["jig-author:bridge"],
      format: "cjs",
      target: "bun",
      write: false,
      sourcemap: "none",
      plugins: [{
      name: "jig-closed-author-module",
      setup(builder): void {
        builder.onResolve({ filter: /^jig-author:bridge$/ }, (arguments_) => {
          if (arguments_.kind !== "entry-point-build" || arguments_.importer !== "") {
            throw deniedImport(arguments_.path);
          }
          return { path: arguments_.path, namespace: "jig-author" };
        });
        builder.onResolve({ filter: /^jig-author:entry$/ }, (arguments_) => {
          if (arguments_.kind !== "import-statement" ||
              arguments_.importer !== "jig-author:bridge") {
            throw deniedImport(arguments_.path);
          }
          return { path: request.entryProjectPath, namespace: "jig-project" };
        });
        builder.onResolve({ filter: /^jig-author:/ }, (arguments_) => {
          throw deniedImport(arguments_.path);
        });
        builder.onLoad({ filter: /^jig-author:bridge$/, namespace: "jig-author" }, () => ({
          loader: "ts",
          contents: bridge,
        }));
        // Bun 1.3 reports the importer namespace as `file` for imports parsed
        // from a custom-namespace onLoad result. Importer identity, not that
        // reported namespace, is therefore the closed authority check.
        builder.onResolve({ filter: /^@jigging\/jig$/ }, (arguments_) => {
          if (arguments_.kind !== "import-statement" ||
              !modules.has(arguments_.importer)) {
            throw deniedImport(arguments_.path);
          }
          return { path: "sdk", namespace: "jig-sealed" };
        });
        builder.onResolve({ filter: /^@jigging\/jig\/experimental\/hooks$/ }, (arguments_) => {
          if (arguments_.kind !== "import-statement" ||
              !modules.has(arguments_.importer) ||
              request.authoringProfile !== "private-project-authoring-hooks/1") {
            throw deniedImport(arguments_.path);
          }
          return { path: "hook-sdk", namespace: "jig-sealed" };
        });
        builder.onResolve({ filter: /^@jigging\/jig\/private\/project-run-targets$/ }, (arguments_) => {
          if (arguments_.kind !== "import-statement" ||
              !modules.has(arguments_.importer) ||
              request.authoringProfile !== "private-project-run-targets-authoring/1") {
            throw deniedImport(arguments_.path);
          }
          return { path: "project-run-targets-sdk", namespace: "jig-sealed" };
        });
        builder.onLoad({ filter: /^sdk$/, namespace: "jig-sealed" }, () => ({
          loader: "js",
          contents: sdkSource,
        }));
        builder.onLoad({ filter: /^hook-sdk$/, namespace: "jig-sealed" }, () => ({
          loader: "js",
          contents: hookSdkSource,
        }));
        builder.onLoad({ filter: /^project-run-targets-sdk$/, namespace: "jig-sealed" }, () => ({
          loader: "js",
          contents: projectRunTargetsSdkSource,
        }));
        builder.onResolve({ filter: /.*/, namespace: "jig-sealed" }, (arguments_) => {
          throw deniedImport(arguments_.path);
        });
        builder.onResolve({ filter: /.*/ }, (arguments_) => {
          if (arguments_.kind !== "import-statement") {
            throw deniedImport(`${arguments_.path} (${arguments_.kind} from ${arguments_.importer})`);
          }
          if (!modules.has(arguments_.importer)) {
            throw deniedImport(`${arguments_.path} (from ${arguments_.importer})`);
          }
          const target = edges.get(`${arguments_.importer}\0${arguments_.path}`);
          if (target === undefined || !modules.has(target)) {
            throw deniedImport(`${arguments_.path} (from ${arguments_.importer})`);
          }
          return { path: target, namespace: "jig-project" };
        });
        builder.onLoad({ filter: /.*/, namespace: "jig-project" }, (arguments_) => {
          const module = modules.get(arguments_.path);
          if (module === undefined) return undefined;
          return { loader: "ts", contents: module.source };
        });
        builder.onResolve({ filter: /.*/, namespace: "jig-author" }, (arguments_) => {
          throw deniedImport(arguments_.path);
        });
      },
      }],
    });
  } catch (error) {
    const message = boundedMessage(error);
    throw tagged(
      message.includes("ResolveMessage") || message.includes("Could not resolve")
        || message.includes("[PROJECT_EVALUATOR_IMPORT]")
        ? "PROJECT_EVALUATOR_IMPORT"
        : "PROJECT_EVALUATOR_COMPILE",
      message,
    );
  }
  if (!result.success || result.outputs.length !== 1) {
    const detail = result.logs.map((log) => log.message ?? "compile failure").join("; ");
    throw tagged(
      detail.includes("[PROJECT_EVALUATOR_IMPORT]")
        ? "PROJECT_EVALUATOR_IMPORT"
        : "PROJECT_EVALUATOR_COMPILE",
      detail || "author module did not compile",
    );
  }
  return await result.outputs[0]!.text();
}

function isAuthoringProfile(value: unknown): value is AuthoringProfile {
  return value === "project-authoring/1" ||
    value === "private-project-authoring-hooks/1" ||
    value === "private-project-run-targets-authoring/1";
}

function deniedImport(path: string): Error & { readonly code: string } {
  return tagged(
    "PROJECT_EVALUATOR_IMPORT",
    `[PROJECT_EVALUATOR_IMPORT] author module import is outside the one-module checkpoint: ${path}`,
  );
}

function evaluate(code: string): JsonValue {
  // No outer-realm object or callable enters this context. Injecting even a
  // harmless-looking host constructor would expose its Function constructor,
  // and therefore the worker's stdout and process.exit, to authored code.
  const context = vm.createContext(Object.create(null), {
    codeGeneration: { strings: false, wasm: false },
    name: "jig-author-declaration",
  });
  new vm.Script(guestBootstrap(), { filename: "/jig-bootstrap.js" }).runInContext(context, {
    timeout: VM_TIMEOUT_MS,
  });
  const invocation = `${code}\n(__jigModule.exports, __jigRequire, __jigModule, "/author.ts", "/");`;
  new vm.Script(invocation, { filename: "/author.ts" }).runInContext(context, {
    timeout: VM_TIMEOUT_MS,
  });
  const exports = new vm.Script("__jigModule.exports").runInContext(context, {
    timeout: VM_TIMEOUT_MS,
  }) as unknown;
  if (!isRecord(exports) || Object.keys(exports).length !== 1 || !("default" in exports)) {
    throw tagged("PROJECT_DEFAULT_EXPORT", "compiled author module did not expose one default value");
  }
  // The guest SDK has already copied and frozen this value. Canonicalization
  // immediately turns the cross-realm value into plain worker-owned JSON.
  return JSON.parse(new TextDecoder().decode(canonicalJson(exports.default as JsonValue))) as JsonValue;
}

function guestBootstrap(): string {
  return `
"use strict";
globalThis.process = Object.freeze({
  versions: Object.freeze({ unicode: "15.1" }),
});
globalThis.__jigModule = { exports: {} };
globalThis.__jigRequire = function __jigRequire() {
  const error = new Error("CommonJS require is unavailable");
  error.code = "PROJECT_EVALUATOR_IMPORT";
  throw error;
};
globalThis.TextEncoder = class TextEncoder {
  encode(value = "") {
    const input = String(value);
    const bytes = [];
    for (let index = 0; index < input.length; index += 1) {
      let point = input.charCodeAt(index);
      if (point >= 0xd800 && point <= 0xdbff) {
        const next = input.charCodeAt(index + 1);
        if (next >= 0xdc00 && next <= 0xdfff) {
          point = 0x10000 + ((point - 0xd800) << 10) + (next - 0xdc00);
          index += 1;
        } else {
          point = 0xfffd;
        }
      } else if (point >= 0xdc00 && point <= 0xdfff) {
        point = 0xfffd;
      }
      if (point <= 0x7f) bytes.push(point);
      else if (point <= 0x7ff) {
        bytes.push(0xc0 | (point >> 6), 0x80 | (point & 0x3f));
      } else if (point <= 0xffff) {
        bytes.push(0xe0 | (point >> 12), 0x80 | ((point >> 6) & 0x3f), 0x80 | (point & 0x3f));
      } else {
        bytes.push(
          0xf0 | (point >> 18),
          0x80 | ((point >> 12) & 0x3f),
          0x80 | ((point >> 6) & 0x3f),
          0x80 | (point & 0x3f),
        );
      }
    }
    return new Uint8Array(bytes);
  }
};
globalThis.TextDecoder = class TextDecoder {
  constructor(label = "utf-8") {
    if (String(label).toLowerCase() !== "utf-8") throw new RangeError("only UTF-8 is available");
  }
  decode() {
    throw new TypeError("TextDecoder.decode is unavailable in the authoring realm");
  }
};
Object.freeze(globalThis.process);
Object.freeze(globalThis.TextEncoder);
Object.freeze(globalThis.TextDecoder);
`;
}

function write(value: JsonValue): void {
  process.stdout.write(canonicalJson(value));
}

function tagged(code: string, message: string): Error & { readonly code: string } {
  return Object.assign(new Error(message), { code });
}

function errorCode(error: unknown): string {
  if (typeof error === "object" && error !== null && "code" in error &&
      error.code === "ERR_SCRIPT_EXECUTION_TIMEOUT") {
    return "PROJECT_EVALUATION_LIMIT";
  }
  if (typeof error === "object" && error !== null && "code" in error &&
      typeof error.code === "string" && EVALUATION_CODES.has(error.code)) {
    return error.code;
  }
  if (error instanceof TypeError) return "PROJECT_AUTHORING_VALUE";
  return "PROJECT_EVALUATION_FAILED";
}

function boundedMessage(error: unknown): string {
  let message: string;
  try {
    if (error instanceof AggregateError) {
      message = [error.message, ...error.errors.map((item) =>
        item instanceof Error ? item.message : String(item))].join(": ");
    } else {
      message = error instanceof Error ? error.message : String(error);
    }
  } catch {
    message = "author evaluation failed";
  }
  return message.slice(0, 4_096);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
