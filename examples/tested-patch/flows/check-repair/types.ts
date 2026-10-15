export type CapturedProject = {
  issue: string
  editPaths: string[]
  files: Record<string, string>
  cases: {
    id: string
    args: string[]
    stdin: string
    stdout: string
    stderr: string
    exitCode: number
  }[]
}
export type Replacement = { path: string; content: string }
export type Check = {
  accepted: boolean
  repositoryTestsPassed: boolean
  acceptance: { id: string; passed: boolean }[]
}
export type Command = {
  candidateDigest: string
  stdinDigest: string
  invocation: string[]
  cleanup: string
  stopReason: string
  exitCode: number | null
  signal: string | null
  stdout: { text: string; truncated: boolean }
  stderr: { text: string; truncated: boolean }
}
export type Evaluation = Check & { candidateDigest: string; commands: Command[] }
export type Attempt = {
  proposal?: { replacements: Replacement[] }
  invalidProposal?: string
  candidateDigest?: string
  evaluation?: Evaluation
}
export type RepairEvidence = {
  baseDigest: string
  acceptanceDigest: string
  reason: string
  baseline: Evaluation
  attempts: Attempt[]
}
