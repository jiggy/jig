import { spawn } from 'node:child_process'
import { PrivateAcpSetupError } from './acp-setup-diagnostics.js'

/** The authenticated installed helper returns only a closed exit decision.
 * Fresh process state and a deadline keep this outside CF and provider caches.
 * No operator preference keys or values enter identity, output or diagnostics.
 */
export async function observePrivateMacosCodexPreferences(observerPath: string): Promise<void> {
  let child: ReturnType<typeof spawn> | undefined
  let closed: Promise<number | null> | undefined
  let timer: ReturnType<typeof setTimeout> | undefined
  let timedOut = false
  try {
    const observer = spawn(observerPath, [], { stdio: 'ignore', env: {} })
    child = observer
    closed = new Promise((resolve, reject) => {
      observer.once('error', reject)
      observer.once('close', (code, signal) => resolve(signal === null ? code : null))
    })
    timer = setTimeout(() => {
      timedOut = true
      child?.kill('SIGKILL')
    }, 5_000)
    const code = await closed
    if (timedOut) throw new PrivateAcpSetupError('preferences')
    if (code === 71) throw new PrivateAcpSetupError('managed-policy')
    if (code !== 0) throw new PrivateAcpSetupError('preferences')
  } catch (error) {
    if (error instanceof PrivateAcpSetupError) throw error
    throw new PrivateAcpSetupError('preferences')
  } finally {
    if (timer !== undefined) clearTimeout(timer)
    if (child !== undefined && child.exitCode === null && child.signalCode === null) {
      child.kill('SIGKILL')
      await closed?.catch(() => undefined)
    }
  }
}
