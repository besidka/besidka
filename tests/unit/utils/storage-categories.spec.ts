import { describe, expect, it } from 'vitest'
import {
  STORAGE_CATEGORY_META,
  formatStorageCount,
  getStorageProgressTone,
  isKnownStorageCategory,
} from '~/utils/storage-categories'

describe('storage categories', () => {
  it('describes every category with an icon and a label', () => {
    expect(Object.entries(STORAGE_CATEGORY_META).map(([id, meta]) => {
      return [id, meta.label, meta.icon]
    })).toEqual([
      ['aiImages', 'AI images', 'lucide:images'],
      ['uploads', 'Uploaded files', 'lucide:paperclip'],
      ['googleDrive', 'Google Drive copies', 'lucide:hard-drive'],
      ['generatedFiles', 'Generated files', 'lucide:file-text'],
      ['connectorImages', 'Connector images', 'lucide:plug'],
      ['artifacts', 'Artifacts', 'lucide:app-window'],
      ['knowledge', 'Project knowledge', 'lucide:book-open'],
      ['skills', 'Skills', 'lucide:sparkles'],
    ])
  })

  it('recognizes only categories it knows how to show', () => {
    expect(isKnownStorageCategory('artifacts')).toBe(true)
    expect(isKnownStorageCategory('skills')).toBe(true)
    expect(isKnownStorageCategory('notes')).toBe(false)
    expect(isKnownStorageCategory('toString')).toBe(false)
  })

  it('pluralizes the count per category', () => {
    expect(formatStorageCount('uploads', 1)).toBe('1 file')
    expect(formatStorageCount('uploads', 0)).toBe('0 files')
    expect(formatStorageCount('knowledge', 2)).toBe('2 items')
    expect(formatStorageCount('aiImages', 1)).toBe('1 image')
    expect(formatStorageCount('skills', 1)).toBe('1 skill')
    expect(formatStorageCount('skills', 3)).toBe('3 skills')
  })

  it('picks the progress tone from the percentage', () => {
    expect(getStorageProgressTone(0)).toBe('default')
    expect(getStorageProgressTone(79)).toBe('default')
    expect(getStorageProgressTone(80)).toBe('warning')
    expect(getStorageProgressTone(99)).toBe('warning')
    expect(getStorageProgressTone(100)).toBe('error')
    expect(getStorageProgressTone(250)).toBe('error')
  })
})
