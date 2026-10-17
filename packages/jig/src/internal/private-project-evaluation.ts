export const PROJECT_EVALUATION_CONTRACT_ID = 'https://jig.md/contracts/project-evaluation'
export const PROJECT_EVALUATION_CONTRACT_VERSION = '0.1.0'
export const PROJECT_EVALUATION_CONTRACT_DIGEST =
  'sha256:34de8dfd2f60e4fd6dfdd884a2acb1deba0e3f8e27191fdc38d05b3e9edd7192'

export function isProjectEvaluationContract(value: {
  readonly id: unknown
  readonly version: unknown
  readonly digest: unknown
}): boolean {
  return (
    value.id === PROJECT_EVALUATION_CONTRACT_ID &&
    value.version === PROJECT_EVALUATION_CONTRACT_VERSION &&
    value.digest === PROJECT_EVALUATION_CONTRACT_DIGEST
  )
}
