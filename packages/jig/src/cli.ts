#!/usr/bin/env bun

import { CheckError } from "./diagnostics.js";
import { BareInitError, initializeBareProject } from "./bare-init.js";
import { checkPackageDirectory, type InspectedPackage } from "./package/inspect.js";
import { SchemaDiagnostic } from "./schema/index.js";

const HELP = `Usage:
  jig init --bare <new-directory>
  jig package check <package-directory>

Creates one inert bare Jig project, or validates one inert FLOW package
snapshot. Neither command runs project or package code.`;

export async function main(arguments_: readonly string[] = process.argv.slice(2)): Promise<number> {
  if (arguments_.length === 1 && (arguments_[0] === "--help" || arguments_[0] === "-h")) {
    process.stdout.write(`${HELP}\n`);
    return 0;
  }
  if (arguments_.length === 3 && arguments_[0] === "init" && arguments_[1] === "--bare") {
    try {
      await initializeBareProject(arguments_[2]!);
      process.stdout.write("created bare Jig project\n");
      return 0;
    } catch (error) {
      if (error instanceof BareInitError) {
        process.stderr.write(renderDiagnostic(error.code, error.message));
        return error.kind === "invalid" ? 1 : 2;
      }
      process.stderr.write(renderDiagnostic(
        "JIG_INIT_UNAVAILABLE",
        "the destination cannot be initialized",
      ));
      return 2;
    }
  }
  if (arguments_.length !== 3 || arguments_[0] !== "package" || arguments_[1] !== "check") {
    process.stderr.write(`${HELP}\n`);
    return 2;
  }

  try {
    const checked = await checkPackageDirectory(arguments_[2]!);
    process.stdout.write(renderPackage(checked));
    return 0;
  } catch (error) {
    if (error instanceof CheckError) {
      process.stderr.write(renderDiagnostic(error.code, error.message, error.path));
      return error.kind === "invalid" ? 1 : 2;
    }
    if (error instanceof SchemaDiagnostic) {
      process.stderr.write(renderDiagnostic(error.code, error.message, error.path));
      return 1;
    }
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(renderDiagnostic("PACKAGE_CHECK_UNAVAILABLE", message));
    return 2;
  }
}

function renderPackage(checked: InspectedPackage): string {
  const implementation = checked.entrypoint === undefined
    ? "instruction"
    : `${checked.entrypoint.path}${
        checked.entrypoint.selector === undefined ? "" : ` (selector ${checked.entrypoint.selector})`
      }`;
  const schemas = Object.entries(checked.schemas).map(([name]) => `${name}.schema.json`);
  return [
    `valid FLOW ${checked.mode} package: ${checked.metadata.name}`,
    `digest: ${checked.digest}`,
    `implementation: ${implementation}`,
    `files: ${checked.fileCount} (${checked.contentBytes} bytes)`,
    `schemas: ${schemas.length === 0 ? "none" : schemas.join(", ")}`,
    `contracts: ${checked.usedContracts.length} used`,
    "",
  ].join("\n");
}

function renderDiagnostic(code: string, message: string, path?: string): string {
  return `${code}${path === undefined ? "" : ` [${path}]`}: ${message}\n`;
}

if (import.meta.main) {
  process.exitCode = await main();
}
