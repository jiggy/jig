declare module "@jigging/jig" {
  export type JsonValue = null | boolean | number | string |
    readonly JsonValue[] | { readonly [name: string]: JsonValue };
  export interface DiscoverySource { readonly kind: "directory"; readonly root: string }
  export interface BindingReference { readonly kind: "binding"; readonly binding: string }
  export interface JigDefinition {
    readonly flows?: DiscoverySource | readonly string[];
    readonly bindings?: DiscoverySource | readonly string[];
  }
  export interface BindingDefinition {
    readonly use: string;
    readonly settings: Readonly<Record<string, JsonValue>>;
    readonly slots?: Readonly<Record<string, BindingReference>>;
  }
  export function defineJig<T extends JigDefinition>(value: T): Readonly<T>;
  export function discover(root: string): DiscoverySource;
  export function bind(value: BindingDefinition): Readonly<BindingDefinition>;
  export function bindingRef(binding: string): BindingReference;
}
