// DESIGN PROBE ONLY: runtime globals not provided by this probe's TS libs.

declare interface AbortSignal {
  readonly aborted: boolean;
}

declare const Deno: {
  readTextFile(path: string): Promise<string>;
};
