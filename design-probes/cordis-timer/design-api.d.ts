declare module "jig" {
  export type JsonValue = null | boolean | number | string |
    readonly JsonValue[] | { readonly [name: string]: JsonValue };
  export interface DiscoverySource { readonly kind: "directory"; readonly root: string }
  export interface BindingReference { readonly kind: "binding"; readonly binding: string }
  export interface HostProviderExport { readonly module: string; readonly export: string }
  export interface HostCapabilityReference { readonly kind: "host"; readonly registration: HostProviderExport }
  export interface EventSelector { readonly producer: BindingReference; readonly type: string }
  export interface JigDefinition {
    readonly flows?: DiscoverySource | readonly string[];
    readonly bindings?: DiscoverySource | readonly string[];
    readonly hooks?: DiscoverySource | readonly string[];
  }
  export interface BindingDefinition {
    readonly use: string | HostCapabilityReference;
    readonly settings: Readonly<Record<string, JsonValue>>;
    readonly slots?: Readonly<Record<string, BindingReference>>;
    readonly grants?: Readonly<Record<string, JsonValue>>;
  }
  export function defineJig<T extends JigDefinition>(value: T): Readonly<T>;
  export function discover(root: string): DiscoverySource;
  export function bind<T extends BindingDefinition>(value: T): Readonly<T>;
  export function bindingRef(binding: string): BindingReference;
  export function hostCapability(registration: HostProviderExport): HostCapabilityReference;
  export function event(producer: BindingReference, type: string): EventSelector;
  export function hook<T extends { readonly on: EventSelector; readonly run: BindingReference }>(value: T): Readonly<T>;
}

declare module "@jig/journal" {
  import type { HostProviderExport } from "jig";
  export const append: HostProviderExport;
}

