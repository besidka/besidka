import type { StorageCategoryId } from '#shared/types/files.d'

export type StorageCategoryAction
  = | 'files-assistant'
    | 'files-upload'
    | 'artifacts'
    | 'projects'

export interface StorageCategoryMeta {
  label: string
  icon: string
  singular: string
  plural: string
  hint: string
  action: StorageCategoryAction
}

export const STORAGE_CATEGORY_META: Record<
  StorageCategoryId,
  StorageCategoryMeta
> = {
  aiImages: {
    label: 'AI images',
    icon: 'lucide:images',
    singular: 'image',
    plural: 'images',
    hint: 'Images the models generated for you',
    action: 'files-assistant',
  },
  uploads: {
    label: 'Uploaded files',
    icon: 'lucide:paperclip',
    singular: 'file',
    plural: 'files',
    hint: 'Files you attached or added to your library',
    action: 'files-upload',
  },
  generatedFiles: {
    label: 'Generated files',
    icon: 'lucide:file-text',
    singular: 'file',
    plural: 'files',
    hint: 'Documents and other files the models created',
    action: 'files-assistant',
  },
  artifacts: {
    label: 'Artifacts',
    icon: 'lucide:app-window',
    singular: 'artifact',
    plural: 'artifacts',
    hint: 'Every saved version of your artifacts',
    action: 'artifacts',
  },
  knowledge: {
    label: 'Project knowledge',
    icon: 'lucide:book-open',
    singular: 'item',
    plural: 'items',
    hint: 'Text extracted from your project files and notes',
    action: 'projects',
  },
}

export function isKnownStorageCategory(
  id: string,
): id is StorageCategoryId {
  return Object.hasOwn(STORAGE_CATEGORY_META, id)
}

export function formatStorageCount(
  id: StorageCategoryId,
  count: number,
): string {
  const meta = STORAGE_CATEGORY_META[id]

  return `${count} ${count === 1 ? meta.singular : meta.plural}`
}

export function getStorageProgressTone(
  percentage: number,
): 'primary' | 'warning' | 'error' {
  if (percentage >= 100) {
    return 'error'
  }

  return percentage >= 80 ? 'warning' : 'primary'
}
