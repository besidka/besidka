import { describe, expect, it } from 'vitest'
import {
  resolveContainerFileType,
  sanitizeContainerFileName,
} from '~~/server/utils/code-execution/file-types'

const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0])
const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0])
const webp = new Uint8Array([
  0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50,
])
const gif = new TextEncoder().encode('GIF89a....')
const pdf = new TextEncoder().encode('%PDF-1.7\n')
const zip = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0, 0])
const text = new TextEncoder().encode('a,b\n1,2\n')

describe('resolveContainerFileType', () => {
  it.each([
    ['chart.png', png, 'image/png', 'image'],
    ['photo.jpg', jpeg, 'image/jpeg', 'image'],
    ['photo.JPEG', jpeg, 'image/jpeg', 'image'],
    ['plot.webp', webp, 'image/webp', 'image'],
    ['data.csv', text, 'text/csv', 'text'],
    ['data.tsv', text, 'text/tab-separated-values', 'text'],
    ['notes.txt', text, 'text/plain', 'text'],
    ['readme.md', text, 'text/markdown', 'text'],
    ['out.json', text, 'application/json', 'text'],
    ['report.pdf', pdf, 'application/pdf', 'pdf'],
    ['report.docx', zip, undefined, 'office'],
    ['sheet.xlsx', zip, undefined, 'office'],
    ['deck.pptx', zip, undefined, 'office'],
  ])('accepts %s', (name, bytes, mediaType, kind) => {
    const result = resolveContainerFileType(name, bytes)

    expect(result.ok).toBe(true)

    if (result.ok) {
      expect(result.type.kind).toBe(kind)

      if (mediaType) {
        expect(result.type.mediaType).toBe(mediaType)
      }
    }
  })

  it.each([
    ['logo.svg', text],
    ['page.html', text],
    ['anim.gif', gif],
    ['bundle.zip', zip],
    ['tool.exe', new Uint8Array([0x4d, 0x5a, 0x90])],
    ['script.py', text],
    ['noextension', text],
    ['.png', png],
  ])('rejects %s by extension', (name, bytes) => {
    expect(resolveContainerFileType(name, bytes).ok).toBe(false)
  })

  it('rejects a file whose bytes do not match its extension', () => {
    expect(resolveContainerFileType('fake.png', text).ok).toBe(false)
    expect(resolveContainerFileType('fake.pdf', png).ok).toBe(false)
    expect(resolveContainerFileType('fake.docx', pdf).ok).toBe(false)
    expect(resolveContainerFileType('fake.csv', png).ok).toBe(false)
  })

  it('rejects an empty file and text with a NUL byte', () => {
    expect(resolveContainerFileType('empty.csv', new Uint8Array(0)).ok)
      .toBe(false)
    expect(resolveContainerFileType('bin.txt', new Uint8Array([97, 0, 98])).ok)
      .toBe(false)
  })
})

describe('sanitizeContainerFileName', () => {
  it('keeps the last path segment and strips control characters', () => {
    expect(sanitizeContainerFileName('/mnt/data/../out.csv')).toBe('out.csv')
    expect(sanitizeContainerFileName('a\\b\\c.png')).toBe('c.png')
    expect(sanitizeContainerFileName('bad\u0000name\n.txt')).toBe('badname.txt')
  })

  it('strips bidirectional controls that could disguise the extension', () => {
    expect(sanitizeContainerFileName('report‮fdp.exe')).toBe('reportfdp.exe')
  })

  it('falls back for an empty or dot name', () => {
    expect(sanitizeContainerFileName('')).toBe('file')
    expect(sanitizeContainerFileName('..')).toBe('file')
  })

  it('caps the length and keeps the extension', () => {
    const name = sanitizeContainerFileName(`${'a'.repeat(300)}.csv`)

    expect(name.length).toBeLessThanOrEqual(120)
    expect(name.endsWith('.csv')).toBe(true)
  })
})
