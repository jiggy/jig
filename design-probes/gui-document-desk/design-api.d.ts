// DESIGN PROBE ONLY: project authoring and host-local frontend projections.
declare module "jig" {
  export type JsonValue = null | boolean | number | string |
    readonly JsonValue[] | { readonly [name: string]: JsonValue };
  export interface DiscoverySource { readonly kind: "directory"; readonly root: string }
  export interface BindingReference { readonly kind: "binding"; readonly binding: string }
  export interface AttachmentRoot { readonly kind: "root"; readonly path: string }
  export interface HostProviderExport { readonly module: string; readonly export: string }
  export interface HostCapabilityReference { readonly kind: "host"; readonly registration: HostProviderExport }
  export interface JigDefinition {
    readonly flows?: DiscoverySource | readonly string[];
    readonly bindings?: DiscoverySource | readonly string[];
  }
  export interface BindingDefinition {
    readonly use: string | HostCapabilityReference;
    readonly settings: Readonly<Record<string, JsonValue>>;
    readonly slots?: Readonly<Record<string, BindingReference>>;
    readonly attachments?: Readonly<Record<string, AttachmentRoot>>;
    readonly grants?: Readonly<Record<string, JsonValue>>;
  }
  export function defineJig<T extends JigDefinition>(value: T): Readonly<T>;
  export function discover(root: string): DiscoverySource;
  export function bind<T extends BindingDefinition>(value: T): Readonly<T>;
  export function bindingRef(binding: string): BindingReference;
  export function root(path: string): AttachmentRoot;
  export function hostCapability(registration: HostProviderExport): HostCapabilityReference;
}

declare module "@jig/journal" {
  import type { HostProviderExport } from "jig";
  export const append: HostProviderExport;
}

declare module "@jig/client" {
  import type { JsonValue } from "jig";
  export interface RunSnapshot {
    readonly runId: string;
    readonly bindingId: string;
    readonly state: "pending" | "running" | "succeeded" | "failed" | "cancelled" | "uncertain";
    readonly result?: { readonly outcome: string; readonly output: JsonValue };
    readonly failure?: { readonly code: string; readonly message: string };
  }
  export interface JigEvent {
    readonly eventId: string;
    readonly journalPosition: number;
    readonly type: string;
    readonly source: string;
    readonly committedAtUnixMs: number;
    readonly data: JsonValue;
  }
  export interface ProjectClient {
    readonly runs: {
      start(request: { readonly bindingId: string; readonly input: JsonValue; readonly submissionId: string }): Promise<RunSnapshot>;
      get(runId: string): Promise<RunSnapshot>;
      cancel(request: { readonly runId: string; readonly cancellationId: string }): Promise<RunSnapshot>;
    };
    readonly events: {
      read(request: {
        readonly after: number;
        readonly limit: number;
        readonly types?: readonly string[];
        readonly sources?: readonly string[];
      }): Promise<{
        readonly events: readonly JigEvent[];
        readonly nextPosition: number;
        readonly minimumRetainedPosition: number;
        readonly more: boolean;
      }>;
    };
    close(): Promise<void>;
  }
  export function connectProject(options: {
    readonly root: URL;
    readonly authority: {
      readonly startBindings: readonly string[];
      readonly inspectSubmittedRuns: true;
      readonly cancelSubmittedRuns: true;
      readonly eventTypes: readonly string[];
    };
  }): Promise<ProjectClient>;
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
