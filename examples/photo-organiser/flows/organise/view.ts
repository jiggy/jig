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
    | 'yearbook'
    | 'ready'
    | 'blocked'
    | 'limit'
    | 'cancelled'
    | 'failed'
  albumTitle?: string
  yearbook?: { pages: number; bytes: number }
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
  yearbook: ['Preparing the printable yearbook', 5],
  ready: ['Photo collection prepared', 6],
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
          text: 'The checked collection preserves every original. Compare the grouping and review the destinations in the manifest.',
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
      { kind: 'progress', label, completed, total: 6, unit: 'stages' },
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
    const events = state.plan ? groups : ['Awaiting checked grouping']
    for (const event of events) {
      const members = photos.filter(
        (photo) => !state.plan || plan.find((entry) => entry.id === photo.id)?.event === event,
      )
      sections.push({
        title: event,
        blocks: [
          {
            kind: 'collection',
            id: `event-${sections.length}`,
            title: event,
            presentation: {
              kind: 'gallery',
              media: 'image',
              title: 'caption',
              alt: 'caption',
              description: 'date',
            },
            columns: [
              { key: 'caption', label: 'Caption', type: 'text' },
              { key: 'image', label: 'Original photo', type: 'reference' },
              { key: 'date', label: 'Date', type: 'text' },
              { key: 'original', label: 'Original', type: 'text' },
              { key: 'copy', label: ready ? 'Copy' : 'Planned copy', type: 'text' },
            ],
            rows: members.map((photo) => {
              const checked = plan.find((entry) => entry.id === photo.id)
              return {
                id: photo.id,
                cells: {
                  caption: photo.caption,
                  image: { kind: 'input-artifact', attachment: 'source', path: photo.file },
                  date: photo.date,
                  original: photo.file,
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
            total: members.length,
          },
        ],
      })
    }
    // Material leads; status and caveats remain together below it.
    const status = sections.findIndex((section) => section.title === 'Photo box status')
    sections.push(...sections.splice(status, 1))
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
  albumTitle = 'Photo collection',
): Readonly<Record<'photos' | 'organise' | 'yearbook', ViewOptions>> {
  return {
    photos: {
      title: 'Photos',
      application: 'Photo studio',
      landing: true,
      target: {
        definitionId: 'photos',
        instanceKey: albumKey,
        subjectKey: albumKey,
        label: albumTitle,
        scopeLabel: 'Album',
      },
    },
    organise: {
      title: 'Organise',
      application: 'Photo studio',
      target: {
        definitionId: 'organise',
        instanceKey: albumKey,
        subjectKey: albumKey,
        label: albumTitle,
        scopeLabel: 'Album',
      },
    },
    yearbook: {
      title: 'Yearbook',
      application: 'Photo studio',
      target: {
        definitionId: 'yearbook',
        instanceKey: albumKey,
        subjectKey: albumKey,
        label: albumTitle,
        scopeLabel: 'Album',
      },
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
              title: 'caption',
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

export function photoYearbookView(state: PhotoBoxState): ViewSnapshot {
  const photos = state.photos ?? []
  const groups = [...new Set((state.plan ?? []).map((photo) => photo.event))]
  const ready = state.phase === 'ready' && state.yearbook !== undefined
  const title = state.albumTitle ?? 'Photo collection'
  const cover = photos[1] ?? photos[0]
  const sections: Section[] = []
  const image = (photo: Photo) => ({
    kind: 'content' as const,
    title: photo.caption,
    reference: { kind: 'input-artifact' as const, attachment: 'source', path: photo.file },
  })
  if (state.plan?.length && photos[0]) {
    sections.push({
      title: 'Opening',
      label: '01–02',
      blocks: [
        { kind: 'report', text: 'A cover, followed by the contents and chapter photographs.' },
        image(photos[0]),
      ],
    })
    let page = 3
    for (const group of groups) {
      const members = state.plan.filter((photo) => photo.event === group)
      const until = page + members.length
      sections.push({
        title: group,
        label: `${page}–${until}`,
        blocks: [
          {
            kind: 'report',
            text: `${members.length} photographs, brought together into one chapter.`,
          },
          ...members.map(image),
        ],
      })
      page = until + 1
    }
    sections.push({
      title: 'Closing',
      label: String(page),
      blocks: [
        {
          kind: 'report',
          text: 'The moments between them. Originals stay unchanged; review the event grouping before printing.',
        },
      ],
    })
  }
  if (state.reason)
    sections.unshift({
      title: 'Preparation stopped',
      blocks: [{ kind: 'report', text: state.reason }],
    })
  return {
    summary: state.plan?.length
      ? `${photos.length} photographs, ${groups.length} chapters, and the moments between them.`
      : 'The yearbook is not produced yet. Captured originals remain available in Photos.',
    presentation: {
      kind: 'document',
      title,
      subtitle: 'A family yearbook',
      label: ready
        ? `${state.yearbook!.pages}-page yearbook · PDF ready`
        : state.plan?.length
          ? 'Page plan · PDF not produced yet'
          : 'Not produced',
      ...(cover
        ? { cover: { kind: 'input-artifact' as const, attachment: 'source', path: cover.file } }
        : {}),
      ...(ready
        ? {
            download: {
              reference: { kind: 'artifact' as const, attachment: 'book', path: 'yearbook.pdf' },
              label: 'Download PDF',
              detail: `${state.yearbook!.pages} pages · A4 portrait · ${(state.yearbook!.bytes / (1024 * 1024)).toFixed(1)} MB`,
            },
          }
        : {}),
    },
    sections,
  }
}
