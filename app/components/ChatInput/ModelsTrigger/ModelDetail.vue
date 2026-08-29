<template>
  <div
    :id="detailId"
    data-testid="model-detail-panel"
    class="p-3 rounded-2xl bg-base-100/95 backdrop-blur-lg border border-base-content/10 shadow-xl"
  >
    <div class="flex items-center gap-2">
      <h3 class="grow text-sm font-semibold">
        {{ model.name }}
      </h3>
      <span
        v-if="model.priceTier"
        data-testid="model-detail-price-tier"
        class="badge badge-soft shrink-0 font-semibold tooltip tooltip-soft tooltip-bottom"
        :class="getPriceTierClass(model.priceTier)"
        :data-tip="priceTip"
      >
        {{ model.priceTier }}
        <span
          v-if="priceTip"
          class="sr-only"
        >
          {{ priceTip }}
        </span>
      </span>
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
      v-if="model.status === 'deprecated'"
      data-testid="model-detail-deprecated-notice"
      class="mt-2 flex items-start gap-1.5 p-2 rounded-xl text-xs text-error capability-chip"
    >
      <Icon
        name="lucide:triangle-alert"
        size="13"
        class="shrink-0 mt-px"
      />
      <span>{{ deprecationNotice }}</span>
    </p>
    <p
      v-else-if="model.retiredAt"
      data-testid="model-detail-retire-notice"
      class="mt-2 flex items-start gap-1.5 p-2 rounded-xl text-xs text-warning capability-chip"
    >
      <Icon
        name="lucide:calendar-clock"
        size="13"
        class="shrink-0 mt-px"
      />
      <span>{{ retireNotice }}</span>
    </p>
    <p
      v-if="isKeyMissing"
      data-testid="model-detail-key-notice"
      class="mt-2 flex items-start gap-1.5 p-2 rounded-xl text-xs text-warning capability-chip"
    >
      <Icon
        name="lucide:key-round"
        size="13"
        class="shrink-0 mt-px"
      />
      <span>
        {{ providerName }} models need your own API key before they can be
        selected.
        <NuxtLink
          to="/profile/keys"
          data-testid="model-detail-key-link"
          class="link font-semibold"
        >
          Add your {{ providerName }} key
        </NuxtLink>
        to enable them.
      </span>
    </p>
    <p
      v-if="model.description"
      class="mt-1.5 text-xs opacity-70"
    >
      {{ model.description }}
    </p>
    <div
      v-if="capabilities.length"
      data-testid="model-detail-capabilities"
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
      data-testid="model-detail-specs"
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
import type { Model } from '#shared/types/providers.d'

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
  model: Model
  providerName: string
  isKeyMissing?: boolean
}>()

const emit = defineEmits<{
  close: []
}>()

const detailId = computed<string>(() => {
  return `model-detail-${props.model.id}`
})

const retirementMonthNames = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
]

function formatRetirementDate(isoDate: string): string {
  const [year, month, day] = isoDate.split('-')
  const monthName = retirementMonthNames[Number(month) - 1]

  if (!year || !monthName || !day) {
    return isoDate
  }

  return `${monthName} ${Number(day)}, ${year}`
}

function localDateToday(): string {
  const now = new Date()
  const month = String(now.getMonth() + 1).padStart(2, '0')
  const day = String(now.getDate()).padStart(2, '0')

  return `${now.getFullYear()}-${month}-${day}`
}

const retireNotice = computed<string>(() => {
  const { retiredAt } = props.model

  if (!retiredAt) {
    return ''
  }

  const formatted = formatRetirementDate(retiredAt)

  return retiredAt > localDateToday()
    ? `Scheduled to retire on ${formatted}.`
    : `Retired on ${formatted}.`
})

const deprecationNotice = computed<string>(() => {
  const base = 'The provider has deprecated this model, so it can stop '
    + 'responding at any time and can no longer be selected. Pick a '
    + 'supported model instead.'
  const { retiredAt } = props.model

  if (!retiredAt) {
    return base
  }

  const today = localDateToday()
  const formatted = formatRetirementDate(retiredAt)

  return retiredAt > today
    ? `${base} It is scheduled to shut down on ${formatted}.`
    : `${base} It was shut down on ${formatted}.`
})

const priceTip = computed<string | undefined>(() => {
  return getModelPriceTip(props.model)
})

const capabilities = computed<CapabilityBadge[]>(() => {
  const { model } = props
  const badges: CapabilityBadge[] = []

  if (model.reasoning || model.reasoningAlwaysOn) {
    badges.push({
      label: model.reasoningAlwaysOn ? 'Always-on reasoning' : 'Reasoning',
      icon: 'lucide:brain',
      class: 'badge-warning',
    })
  }

  if (model.tools.includes('web_search')) {
    badges.push({
      label: 'Web search',
      icon: 'lucide:globe',
      class: 'badge-info',
    })
  }

  if (hasImageGenerationCapability(model)) {
    badges.push({
      label: 'Image generation',
      icon: 'lucide:image-plus',
      class: '[--badge-color:var(--color-violet-700)] '
        + 'dark:[--badge-color:var(--color-violet-200)]',
    })
  }

  if (hasVisionCapability(model)) {
    badges.push({
      label: 'Vision',
      icon: 'lucide:eye',
      class: 'badge-secondary',
    })
  }

  if (model.research) {
    badges.push({
      label: 'Deep research',
      icon: 'lucide:telescope',
      class: 'badge-success',
    })
  }

  return badges
})

const priceValue = computed<string>(() => {
  const { price } = props.model

  if (price.display) {
    return price.display
  }

  if (price.input && price.output) {
    return `${price.input} in / ${price.output} out per 1M tokens`
  }

  return price.input || '—'
})

const rows = computed<SpecRow[]>(() => {
  const { model, providerName } = props
  const contextLength = formatModelTokenLimit(model.contextLength)
  const maxOutputTokens = formatModelTokenLimit(model.maxOutputTokens)
  const specs: SpecRow[] = [{ label: 'Provider', value: providerName }]

  if (contextLength) {
    specs.push({ label: 'Context', value: contextLength })
  }

  if (maxOutputTokens) {
    specs.push({ label: 'Max output', value: maxOutputTokens })
  }

  if (model.modalities.input.length) {
    specs.push({
      label: 'Input',
      value: model.modalities.input.join(', '),
    })
  }

  if (model.modalities.output.length) {
    specs.push({
      label: 'Output',
      value: model.modalities.output.join(', '),
    })
  }

  specs.push({ label: 'Price', value: priceValue.value })

  if (model.reasoning?.mode === 'levels' && model.reasoning.levels.length) {
    specs.push({
      label: 'Reasoning levels',
      value: model.reasoning.levels.join(', '),
    })
  }

  if (model.research) {
    specs.push({
      label: 'Research cost',
      value: model.research.costEstimate,
    })
    specs.push({
      label: 'Research time',
      value: model.research.timeEstimate,
    })
  }

  if (model.releaseDate) {
    specs.push({
      label: 'Added on',
      value: formatReleaseDate(model.releaseDate),
    })
  }

  return specs
})
</script>
