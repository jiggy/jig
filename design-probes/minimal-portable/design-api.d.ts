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
  }

  export interface PackageBindingDefinition {
    readonly use: string;
    readonly settings?: Readonly<Record<string, JsonValue>>;
  }

  export function discover(
    roots: string | readonly string[],
  ): DiscoverySource;

  export function defineJig<T extends JigDefinition>(definition: T): Readonly<T>;

  export function bind<T extends PackageBindingDefinition>(
    definition: T,
  ): Readonly<T>;
}
