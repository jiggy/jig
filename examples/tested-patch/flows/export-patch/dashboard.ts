import type { ViewSnapshot } from '@jigging/reporting'

function preview(text: string): string {
  const characters = [...text]
  if (characters.length <= 3072) return text
  return `${characters.slice(0, 3072).join('')}\n[Excerpt; select the file for its complete content.]`
}

export function exportedPatchView(files: Readonly<Record<string, string>>): ViewSnapshot {
  const entries = Object.entries(files)
  return {
    summary:
      'Supplied review data was exported. Acceptance belongs to the caller; source changes have not been applied.',
    sections: [
      {
        blocks: [
          {
            kind: 'collection',
            id: 'files',
            title: 'Review files',
            columns: [{ key: 'file', label: 'File', type: 'reference' }],
            rows: entries.map(([name, text], index) => {
              const reference = {
                kind: 'artifact' as const,
                attachment: 'files',
                path: `review/${name}`,
              }
              return {
                id: `file-${index}`,
                cells: { file: reference },
                details: [
                  {
                    kind: 'report' as const,
                    text: preview(text),
                    format: name.endsWith('.patch') ? ('diff' as const) : ('plain' as const),
                    references: [reference],
                  },
                ],
              }
            }),
            total: entries.length,
          },
        ],
      },
    ],
  }
}
