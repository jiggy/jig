import type { Report, ViewSnapshot } from '@jigging/reporting'
import type { RenamedPhoto } from './plan.ts'

export function photosView(photos: RenamedPhoto[] = [], accepted = false): ViewSnapshot {
  let summary = 'Grouping is provisional until every photo and filename passes the checks.'
  let explanation: Report = {
    kind: 'report',
    text: 'The Agent receives captions and dates only, never photo bytes.',
  }

  if (accepted) {
    summary = `${photos.length} checked copies prepared. Full images and contact sheet are in the result packet.`
    explanation = {
      kind: 'report',
      text: 'Open overview/contact-sheet.svg from the result packet to see before and after. The Agent groups captions without interpreting pixels.',
      references: [
        { kind: 'artifact', attachment: 'overview', path: 'contact-sheet.svg' },
        { kind: 'artifact', attachment: 'copies', path: 'manifest.csv' },
      ],
    }
  }

  return {
    summary,
    sections: [
      {
        blocks: [
          {
            kind: 'collection',
            id: 'photos',
            title: 'Original → organised copy',
            columns: [
              { key: 'original', label: 'Original', type: 'text' },
              { key: 'group', label: 'Event', type: 'text' },
              { key: 'copy', label: 'Copy', type: 'text' },
            ],
            rows: photos.map((photo) => ({
              id: photo.id,
              cells: {
                original: photo.file,
                group: photo.event,
                copy: photo.destination,
              },
              details: [
                {
                  kind: 'report',
                  text: 'The source stays unchanged.',
                  references: [
                    {
                      kind: 'artifact',
                      attachment: 'copies',
                      path: photo.destination.slice('copies/'.length),
                    },
                  ],
                },
              ],
            })),
            total: photos.length,
          },
          explanation,
        ],
      },
    ],
  }
}
