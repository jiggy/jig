import type { ViewSnapshot } from '@jigging/reporting'
import type { RenamedPhoto } from './assignments.ts'

export function copiesView(photos: RenamedPhoto[] = [], prepared = false): ViewSnapshot {
  if (!prepared) {
    return {
      summary: 'Checking every original and assignment before preparing copies.',
      sections: [
        {
          blocks: [
            {
              kind: 'report',
              text: 'This method preserves the source bytes. Event names select safe copy destinations; they cannot select source paths.',
            },
          ],
        },
      ],
    }
  }

  return {
    summary: `${photos.length} byte-preserving copies prepared. Delivery is confirmed by the final host result.`,
    sections: [
      {
        blocks: [
          {
            kind: 'collection',
            id: 'copies',
            title: 'Original → grouped copy',
            columns: [
              { key: 'original', label: 'Original', type: 'text' },
              { key: 'event', label: 'Event', type: 'text' },
              { key: 'copy', label: 'Copy', type: 'text' },
            ],
            rows: photos.map((photo) => ({
              id: photo.id,
              cells: {
                original: photo.file,
                event: photo.event,
                copy: photo.destination,
              },
              details: [
                {
                  kind: 'report',
                  text: 'The copy contains the original image bytes.',
                  references: [{ kind: 'artifact', attachment: 'files', path: photo.destination }],
                },
              ],
            })),
            total: photos.length,
          },
          {
            kind: 'report',
            text: 'Manifest paths are relative to this method’s output attachment.',
            references: [{ kind: 'artifact', attachment: 'files', path: 'manifest.csv' }],
          },
        ],
      },
    ],
  }
}
