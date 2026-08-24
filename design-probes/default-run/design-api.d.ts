// DESIGN PROBE ONLY: the smallest future Jig authoring projection used here.
declare module "@jigging/jig" {
  export interface DiscoverySource {
    readonly kind: "directory-discovery";
    readonly root: string;
  }

  export interface JigDefinition {
    readonly flows?: DiscoverySource | readonly string[];
  }

  export function discover(root: string): DiscoverySource;
  export function defineJig<T extends JigDefinition>(value: T): Readonly<T>;
}
