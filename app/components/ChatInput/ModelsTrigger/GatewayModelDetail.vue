<template>
  <div
    :id="detailId"
    data-testid="gateway-model-detail-panel"
    class="p-3 rounded-2xl bg-base-100/95 backdrop-blur-lg border border-base-content/10 shadow-xl"
  >
    <div class="flex items-center gap-2">
      <h3 class="grow text-sm font-semibold">
        {{ model.name }}
      </h3>
      <button
        type="button"
        class="btn btn-ghost btn-xs btn-circle shrink-0 hitslop"
        aria-label="Close model details"
        @click="emit('close')"
      >
        <Icon
          name="lucide:x"
          size="12"
        />
      </button>
    </div>
    <p
      v-if="model.description"
      class="mt-1.5 text-xs opacity-70"
    >
      {{ model.description }}
    </p>
    <div
      v-if="capabilities.length"
      data-testid="gateway-model-detail-capabilities"
      class="mt-2.5 flex flex-wrap gap-1"
    >
      <span
        v-for="capability in capabilities"
        :key="capability.label"
        class="badge badge-sm badge-soft"
        :class="capability.class"
      >
        <Icon
          :name="capability.icon"
          size="11"
        />
        {{ capability.label }}
      </span>
    </div>
    <dl
      class="mt-3 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-xs"
      data-testid="gateway-model-detail-specs"
    >
      <template
        v-for="row in rows"
        :key="row.label"
      >
        <dt class="opacity-50">
          {{ row.label }}
        </dt>
        <dd class="text-right break-words">
          {{ row.value }}
        </dd>
      </template>
    </dl>
  </div>
</template>

<script setup lang="ts">
import type { GatewayModel } from '#shared/types/gateways.d'
import { WEB_SEARCH_TOOLTIP } from '#shared/utils/gateway-capabilities'

interface CapabilityBadge {
  label: string
  icon: string
  class: string
}

interface SpecRow {
  label: string
  value: string
}

const props = defineProps<{
  model: GatewayModel
  gatewayLabel: string
}>()

const emit = defineEmits<{
  close: []
}>()

const detailId = computed<string>(() => {
  return `gateway-model-detail-${props.model.id}`
})

/**
 * The row badges deliberately drop the near-universal `supportsTools` wrench
 * (four in five OpenRouter models report it) and keep only the signals that
 * tell models apart. It survives here, where a full capability roster is the
 * point. `undefined` on any advisory flag means "this gateway does not
 * report it", so only an explicit `true` (or a resolved web-search value)
 * earns a badge. The web-search label itself spells out native vs.
 * gateway-billed — see `WEB_SEARCH_TOOLTIP` — doubling as the cost hint, per
 * the product decision recorded in docs/gateways.md.
 */
const capabilities = computed<CapabilityBadge[]>(() => {
  const { model } = props
  const badges: CapabilityBadge[] = []

  if (model.supportsReasoning === true) {
    badges.push({
      label: 'Reasoning',
      icon: 'lucide:brain',
      class: 'badge-warning',
    })
  }

  if (model.supportsWebSearch) {
    badges.push({
      label: WEB_SEARCH_TOOLTIP[model.supportsWebSearch],
      icon: 'lucide:globe',
      class: 'badge-info',
    })
  }

  if (model.supportsTools) {
    badges.push({
      label: 'Tool calling',
      icon: 'lucide:wrench',
      class: 'badge-neutral',
    })
  }

  if (model.supportsImageGeneration) {
    badges.push({
      label: 'Image generation',
      icon: 'lucide:image-plus',
      class: '[--badge-color:var(--color-violet-700)] '
        + 'dark:[--badge-color:var(--color-violet-200)]',
    })
  }

  if (model.modalities?.input.includes('image')) {
    badges.push({
      label: 'Vision',
      icon: 'lucide:eye',
      class: 'badge-secondary',
    })
  }

  return badges
})

const rows = computed<SpecRow[]>(() => {
  const { model, gatewayLabel } = props
  const contextLength = formatModelTokenLimit(model.contextLength ?? 0)
  const maxOutputTokens = formatModelTokenLimit(model.maxOutputTokens ?? 0)
  const price = formatGatewayPriceDetail(model.pricing)
  const specs: SpecRow[] = [
    { label: 'Gateway', value: gatewayLabel },
    { label: 'Model ID', value: model.id },
  ]

  if (contextLength) {
    specs.push({ label: 'Context', value: contextLength })
  }

  if (maxOutputTokens) {
    specs.push({ label: 'Max output', value: maxOutputTokens })
  }

  if (model.modalities?.input.length) {
    specs.push({
      label: 'Input',
      value: model.modalities.input.join(', '),
    })
  }

  if (model.modalities?.output.length) {
    specs.push({
      label: 'Output',
      value: model.modalities.output.join(', '),
    })
  }

  if (price) {
    specs.push({ label: 'Price', value: price })
  }

  return specs
})
</script>
