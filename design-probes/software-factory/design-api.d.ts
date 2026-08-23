// DESIGN PROBE ONLY.
// Declaration shapes support editor/type review and contain no implementation.

declare module "jig" {
  export type JsonPrimitive = null | boolean | number | string;

  export type JsonValue =
    | JsonPrimitive
    | readonly JsonValue[]
    | { readonly [name: string]: JsonValue };

  export interface CatalogueDirectorySource {
    readonly kind: "catalogue-directory";
    readonly path: string;
  }

  export interface BindingDirectorySource {
    readonly kind: "binding-directory";
    readonly path: string;
  }

  export interface HookDirectorySource {
    readonly kind: "hook-directory";
    readonly path: string;
  }

  export interface SemanticResolverDefinition {
    readonly kind: "semantic-resolver";
    readonly using: string;
  }

  export interface JigDefinition {
    readonly catalogues?: Readonly<Record<string, CatalogueDirectorySource>>;
    readonly bindings?: BindingDirectorySource;
    readonly hooks?: HookDirectorySource;
    readonly resolver?: SemanticResolverDefinition;
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

  export interface DiscoveredFlowReference {
    readonly kind: "discovered-flow";
    readonly candidates: readonly string[];
  }

  export interface InstructionConfiguration {
    readonly agent: BindingReference;
  }

  export interface BindingDefinition {
    readonly use: string | HostCapabilityReference;
    readonly settings?: Readonly<Record<string, JsonValue>>;
    readonly slots?: Readonly<
      Record<string, BindingReference | DiscoveredFlowReference>
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

  export const catalogue: {
    directory(path: string): CatalogueDirectorySource;
  };

  export const bindingSources: {
    directory(path: string): BindingDirectorySource;
  };

  export const hookSources: {
    directory(path: string): HookDirectorySource;
  };

  export function semanticResolver(definition: {
    readonly using: string;
  }): SemanticResolverDefinition;

  export function defineJig<T extends JigDefinition>(definition: T): Readonly<T>;

  export function bind<T extends BindingDefinition>(definition: T): Readonly<T>;

  export function hook<T extends HookDefinition>(definition: T): Readonly<T>;

  export function hostCapability(
    provider: string,
    selection: { readonly export: string },
  ): HostCapabilityReference;

  export function bindingRef(binding: string): BindingReference;

  export function root(path: string): AttachmentRoot;

  export function discover(
    candidates: readonly string[],
  ): DiscoveredFlowReference;
}
