import type { JsonValue } from './json.js'

function record(value: JsonValue | undefined): Record<string, JsonValue> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, JsonValue>)
    : {}
}

export function cliShellWord(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`
}

export function approvedTargets(snapshot: JsonValue): { target: string; description: string }[] {
  const targets = record(snapshot).targets
  if (!Array.isArray(targets)) return []
  return targets.flatMap((value) => {
    const item = record(value)
    return typeof item.target === 'string'
      ? [
          {
            target: item.target,
            description: typeof item.description === 'string' ? item.description : '',
          },
        ]
      : []
  })
}

/** Guidance is derived from the retained interface, never a fabricated valid input. */
export function invocationGuide(snapshot: JsonValue): string {
  const item = record(snapshot)
  if (typeof item.target !== 'string') {
    const targets = approvedTargets(snapshot)
    return targets.length === 0
      ? ''
      : `Approved targets\n\n${targets
          .map(
            ({ target, description }) =>
              `  ${JSON.stringify(target)}${description ? ` — ${JSON.stringify(description)}` : ''}`,
          )
          .join(
            '\n',
          )}\n\nChoose a target with jig run, or inspect its interface with jig inspect <target>.\n`
  }
  const input = record(item.schemas).input
  const schema = record(input)
  const fields = record(schema.properties)
  const required = Array.isArray(schema.required) ? schema.required : []
  const lines = [`How to invoke ${JSON.stringify(item.target)}`, '']
  if (typeof item.description === 'string') lines.push(`  ${JSON.stringify(item.description)}`, '')
  if (input !== undefined) {
    lines.push(
      '  Input: supply input.json matching the retained schema below; this command is a template.',
    )
    for (const [name, value] of Object.entries(fields)) {
      const field = record(value)
      lines.push(
        `  ${JSON.stringify(name)} (${required.includes(name) ? 'required' : 'optional'}): ${JSON.stringify(field.type ?? 'see schema')}`,
      )
    }
    if (Object.keys(fields).length === 0)
      lines.push(`  Input type: ${JSON.stringify(schema.type ?? 'see schema')}`)
  }
  const command = ['jig run', cliShellWord(item.target)]
  if (input !== undefined) command.push('--input @input.json')
  for (const [name, mode] of Object.entries(record(item.attachments))) {
    if (mode === 'read') command.push('--attach', cliShellWord(`${name}=./${name}-input`))
    else if (mode === 'read-write') command.push('--out ./result-packet')
  }
  if (Object.keys(record(item.attachments)).length > 0)
    lines.push(
      '  File paths below are placeholders. Choose input directories and a new output destination outside them.',
    )
  const outputs = Object.entries(record(item.channels)).filter(
    ([, value]) => record(value).direction === 'send',
  )
  for (const [name, value] of outputs)
    if (record(value).required !== false) command.push('--receive', cliShellWord(name))
  const requiresSender = Object.values(record(item.channels)).some(
    (value) => record(value).direction === 'receive' && record(value).required !== false,
  )
  if (requiresSender)
    lines.push(
      '',
      '  This target requires an incoming channel. Invoke it from a Flow with that channel connected; the CLI cannot supply it.',
    )
  else lines.push('', `  ${command.join(' ')}`)
  if (outputs.length > 0) {
    lines.push('', '  Output channels (add --receive NAME):')
    for (const [name, value] of outputs)
      lines.push(
        `    ${JSON.stringify(name)} (${record(value).required === false ? 'optional' : 'required'})`,
      )
  }
  lines.push(
    '',
    '  Uses the approved revision. Review changed source before running it.',
    '',
    'Retained interface',
    '',
  )
  return `${lines.join('\n')}\n`
}

/** Small native shell adapters; dynamic lookup reads approval, never project code. */
export function completionScript(shell: string): string | undefined {
  const commands = 'init new review run inspect completion'
  const runOptions =
    '--help --input --attach --select --out --receive --timeout --verification --json'
  if (shell === 'bash')
    return `_jig() {
  local cur="\${COMP_WORDS[COMP_CWORD]}" command="\${COMP_WORDS[1]}" prev="\${COMP_WORDS[COMP_CWORD-1]}"
  local word=$COMP_CWORD
  if (( word >= 3 && word <= 4 )) && [[ "\${COMP_WORDS[3]}" == : ]]; then
    cur="\${COMP_WORDS[2]}:\${COMP_WORDS[4]-}"
    word=2
  fi
  COMPREPLY=()
  if (( COMP_CWORD == 1 )); then
    mapfile -t COMPREPLY < <(compgen -W '${commands} --help --version' -- "$cur")
  elif [[ "$prev" == --verification ]]; then
    mapfile -t COMPREPLY < <(compgen -W 'cached strict fast' -- "$cur")
  elif [[ "$cur" == -* ]]; then
    local opts='--help'
    case "$command" in
      run) opts='${runOptions}';;
      review) opts='--help --allow-resolution-network --yes --details --verification';;
      inspect) opts='--help --json --verification';;
      init) opts='--help --bare';;
    esac
    mapfile -t COMPREPLY < <(compgen -W "$opts" -- "$cur")
  elif (( word == 2 )) && [[ "$command" == run || "$command" == inspect ]]; then
    mapfile -t COMPREPLY < <(jig completion targets "$cur" 2>/dev/null)
    # Bash treats ':' as a word break; keep only the suffix it will replace.
    if [[ "$cur" == *:* && "$COMP_WORDBREAKS" == *:* ]]; then
      COMPREPLY=("\${COMPREPLY[@]#*:}")
    fi
  fi
}
complete -o filenames -o bashdefault -F _jig jig
`
  if (shell === 'zsh')
    return `#compdef jig
_jig() {
  local -a choices
  if (( CURRENT == 2 )); then
    choices=(${commands} --help --version)
  elif [[ "$words[CURRENT-1]" == --verification ]]; then
    choices=(cached strict fast)
  elif [[ "$PREFIX" == -* ]]; then
    case "$words[2]" in
      run) choices=(${runOptions});;
      review) choices=(--help --allow-resolution-network --yes --details --verification);;
      inspect) choices=(--help --json --verification);;
      init) choices=(--help --bare);;
      *) choices=(--help);;
    esac
  elif (( CURRENT == 3 )) && [[ "$words[2]" == run || "$words[2]" == inspect ]]; then
    choices=("\${(@f)$(jig completion targets "$PREFIX" 2>/dev/null)}")
  else
    _files; return
  fi
  compadd -- "\${choices[@]}"
}
compdef _jig jig
`
  if (shell === 'fish')
    return `complete -c jig -n '__fish_use_subcommand' -a '${commands}'
complete -c jig -l help
complete -c jig -l version -n '__fish_use_subcommand'
complete -c jig -n '__fish_seen_subcommand_from run inspect' -a '(jig completion targets (commandline -ct) 2>/dev/null)'
complete -c jig -n '__fish_seen_subcommand_from run review inspect' -l verification -r -a 'cached strict fast'
complete -c jig -n '__fish_seen_subcommand_from run inspect' -l json
complete -c jig -n '__fish_seen_subcommand_from init' -l bare
${['input', 'attach', 'select', 'out', 'receive', 'timeout'].map((flag) => `complete -c jig -n '__fish_seen_subcommand_from run' -l ${flag} -r`).join('\n')}
${['yes', 'details', 'allow-resolution-network'].map((flag) => `complete -c jig -n '__fish_seen_subcommand_from review' -l ${flag}`).join('\n')}
`
  return undefined
}
