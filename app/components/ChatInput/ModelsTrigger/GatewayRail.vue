<template>
  <div
    data-testid="models-picker-gateway-rail"
    class="shrink-0 flex items-center gap-2 px-2 py-1.5 rounded-b-2xl border-t border-base-content/10 bg-base-200/40"
  >
    <span
      class="shrink-0 px-1 text-[0.65rem] font-semibold uppercase tracking-wide opacity-50"
    >
      Gateways
    </span>
    <div class="grow min-w-0 flex items-center gap-1 overflow-x-auto">
      <button
        v-for="gateway in gateways"
        :key="gateway.id"
        type="button"
        :data-testid="`models-picker-gateway-${gateway.id}`"
        class="btn btn-xs shrink-0 gap-1.5 rounded-full"
        :class="[
          activeGatewayId === gateway.id ? 'btn-accent' : 'btn-ghost',
          {
            'opacity-60': gateway.hasKey === false
              && activeGatewayId !== gateway.id
          }
        ]"
        :aria-pressed="activeGatewayId === gateway.id"
        :aria-label="getGatewayLabel(gateway)"
        @click="emit('toggleGateway', gateway.id)"
      >
        <ProviderIcon
          :provider-id="gateway.id"
          :label="gateway.label"
          class="w-3.5 shrink-0 fill-current"
        />
        <span class="truncate">
          {{ gateway.label }}
        </span>
        <Icon
          v-if="gateway.hasKey === false"
          :data-testid="`models-picker-gateway-${gateway.id}-keyless`"
          name="lucide:key-round"
          size="11"
          class="shrink-0"
          :class="activeGatewayId === gateway.id
            ? 'text-current'
            : 'text-warning'
          "
        />
        <span
          v-if="isPending && activeGatewayId === gateway.id"
          data-testid="models-picker-gateway-pending"
          class="loading loading-spinner loading-xs shrink-0"
        />
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
import type { GatewayId } from '#shared/types/gateways.d'

interface GatewayRailItem {
  id: GatewayId
  label: string
  hasKey?: boolean
}

const props = defineProps<{
  gateways: GatewayRailItem[]
  activeGatewayId: GatewayId | null
  isPending: boolean
}>()

const emit = defineEmits<{
  toggleGateway: [gatewayId: GatewayId]
}>()

function getGatewayLabel(gateway: GatewayRailItem): string {
  if (gateway.hasKey === false) {
    return `Browse ${gateway.label} models — API key required`
  }

  if (props.activeGatewayId === gateway.id) {
    return `Leave ${gateway.label} and show provider models`
  }

  return `Browse ${gateway.label} models`
}
</script>
