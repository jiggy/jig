// DESIGN PROBE ONLY: project authoring plus a candidate local embedding API.
declare module "@jigging/jig" {
  export type JsonValue = null | boolean | number | string |
    readonly JsonValue[] | { readonly [name: string]: JsonValue };

  export interface DiscoverySource {
    readonly kind: "directory-discovery";
    readonly root: string;
  }
  export interface BindingReference {
    readonly kind: "binding";
    readonly binding: string;
  }
  export interface AttachmentRoot {
    readonly kind: "root";
    readonly path: string;
  }
  export interface JigDefinition {
    readonly flows?: DiscoverySource | readonly string[];
    readonly bindings?: DiscoverySource | readonly string[];
  }
  export interface PackageBindingDefinition {
    readonly use: string;
    readonly settings: Readonly<Record<string, JsonValue>>;
    readonly slots?: Readonly<Record<string, BindingReference>>;
    readonly attachments?: Readonly<Record<string, AttachmentRoot>>;
  }

  export interface RunSnapshot {
    readonly runId: string;
    readonly bindingId: string;
    readonly state: "pending" | "running" | "succeeded" | "failed" |
      "cancelled" | "uncertain";
    readonly result?: { readonly outcome: string; readonly output: JsonValue };
    readonly failure?: { readonly code: string; readonly message: string };
  }
  export interface ProjectClient {
    readonly runs: {
      start(request: {
        readonly bindingId: string;
        readonly input: JsonValue;
        readonly submissionId: string;
      }): Promise<RunSnapshot>;
      get(runId: string): Promise<RunSnapshot>;
      cancel(request: {
        readonly runId: string;
        readonly cancellationId: string;
      }): Promise<RunSnapshot>;
    };
    close(): Promise<void>;
  }

  export function defineJig<T extends JigDefinition>(value: T): Readonly<T>;
  export function discover(root: string): DiscoverySource;
  export function bind(
    value: PackageBindingDefinition,
  ): Readonly<PackageBindingDefinition>;
  export function bindingRef(binding: string): BindingReference;
  export function root(path: string): AttachmentRoot;

  // Candidate spelling only. Opening and authority are host concerns; callers
  // do not submit a self-granting authority object.
  export function openProject(options: { readonly root: URL }): Promise<ProjectClient>;
}

declare const Bun: {
  file(path: string | URL): { exists(): Promise<boolean>; text(): Promise<string> };
  write(path: string, data: string): Promise<number>;
  serve(options: {
    hostname: string;
    port: number;
    fetch(request: Request): Response | Promise<Response>;
  }): { readonly port: number; stop(closeActiveConnections?: boolean): void };
};

declare const process: {
  on(signal: "SIGINT" | "SIGTERM", handler: () => void): void;
};
