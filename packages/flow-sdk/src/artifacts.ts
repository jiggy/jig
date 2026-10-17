import {
  type AttachmentGrant,
  requireExactKeys,
  requireLocalName,
  requireObject,
  requireWireId,
  snapshotDataObject,
} from './protocol.js'
import type {
  Artifact,
  Attachment,
  CallResult,
  FlowCall,
  JsonObject,
  JsonValue,
  RunResult,
} from './types.js'

class HeldArtifact {
  constructor(readonly reference: string) {
    Object.freeze(this)
  }
}

/** SDK provenance is not authority: the host still validates every use. */
export class Artifacts {
  private readonly held = new WeakSet<Artifact>()
  private readonly references = new Map<string, Artifact>()
  private readonly released = new Set<string>()

  grant(reference: string): Artifact {
    requireWireId(reference)
    let artifact = this.references.get(reference)
    if (artifact === undefined) {
      artifact = new HeldArtifact(reference) as unknown as Artifact
      this.references.set(reference, artifact)
      this.held.add(artifact)
    }
    return artifact
  }

  reference(artifact: Artifact, allowReleased = false): string {
    if (artifact === null || typeof artifact !== 'object' || !this.held.has(artifact))
      throw new TypeError('artifact must be held by this Run')
    if (!allowReleased && this.released.has(artifact.reference))
      throw new TypeError('artifact has been released')
    return artifact.reference
  }

  retire(reference: string): void {
    this.released.add(reference)
  }

  incoming(raw: Readonly<Record<string, AttachmentGrant>>): Readonly<Record<string, Attachment>> {
    const result: Record<string, Attachment> = Object.create(null)
    for (const [name, value] of Object.entries(raw)) {
      result[name] = Object.freeze({
        path: value.path,
        access: value.access,
        ...(value.artifact === undefined ? {} : { artifact: this.grant(value.artifact) }),
      })
    }
    return Object.freeze(result)
  }

  mappings(raw: FlowCall['attachments']): JsonObject | undefined {
    if (raw === undefined) return undefined
    const map = snapshotDataObject(raw, 'call attachments', 256)
    const result: Record<string, JsonValue> = Object.create(null)
    for (const [name, value] of Object.entries(map)) {
      requireLocalName(name)
      const item = snapshotDataObject(value, 'call attachment', 1)
      if (Object.hasOwn(item, 'read')) {
        requireExactKeys(item, ['read'])
        // A released spelling may still replay an exact operation. Only the
        // host knows whether this is replay or initiation of a new reader.
        result[name] = { read: this.reference(item.read as Artifact, true) }
      } else {
        requireExactKeys(item, ['create'])
        if (item.create !== true) throw new TypeError('attachment create must be true')
        result[name] = { create: true }
      }
    }
    return result
  }

  result(raw: JsonValue): CallResult {
    const object = requireObject(raw, 'Call result')
    let artifacts: Readonly<Record<string, Artifact>> | undefined
    if (Object.hasOwn(object, 'artifacts')) {
      const selected: Record<string, Artifact> = Object.create(null)
      for (const [name, reference] of Object.entries(parseArtifactReferences(object.artifacts!)))
        selected[name] = this.grant(reference)
      artifacts = Object.freeze(selected)
    }
    return Object.freeze({
      outcome: object.outcome as string,
      output: object.output!,
      ...(artifacts === undefined ? {} : { artifacts }),
    })
  }

  terminal(raw: RunResult): JsonObject {
    const object = snapshotDataObject(raw, 'Run result', 3)
    const hasArtifacts = Object.hasOwn(object, 'artifactResults')
    requireExactKeys(object, ['outcome', 'output', ...(hasArtifacts ? ['artifactResults'] : [])])
    const outcome = requireLocalName(object.outcome as JsonValue)
    const results: Record<string, JsonValue> = Object.create(null)
    if (hasArtifacts) {
      const selected = snapshotDataObject(object.artifactResults, 'artifact results', 256)
      for (const [name, value] of Object.entries(selected)) {
        requireLocalName(name)
        results[name] = this.reference(value as Artifact)
      }
    }
    return {
      outcome,
      output: object.output as JsonValue,
      ...(hasArtifacts ? { artifactResults: results } : {}),
    }
  }
}

export function parseArtifactReferences(raw: JsonValue): Readonly<Record<string, string>> {
  const map = requireObject(raw, 'artifact references')
  if (Object.keys(map).length > 256) throw new Error('too many artifact references')
  const result: Record<string, string> = Object.create(null)
  for (const [name, value] of Object.entries(map))
    result[requireLocalName(name)] = requireWireId(value)
  return result
}

export function parseCallResult(raw: JsonValue): JsonObject {
  const object = requireObject(raw, 'Call result')
  requireExactKeys(object, [
    'outcome',
    'output',
    ...(Object.hasOwn(object, 'artifacts') ? ['artifacts'] : []),
  ])
  requireLocalName(object.outcome!)
  if (Object.hasOwn(object, 'artifacts')) parseArtifactReferences(object.artifacts!)
  return object
}
