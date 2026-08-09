import type { GatewayId, GatewayModel } from '#shared/types/gateways.d'
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

export type PickerMode
  = | { source: 'provider' }
    | { source: 'gateway', gatewayId: GatewayId }

export interface GatewayPickerSection {
  id: string
  label: string
  entries: GatewayModel[]
}
