import { projectCommandPath } from './commands.js'

/** Inert authority declaration. Candidate bytes are supplied only by held attachments. */
export interface ProjectEvaluation {
  readonly recipe: string
  readonly attachments: {
    readonly candidate: 'supplied-read'
    readonly deliverables: 'operation-create'
  }
}

export function normalizeProjectEvaluation(value: unknown): ProjectEvaluation {
  if (value === null || typeof value !== 'object' || Array.isArray(value))
    throw new TypeError('evaluation must be an object')
  const item = value as Record<string, unknown>
  const ports = item.attachments
  if (
    Object.keys(item).length !== 2 ||
    !Object.hasOwn(item, 'recipe') ||
    ports === null ||
    typeof ports !== 'object' ||
    Array.isArray(ports) ||
    Object.keys(ports).length !== 2 ||
    (ports as Record<string, unknown>).candidate !== 'supplied-read' ||
    (ports as Record<string, unknown>).deliverables !== 'operation-create'
  )
    throw new TypeError('evaluation requires a reviewed recipe and exact attachment authority')
  const recipe = projectCommandPath(
    typeof item.recipe === 'string' && item.recipe.startsWith('./')
      ? item.recipe.slice(2)
      : item.recipe,
  )
  return Object.freeze({
    recipe,
    attachments: Object.freeze({
      candidate: 'supplied-read',
      deliverables: 'operation-create',
    }),
  })
}
