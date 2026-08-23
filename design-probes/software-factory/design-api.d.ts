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
    readonly semanticChoice?: string;
  }

  export interface HostCapabilityReference {
    readonly kind: "host-capability";
    readonly provider: string;
    readonly export: string;
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
    readonly candidates: readonly string[];
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
    readonly source:
      | { readonly binding: string }
      | { readonly kernel: string };
    readonly type: string;
    readonly target: string;
  }

  export function discover(
    roots: string | readonly string[],
  ): DiscoverySource;

  export function defineJig<T extends JigDefinition>(definition: T): Readonly<T>;

  export function bind<T extends BindingDefinition>(definition: T): Readonly<T>;

  export function hook<T extends HookDefinition>(definition: T): Readonly<T>;

  export function hostCapability(
    provider: string,
    selection: { readonly export: string },
  ): HostCapabilityReference;

  export function bindingRef(binding: string): BindingReference;

  export function root(path: string): AttachmentRoot;

  export function candidates(
    candidates: readonly string[],
  ): CandidateSetReference;
}
