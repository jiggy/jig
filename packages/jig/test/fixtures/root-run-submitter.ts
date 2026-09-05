import {
  openPrivateProjectCoordinator,
  submitPrivateRootRun,
} from '../../src/internal/activation-admission-store.js'

const [projectRoot, packageStoreRoot, submissionId] = process.argv.slice(2)
if (projectRoot === undefined || packageStoreRoot === undefined || submissionId === undefined) {
  throw new Error('usage: root-run-submitter <project-root> <package-store-root> <submission-id>')
}

const coordinator = await openPrivateProjectCoordinator({ projectRoot })
const submitted = await submitPrivateRootRun({
  coordinator,
  projectRoot,
  packageStoreRoot,
  submissionId,
  target: { kind: 'flow', path: 'flows/run' },
  input: { ticket: 'T-2' },
  deadlineUnixMs: Date.now() + 60_000,
})
if (submitted.launch === undefined) throw new Error('new READY submission omitted launch authority')
console.log(JSON.stringify({ runId: submitted.run.runId }))
await Bun.sleep(3_600_000)
