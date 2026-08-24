// DESIGN PROBE ONLY: closed project-authoring surface used by this fixture.
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

  export interface BindingReference {
    readonly kind: "binding-reference";
    readonly binding: string;
  }

  export interface AttachmentRoot {
    readonly kind: "attachment-root";
    readonly path: string;
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

  export interface JigDefinition {
    readonly flows?: DiscoverySource | readonly string[];
    readonly bindings?: DiscoverySource | readonly string[];
    readonly hooks?: DiscoverySource | readonly string[];
  }

  export interface PackageBindingDefinition {
    readonly use: string;
    readonly settings: Readonly<Record<string, JsonValue>>;
    readonly slots?: Readonly<Record<string, BindingReference>>;
    readonly attachments?: Readonly<Record<string, AttachmentRoot>>;
  }

  export interface HostCapabilityBindingDefinition {
    readonly use: HostCapabilityReference;
    readonly settings: Readonly<Record<string, JsonValue>>;
    readonly slots?: Readonly<Record<string, BindingReference>>;
    readonly attachments?: Readonly<Record<string, AttachmentRoot>>;
    // Registration-specific attenuation, not a generic Jig permission map.
    // Omission is {} / least optional authority, never maximum authority.
    // The real provider token will carry the narrower static grants type.
    readonly grants?: Readonly<Record<string, JsonValue>>;
  }

  export type BindingDefinition =
    | PackageBindingDefinition
    | HostCapabilityBindingDefinition;

  export interface EventSelector {
    readonly kind: "event-selector";
    readonly producer: BindingReference;
    readonly type: string;
  }

  export interface HookDefinition {
    readonly on: EventSelector;
    readonly run: BindingReference;
  }

  export function defineJig<T extends JigDefinition>(definition: T): Readonly<T>;
  export function discover(root: string): DiscoverySource;
  export function bind(
    definition: PackageBindingDefinition,
  ): Readonly<PackageBindingDefinition>;

  export function bind(
    definition: HostCapabilityBindingDefinition,
  ): Readonly<HostCapabilityBindingDefinition>;
  export function bindingRef(binding: string): BindingReference;
  export function root(path: string): AttachmentRoot;
  export function hostCapability(
    registration: HostProviderExport,
  ): HostCapabilityReference;
  export function event(
    producer: BindingReference,
    type: string,
  ): EventSelector;
  export function hook<T extends HookDefinition>(definition: T): Readonly<T>;
}

declare module "@jigging/journal" {
  import type { HostProviderExport } from "@jigging/jig";
  export const append: HostProviderExport;
}
