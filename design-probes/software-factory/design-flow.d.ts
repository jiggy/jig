// DESIGN PROBE ONLY: runtime globals not provided by this probe's TS libs.

declare const Deno: {
  readonly errors: {
    readonly NotFound: new (...arguments_: never[]) => Error;
  };
  readTextFile(path: string): Promise<string>;
  writeTextFile(path: string, data: string): Promise<void>;
  mkdir(path: string, options?: { recursive?: boolean }): Promise<void>;
  rename(oldPath: string, newPath: string): Promise<void>;
};
