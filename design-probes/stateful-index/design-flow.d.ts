// DESIGN PROBE ONLY: FLOW SDK declarations are shared one directory above.

declare module "node:fs/promises" {
  export function mkdir(
    path: string,
    options?: { readonly recursive?: boolean },
  ): Promise<void>;
  export function rename(from: string, to: string): Promise<void>;
}

declare const Bun: {
  file(path: string): {
    exists(): Promise<boolean>;
    text(): Promise<string>;
  };
  write(path: string, data: string): Promise<number>;
};
