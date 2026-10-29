/** Inert Package/0 capacities shared by authoring and protected archive readers. */
export const PACKAGE_1_LIMITS = Object.freeze({
  files: 65_536,
  fileBytes: 1_073_741_824,
  totalBytes: 4_294_967_296,
})

export const PACKAGE_1_MAX_PATH_BYTES = 1_024
export const PACKAGE_1_HEADER_TEXT = 'FLOW-Package/0\0'
export const PACKAGE_1_COUNT_BYTES = 8
export const PACKAGE_1_RECORD_METADATA_BYTES = 1 + 4 + 8

export const PRIVATE_PACKAGE_ARTIFACT_STORE_LIMITS = Object.freeze({
  artifactBytes: 192 * 1024 * 1024,
  storeBytes: 1024 * 1024 * 1024,
})

/** Upper archive size for arbitrary valid paths within a content/file budget. */
export function maximumPackageArtifactBytes(contentBytes: number, files: number): number {
  return (
    PACKAGE_1_HEADER_TEXT.length +
    PACKAGE_1_COUNT_BYTES +
    files * (PACKAGE_1_RECORD_METADATA_BYTES + PACKAGE_1_MAX_PATH_BYTES) +
    contentBytes
  )
}
