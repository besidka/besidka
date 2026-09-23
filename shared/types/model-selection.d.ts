import type { GatewayId } from '#shared/types/gateways.d'

export type ModelSelection
  = | { source: 'provider', modelId: string }
    | { source: 'gateway', gatewayId: GatewayId, modelId: string }
