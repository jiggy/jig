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

  export interface JigDefinition {
    readonly catalogues: Readonly<Record<string, CatalogueDirectorySource>>;
    readonly bindings: BindingDirectorySource;
  }

  export interface PackageBindingDefinition {
    readonly use: string;
    readonly settings?: Readonly<Record<string, JsonValue>>;
  }

  export const catalogue: {
    directory(path: string): CatalogueDirectorySource;
  };

  export const bindingSources: {
    directory(path: string): BindingDirectorySource;
  };

  export function defineJig<T extends JigDefinition>(definition: T): Readonly<T>;

  export function bind<T extends PackageBindingDefinition>(
    definition: T,
  ): Readonly<T>;
}
