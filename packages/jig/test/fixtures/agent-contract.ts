export const AGENT_RUN_CONTRACT_ID = 'https://jig.md/contracts/agent-run'
export const AGENT_RUN_CONTRACT_VERSION = '1.0.0'
export const AGENT_RUN_CONTRACT_DIGEST =
  'sha256:cf5c0e621c7bba9d6ef81dd8992324d40aa2c72b4766cd2fe12f96cc9c51cdc4'

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
