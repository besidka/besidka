import type { Model } from '#shared/types/providers.d'

export type ModelCategory = 'chat' | 'research' | 'image-generation'

export interface ModelCategoryOption {
  value: ModelCategory
  label: string
  icon: string
}

export interface PickerModel {
  model: Model
  providerId: string
  providerName: string
}

export interface PickerSection {
  id: string
  label: string
  entries: PickerModel[]
}
