import { createHash } from 'node:crypto'
import type { Section, ViewOptions, ViewSnapshot } from '@jigging/reporting'
import type { Photo } from './catalogue.ts'
import type { RenamedPhoto } from './plan.ts'

export type PhotoBoxState = {
  phase:
    | 'reading'
    | 'grouping'
    | 'checking'
    | 'copying'
    | 'contact-sheet'
    | 'ready'
    | 'blocked'
    | 'limit'
    | 'cancelled'
    | 'failed'
  photos?: Photo[]
  plan?: RenamedPhoto[]
  reason?: string
}

const stages = {
  reading: ['Reading photos and captions', 0],
  grouping: ['Suggesting event groups', 1],
  checking: ['Checking every assignment and filename', 2],
  copying: ['Preparing checked copies and the manifest', 3],
  'contact-sheet': ['Creating the before-and-after contact sheet', 4],
  ready: ['Photo collection prepared', 5],
  blocked: ['Grouping needs attention', 0],
  limit: ['Grouping limit reached', 0],
  cancelled: ['Photo organisation cancelled', 0],
  failed: ['Photo organisation stopped', 0],
} as const

export function photoBoxView(state: PhotoBoxState): ViewSnapshot {
  const photos = state.photos ?? []
  const plan = state.plan ?? []
  const groups = [...new Set(plan.map((photo) => photo.event))]
  const ready = state.phase === 'ready'
  const [label, completed] = stages[state.phase]
  const sections: Section[] = []

  if (ready) {
    sections.push({
      title: 'Before and after',
      blocks: [
        {
          kind: 'report',
          text: 'Open the contact sheet to see the original photo box beside its organised copies. The manifest records every destination.',
          references: [
            { kind: 'artifact', attachment: 'overview', path: 'contact-sheet.svg' },
            { kind: 'artifact', attachment: 'copies', path: 'manifest.csv' },
          ],
        },
      ],
    })
  }

  sections.push({
    title: 'Photo box status',
    blocks: [
      { kind: 'progress', label, completed, total: 5, unit: 'stages' },
      {
        kind: 'facts',
        items: [
          { label: 'Photos found', value: state.photos ? photos.length : 'Reading' },
          { label: 'Checked groups', value: state.plan ? groups.join(', ') : 'Awaiting checks' },
          {
            label: 'Copies and contact sheet',
            value: ready
              ? 'Prepared; Jig confirms delivery separately'
              : 'No complete collection confirmed',
          },
        ],
      },
      {
        kind: 'report',
        text: state.reason
          ? [...state.reason].slice(0, 1000).join('')
          : 'Originals stay unchanged. The Agent groups captions and dates; it receives no photo bytes. Grouping quality still needs your review.',
      },
    ],
  })

  if (photos.length) {
    sections.push({
      title: 'Your photos',
      blocks: [
        {
          kind: 'collection',
          id: 'photos',
          title: 'Original → organised copy',
          presentation: { kind: 'table' },
          columns: [
            { key: 'original', label: 'Original', type: 'text' },
            { key: 'date', label: 'Date', type: 'text' },
            { key: 'group', label: 'Event', type: 'text' },
            { key: 'copy', label: ready ? 'Copy' : 'Planned copy', type: 'text' },
          ],
          rows: photos.map((photo) => {
            const checked = plan.find((entry) => entry.id === photo.id)
            return {
              id: photo.id,
              cells: {
                original: photo.file,
                date: photo.date,
                group: checked?.event ?? null,
                copy: checked?.destination ?? null,
              },
              details: [
                {
                  kind: 'content',
                  title: 'Original photo',
                  reference: { kind: 'input-artifact', attachment: 'source', path: photo.file },
                },
                {
                  kind: 'report',
                  text: photo.caption,
                  references:
                    ready && checked
                      ? [
                          {
                            kind: 'artifact',
                            attachment: 'copies',
                            path: checked.destination.slice('copies/'.length),
                          },
                        ]
                      : [],
                },
              ],
            }
          }),
          total: photos.length,
        },
      ],
    })
  }

  return {
    summary:
      'Turn a photo box into event folders, preserving the originals and preparing a visual before-and-after comparison.',
    sections,
  }
}

/** A catalogue identifies this example's finite collection, independently of Run IDs. */
export function photoAlbumKey(photos: readonly Photo[]): string {
  return createHash('sha256').update(JSON.stringify(photos)).digest('hex')
}

export function photoViewOptions(
  albumKey: string,
): Readonly<Record<'photos' | 'organise' | 'contactSheet', ViewOptions>> {
  return {
    photos: {
      title: 'Photos',
      landing: true,
      target: { definitionId: 'photos', instanceKey: albumKey, subjectKey: albumKey },
    },
    organise: {
      title: 'Organise',
      target: { definitionId: 'organise', instanceKey: albumKey, subjectKey: albumKey },
    },
    contactSheet: {
      title: 'Contact sheet',
      target: { definitionId: 'contact-sheet', instanceKey: albumKey, subjectKey: albumKey },
    },
  }
}

export function photoGalleryView(state: PhotoBoxState): ViewSnapshot {
  const photos = state.photos ?? []
  return {
    summary: `${photos.length} captured originals. Inspect the supplied captions and dates before reviewing the suggested organisation.`,
    sections: [
      {
        blocks: [
          {
            kind: 'collection',
            id: 'photos',
            title: 'Original photos',
            presentation: {
              kind: 'gallery',
              media: 'image',
              title: 'name',
              alt: 'caption',
              description: 'date',
            },
            columns: [
              { key: 'name', label: 'Original', type: 'text' },
              { key: 'image', label: 'Image', type: 'reference' },
              { key: 'date', label: 'Date', type: 'text' },
              { key: 'caption', label: 'Caption', type: 'text' },
            ],
            rows: photos.map((photo) => ({
              id: photo.id,
              cells: {
                name: photo.file,
                image: { kind: 'input-artifact', attachment: 'source', path: photo.file },
                date: photo.date,
                caption: photo.caption,
              },
              details: [
                { kind: 'report', text: photo.caption, format: 'plain' },
                {
                  kind: 'facts',
                  items: [
                    { label: 'Date', value: photo.date },
                    { label: 'Photo ID', value: photo.id },
                  ],
                },
              ],
            })),
            total: photos.length,
          },
        ],
      },
    ],
  }
}

export function photoContactSheetView(state: PhotoBoxState): ViewSnapshot {
  if (state.phase === 'ready') {
    return {
      summary: 'Compare the captured originals with their checked event grouping.',
      sections: [
        {
          title: 'Before and after',
          blocks: [
            {
              kind: 'content',
              title: 'Before-and-after contact sheet',
              reference: { kind: 'artifact', attachment: 'overview', path: 'contact-sheet.svg' },
            },
            {
              kind: 'report',
              text: 'The manifest records every checked destination. Grouping quality still needs your review.',
              references: [{ kind: 'artifact', attachment: 'copies', path: 'manifest.csv' }],
            },
          ],
        },
      ],
    }
  }
  return {
    summary:
      'The contact sheet becomes available after both file methods complete and their results pass the application checks.',
    sections: [
      {
        blocks: [
          {
            kind: 'report',
            text:
              state.reason ??
              'The captured originals remain available in Photos while organisation proceeds.',
          },
        ],
      },
    ],
  }
}
