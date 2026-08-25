import { describe, expect, test } from "bun:test";
import { constants, createReadStream } from "node:fs";
import {
  chmod,
  link,
  mkdir,
  mkdtemp,
  open,
  rename,
  rm,
  symlink,
  truncate,
  utimes,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { CheckError } from "../src/diagnostics.js";
import {
  capturePackageDirectory,
  captureOpenedPackageDirectory,
  type CapturedFile,
  type CapturedPackage,
} from "../src/package/capture.js";
import { packageDigest } from "../src/package/digest.js";

const metadata = "---\nname: x\ndescription: x\n---\n";

describe("Package/1 digest", () => {
  test("matches an independently generated fixed vector", async () => {
    await withDirectory(async (root) => {
      const flowPath = join(root, "FLOW.md");
      const binaryPath = join(root, "a.bin");
      await writeFile(flowPath, metadata);
      await writeFile(binaryPath, Uint8Array.of(0, 1, 255));
      const files: CapturedFile[] = [
        { path: "FLOW.md", size: Buffer.byteLength(metadata) },
        { path: "a.bin", size: 3 },
      ];
      const paths = new Map([["FLOW.md", flowPath], ["a.bin", binaryPath]]);
      expect(await packageDigest(files, (file) => createReadStream(paths.get(file.path)!))).toBe(
        "sha256:e12f178c28f22af5e4620ff41ed3aaca76f11103bb37bdc04ca1600857ae8b50",
      );
    });
  });

  test("length-prefixes paths and contents", async () => {
    await withDirectory(async (root) => {
      const first = join(root, "first");
      const second = join(root, "second");
      await writeFile(first, "bc");
      await writeFile(second, "c");
      const left = await packageDigest(
        [{ path: "a", size: 2 }],
        () => createReadStream(first),
      );
      const right = await packageDigest(
        [{ path: "ab", size: 1 }],
        () => createReadStream(second),
      );
      expect(left).not.toBe(right);
    });
  });

  test("canonicalizes record order before hashing", async () => {
    await withDirectory(async (root) => {
      const a = join(root, "a");
      const b = join(root, "b");
      await writeFile(a, "a");
      await writeFile(b, "b");
      const paths = new Map([["a", a], ["b", b]]);
      const read = (file: CapturedFile) => createReadStream(paths.get(file.path)!);
      const canonical = await packageDigest([{ path: "a", size: 1 }, { path: "b", size: 1 }], read);
      const reversed = await packageDigest([{ path: "b", size: 1 }, { path: "a", size: 1 }], read);
      expect(reversed).toBe(canonical);
    });
  });
});

const linuxTest = process.platform === "linux" ? test : test.skip;

describe("Linux Package/1 directory capture", () => {
  linuxTest("captures every regular file in canonical byte order and isolates staged bytes", async () => {
    await withDirectory(async (source) => {
      await writeFile(join(source, "z.txt"), "old");
      await mkdir(join(source, "empty"));
      await mkdir(join(source, "nested"));
      await writeFile(join(source, "nested", ".hidden"), "hidden");
      await writeFile(join(source, "FLOW.md"), metadata);

      await withCapture(source, async (captured) => {
        expect("stageRoot" in captured).toBe(false);
        expect("stagedPath" in captured.files[0]!).toBe(false);
        expect(captured.files.map((file) => file.path)).toEqual([
          "FLOW.md",
          "nested/.hidden",
          "z.txt",
        ]);
        await writeFile(join(source, "z.txt"), "new");
        expect(new TextDecoder().decode(await captured.read("z.txt"))).toBe("old");
        expect(await captured.read("nested/.hidden")).toEqual(new TextEncoder().encode("hidden"));
      });
    });
  });

  linuxTest("ignores enumeration order and filesystem metadata in identity", async () => {
    await withDirectory(async (left) => {
      await withDirectory(async (right) => {
        await writeFile(join(left, "FLOW.md"), metadata);
        await writeFile(join(left, "file"), "same");
        await writeFile(join(right, "file"), "same");
        await writeFile(join(right, "FLOW.md"), metadata);
        await chmod(join(right, "file"), 0o700);
        await utimes(join(right, "file"), new Date(1_000), new Date(2_000));

        await withCapture(left, async (first) => {
          await withCapture(right, async (second) => {
            expect(first.digest).toBe(second.digest);
          });
        });
      });
    });
  });

  linuxTest("changes identity for content, path, extra files, and line endings", async () => {
    const digests = new Set<string>();
    for (const files of [
      { "FLOW.md": metadata, file: "one" },
      { "FLOW.md": metadata, file: "two" },
      { "FLOW.md": metadata, renamed: "one" },
      { "FLOW.md": metadata, file: "one", extra: "" },
      { "FLOW.md": metadata.replaceAll("\n", "\r\n"), file: "one" },
    ]) {
      await withDirectory(async (source) => {
        for (const [path, content] of Object.entries(files)) {
          await writeFile(join(source, path), content);
        }
        await withCapture(source, async (captured) => {
          digests.add(captured.digest);
        });
      });
    }
    expect(digests.size).toBe(5);
  });

  linuxTest("accepts fully contained hardlinks as independent records", async () => {
    await withDirectory(async (source) => {
      await writeFile(join(source, "FLOW.md"), metadata);
      await writeFile(join(source, "a"), "shared");
      await link(join(source, "a"), join(source, "b"));
      await withCapture(source, async (captured) => {
        expect(captured.files.map((file) => file.path)).toEqual(["FLOW.md", "a", "b"]);
        expect(await captured.read("a")).toEqual(await captured.read("b"));
      });
    });
  });

  linuxTest("rejects symlinks, escaping hardlinks, and case-fold collisions", async () => {
    await withDirectory(async (root) => {
      const outside = join(root, "outside");
      await writeFile(outside, "outside");

      const symlinkPackage = join(root, "symlink-package");
      await mkdir(symlinkPackage);
      await writeFile(join(symlinkPackage, "FLOW.md"), metadata);
      await symlink(outside, join(symlinkPackage, "linked"));
      await expectCaptureError(symlinkPackage, "PACKAGE_SYMLINK");

      const hardlinkPackage = join(root, "hardlink-package");
      await mkdir(hardlinkPackage);
      await writeFile(join(hardlinkPackage, "FLOW.md"), metadata);
      await link(outside, join(hardlinkPackage, "linked"));
      await expectCaptureError(hardlinkPackage, "PACKAGE_HARDLINK");

      const collisionPackage = join(root, "collision-package");
      await mkdir(collisionPackage);
      await writeFile(join(collisionPackage, "FLOW.md"), metadata);
      await writeFile(join(collisionPackage, "Readme"), "first");
      await writeFile(join(collisionPackage, "README"), "second");
      await expectCaptureError(collisionPackage, "PACKAGE_PATH_COLLISION");
    });
  });

  linuxTest("rejects a symlink as the selected source root", async () => {
    await withDirectory(async (root) => {
      const source = join(root, "source");
      const alias = join(root, "alias");
      await mkdir(source);
      await writeFile(join(source, "FLOW.md"), metadata);
      await symlink(source, alias);
      await expectCaptureError(alias, "PACKAGE_ROOT");
    });
  });

  linuxTest("captures an opened directory identity rather than a replaced pathname", async () => {
    await withDirectory(async (root) => {
      const selected = join(root, "selected");
      const moved = join(root, "moved");
      await mkdir(selected);
      await writeFile(join(selected, "FLOW.md"), metadata);
      await writeFile(join(selected, "value.txt"), "original");

      const handle = await open(
        selected,
        constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW,
      );
      try {
        await rename(selected, moved);
        await mkdir(selected);
        await writeFile(join(selected, "FLOW.md"), metadata);
        await writeFile(join(selected, "value.txt"), "replacement");

        const captured = await captureOpenedPackageDirectory("flows/selected", handle);
        try {
          expect(new TextDecoder().decode(await captured.read("value.txt"))).toBe("original");
          expect(captured.sourceLabel).toBe("flows/selected");
          expect((await handle.stat()).isDirectory()).toBeTrue();
        } finally {
          await captured.dispose();
        }
      } finally {
        await handle.close();
      }
    });
  });

  linuxTest("rejects a non-UTF-8 directory entry without decoded replacement", async () => {
    await withDirectory(async (source) => {
      await writeFile(join(source, "FLOW.md"), metadata);
      const invalidPath = Buffer.concat([Buffer.from(`${source}/`), Buffer.from([0xff])]);
      await writeFile(invalidPath, "invalid name");
      await expectCaptureError(source, "PACKAGE_PATH_UTF8");
    });
  });

  linuxTest("rejects a file one byte above the absolute Package/1 ceiling before copying", async () => {
    await withDirectory(async (source) => {
      await writeFile(join(source, "FLOW.md"), metadata);
      const oversized = join(source, "oversized.bin");
      await writeFile(oversized, "");
      await truncate(oversized, 1_073_741_825);
      await expectCaptureError(source, "PACKAGE_LIMIT");
    });
  });
});

async function withDirectory(action: (path: string) => Promise<void>): Promise<void> {
  const path = await mkdtemp(join(tmpdir(), "jig-package-test-"));
  try {
    await action(path);
  } finally {
    await rm(path, { recursive: true, force: true });
  }
}

async function withCapture(
  source: string,
  action: (captured: CapturedPackage) => Promise<void>,
): Promise<void> {
  const captured = await capturePackageDirectory(source);
  try {
    await action(captured);
  } finally {
    await captured.dispose();
  }
}

async function expectCaptureError(source: string, code: string): Promise<void> {
  try {
    const captured = await capturePackageDirectory(source);
    await captured.dispose();
    throw new Error("expected CheckError");
  } catch (error) {
    expect(error).toBeInstanceOf(CheckError);
    expect((error as CheckError).code).toBe(code);
  }
}
