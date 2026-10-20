import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

// Resolve the declared external SDK through its public package entrypoint.
export const flowSdkRuntimeDirectory = dirname(fileURLToPath(import.meta.resolve('@jigging/flow')))
export const flowSdkDirectory = dirname(flowSdkRuntimeDirectory)
