import { expect, test } from 'bun:test'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { privateCaptureAttachments } from '../../src/internal/file-input.js'
import { PrivateInputInspectionCapture } from '../../src/internal/input-inspection.js'
import { fixture } from '../file-input.fixture.js'

test('selected input copies survive source retirement and close without borrowing mutable paths', async () =>
  fixture(async (root) => {
    await writeFile(join(root, 'first.txt'), 'Original input')
    await writeFile(join(root, 'second.txt'), 'Another input')
    const source = privateCaptureAttachments([{ name: 'source', directory: root, select: [] }])
    const capture = new PrivateInputInspectionCapture(source.attachments)
    try {
      capture.select([
        ...Array.from({ length: 200 }, (_, index) => ({
          attachment: 'unavailable',
          path: String(index),
        })),
        { attachment: 'source', path: 'first.txt' },
      ])
      expect(capture.files.map((file) => file.path)).toEqual(['first.txt'])
      const generation = capture.generation
      capture.select([{ attachment: 'source', path: 'first.txt' }])
      expect(capture.generation).toBe(generation)
      capture.retireSource()
      source.close()
      await writeFile(join(root, 'first.txt'), 'Edited destination')
      const bytes = capture.read('source/first.txt')!
      expect(new TextDecoder().decode(bytes)).toBe('Original input')
      bytes.fill(0)
      expect(new TextDecoder().decode(capture.read('source/first.txt'))).toBe('Original input')
      expect(await capture.preview('source/first.txt')).toMatchObject({
        text: 'Original input',
        clipped: false,
      })
      capture.select([{ attachment: 'source', path: 'second.txt' }])
      expect(capture.files).toEqual([])
      expect(capture.read('source/first.txt')).toBeUndefined()
      expect(capture.generation).not.toBe(generation)
    } finally {
      source.close()
      const close = capture.close()
      expect(capture.close()).toBe(close)
      await close
      expect(capture.read('source/first.txt')).toBeUndefined()
    }
  }))

test('clipped UTF-8 text preserves its complete prefix and full captured bytes', async () =>
  fixture(async (root) => {
    const text = 'a'.repeat(4095) + 'é' + 'tail'
    await writeFile(join(root, 'text.txt'), text)
    const source = privateCaptureAttachments([{ name: 'source', directory: root, select: [] }])
    const capture = new PrivateInputInspectionCapture(source.attachments)
    try {
      capture.select([{ attachment: 'source', path: 'text.txt' }])
      expect(await capture.preview('source/text.txt')).toMatchObject({
        text: 'a'.repeat(4095),
        clipped: true,
      })
      expect(new TextDecoder().decode(capture.read('source/text.txt'))).toBe(text)
    } finally {
      await capture.close()
      source.close()
    }
  }))
