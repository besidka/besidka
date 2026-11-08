import { defineCapability } from '~~/server/capabilities/types'

export const artifactsCapability = defineCapability({
  feature: 'artifacts',
  routesPrefix: ['artifacts'],
})
