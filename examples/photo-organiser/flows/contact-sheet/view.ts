import type { ViewSnapshot } from '@jigging/reporting'

export function contactSheetView(photoCount = 0, prepared = false): ViewSnapshot {
  if (!prepared) {
    return {
      summary: 'Checking originals and event assignments before creating the contact sheet.',
      sections: [
        {
          blocks: [
            {
              kind: 'report',
              text: 'The sheet uses original image bytes and derived copy labels. It does not need access to another method’s output.',
            },
          ],
        },
      ],
    }
  }

  return {
    summary: `Before-and-after contact sheet prepared for ${photoCount} photos. Delivery is confirmed by the final host result.`,
    sections: [
      {
        blocks: [
          {
            kind: 'report',
            text: 'Original order and filenames appear beside the proposed grouped copies. Original images remain unchanged.',
            references: [{ kind: 'artifact', attachment: 'files', path: 'contact-sheet.svg' }],
          },
        ],
      },
    ],
  }
}
