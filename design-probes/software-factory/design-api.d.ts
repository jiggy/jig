// DESIGN PROBE ONLY.
// Declaration shapes support editor/type review and contain no implementation.

declare module "jig" {
  export type JsonPrimitive = null | boolean | number | string;

  export type JsonValue =
    | JsonPrimitive
    | readonly JsonValue[]
    | { readonly [name: string]: JsonValue };

  export interface DiscoverySource {
    readonly kind: "directory-discovery";
    readonly roots: readonly string[];
  }

  export interface JigDefinition {
    readonly flows?: DiscoverySource | readonly string[];
    readonly bindings?: DiscoverySource | readonly string[];
    readonly hooks?: DiscoverySource | readonly string[];
    readonly semanticChoice?: BindingReference;
  }

  export interface HostProviderExport {
    readonly kind: "host-provider-export";
    readonly module: string;
    readonly export: string;
  }

  export interface HostCapabilityReference {
    readonly kind: "host-capability";
    readonly registration: HostProviderExport;
  }

  export interface BindingReference {
    readonly kind: "binding-reference";
    readonly binding: string;
  }

  export interface AttachmentRoot {
    readonly kind: "project-root";
    readonly path: string;
  }

  export interface CandidateSetReference {
    readonly kind: "candidate-set";
    readonly candidates: readonly BindingReference[];
  }

  export interface InstructionConfiguration {
    readonly agent: BindingReference;
  }

  export interface BindingDefinition {
    readonly use: string | HostCapabilityReference;
    readonly settings?: Readonly<Record<string, JsonValue>>;
    readonly slots?: Readonly<
      Record<string, BindingReference | CandidateSetReference>
    >;
    readonly attachments?: Readonly<Record<string, AttachmentRoot>>;
    readonly grants?: Readonly<Record<string, JsonValue>>;
    readonly instruction?: InstructionConfiguration;
  }

  export interface HookDefinition {
    readonly on: EventSelector | EventSourceUse;
    readonly run: BindingReference;
  }

  export interface EventSelector {
    readonly kind: "event-selector";
    readonly producer: BindingReference | { readonly kernel: string };
    readonly type: string;
  }

  export interface EventSourceUse {
    readonly kind: "event-source-use";
    readonly registration: string;
    readonly eventType: string;
    readonly settings: Readonly<Record<string, JsonValue>>;
    readonly roots: Readonly<Record<string, AttachmentRoot>>;
  }

  export function discover(
    roots: string | readonly string[],
  ): DiscoverySource;

  export function defineJig<T extends JigDefinition>(definition: T): Readonly<T>;

  export function bind<T extends BindingDefinition>(definition: T): Readonly<T>;

  export function hook<T extends HookDefinition>(definition: T): Readonly<T>;

  export function hostCapability(
    registration: HostProviderExport,
  ): HostCapabilityReference;

  export function bindingRef(binding: string): BindingReference;

  export function root(path: string): AttachmentRoot;

  export function candidates(
    candidates: readonly BindingReference[],
  ): CandidateSetReference;

  export function event(
    producer: BindingReference | { readonly kernel: string },
    type: string,
  ): EventSelector;
}

declare module "@jig/agent-acp" {
  import type { HostProviderExport } from "jig";
  export const run: HostProviderExport;
}

declare module "@jig/semantic-choice" {
  import type { HostProviderExport } from "jig";
  export const chooseViaAgent: HostProviderExport;
}

declare module "@jig/hooks-files" {
  import type { AttachmentRoot, EventSourceUse } from "jig";

  export function stableTextFiles(options: {
    readonly root: AttachmentRoot;
    readonly suffix: string;
    readonly settleMs: number;
    readonly maxBytes: number;
    readonly maxScalars: number;
  }): EventSourceUse;
}
