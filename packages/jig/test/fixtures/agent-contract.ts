export const AGENT_RUN_CONTRACT_ID = 'https://jig.md/contracts/agent-run'
export const AGENT_RUN_CONTRACT_VERSION = '0.1.0'
export const AGENT_RUN_CONTRACT_DIGEST =
  'sha256:8cabbb0ea65ce001e43124071ad85fde180364c6f4706c67736b57cc691ea035'

const channels = Object.fromEntries(
  await Promise.all(
    ['acp-public-updates.json', 'agent-commands.json', 'agent-replies.json'].map(async (name) => [
      name,
      await Bun.file(
        new URL(`../../../../docs/jig/spec/contracts/agent-run/contracts/${name}`, import.meta.url),
      ).text(),
    ]),
  ),
)

/** Complete public descriptor closure for isolated source/linker fixtures. */
export function agentChannelFiles(prefix: string): Record<string, string> {
  return Object.fromEntries(
    Object.entries(channels).map(([name, text]) => [`${prefix}/${name}`, text]),
  )
}
