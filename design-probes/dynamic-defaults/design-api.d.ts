// DESIGN PROBE ONLY: editor projection of the smallest future Jig surface used
// by this probe. These declarations contain no implementation.
declare module "@jigging/jig" {
  export type JsonValue =
    | null
    | boolean
    | number
    | string
    | readonly JsonValue[]
    | { readonly [name: string]: JsonValue };

  export interface DiscoverySource {
    readonly kind: "directory-discovery";
    readonly root: string;
  }

  export interface JigDefinition {
    readonly flows?: DiscoverySource | readonly string[];
    readonly bindings?: DiscoverySource | readonly string[];
  }

  export interface AllRunsReference {
    readonly kind: "all-runs";
  }

  export interface PackageBindingDefinition {
    readonly use: string;
    readonly settings?: Readonly<Record<string, JsonValue>>;
    readonly slots?: Readonly<Record<string, AllRunsReference>>;
  }

  export function discover(root: string): DiscoverySource;

  export function defineJig<T extends JigDefinition>(
    definition: T,
  ): Readonly<T>;

  export function bind(
    definition: PackageBindingDefinition,
  ): Readonly<PackageBindingDefinition>;

  export function allRuns(): AllRunsReference;
}
