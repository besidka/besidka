<template>
  <div
    v-if="shouldRender"
    :data-tip="tooltipLabel"
    :class="{
      'tooltip tooltip-top': tooltip,
    }"
  >
    <span class="badge badge-xs" :class="badgeClass">
      <Icon
        :name="iconName"
        size="10"
      />
      <span v-if="label" class="whitespace-nowrap">
        {{ label }}
      </span>
    </span>
  </div>
</template>

<script setup lang="ts">
const props = withDefaults(defineProps<{
  expiresAt: Date | string | number | null
  tooltip?: boolean
  compact?: boolean
  showTerminalLabels?: boolean
  showOnlyAlerts?: boolean
}>(), {
  tooltip: true,
  compact: false,
  showTerminalLabels: true,
  showOnlyAlerts: false,
})

const DAY_IN_MILLISECONDS = 24 * 60 * 60 * 1000
const WARNING_THRESHOLD_DAYS = 5
const ERROR_THRESHOLD_DAYS = 1

const expirationDate = computed(() => {
  if (!props.expiresAt) {
    return null
  }

  const normalizedDate = new Date(props.expiresAt)

  if (Number.isNaN(normalizedDate.getTime())) {
    return null
  }

  return normalizedDate
})

const daysUntilExpiration = computed(() => {
  if (!expirationDate.value) {
    return null
  }

  const remainingMilliseconds = expirationDate.value.getTime() - Date.now()

  if (remainingMilliseconds <= 0) {
    return 0
  }

  return Math.ceil(remainingMilliseconds / DAY_IN_MILLISECONDS)
})

const isNoExpiry = computed(() => {
  return daysUntilExpiration.value === null
})

const isExpired = computed(() => {
  return daysUntilExpiration.value === 0
})

const severity = computed<
  'no-expiry' | 'info' | 'warning' | 'error'
>(() => {
  if (isNoExpiry.value) {
    return 'no-expiry'
  }

  if (
    daysUntilExpiration.value !== null
    && daysUntilExpiration.value <= ERROR_THRESHOLD_DAYS
  ) {
    return 'error'
  }

  if (
    daysUntilExpiration.value !== null
    && daysUntilExpiration.value <= WARNING_THRESHOLD_DAYS
  ) {
    return 'warning'
  }

  return 'info'
})

const shouldRender = computed(() => {
  if (!props.showOnlyAlerts) {
    return true
  }

  return severity.value === 'warning' || severity.value === 'error'
})

const label = computed(() => {
  if (isNoExpiry.value) {
    return props.showTerminalLabels ? 'No expiry' : ''
  }

  if (isExpired.value) {
    return props.showTerminalLabels ? 'Expired' : ''
  }

  if (props.compact) {
    return `${daysUntilExpiration.value}d`
  }

  if (daysUntilExpiration.value === 1) {
    return '1d left'
  }

  return `${daysUntilExpiration.value}d left`
})

const badgeClass = computed(() => {
  const colorClass = severity.value === 'no-expiry'
    ? 'badge-ghost'
    : severity.value === 'error'
      ? 'badge-error'
      : severity.value === 'warning'
        ? 'badge-warning'
        : 'badge-info'
  const spacingClass = label.value
    ? 'gap-1'
    : 'min-w-0 px-1 justify-center'

  return `${colorClass} ${spacingClass}`
})

const iconName = computed(() => {
  if (isNoExpiry.value) {
    return 'lucide:infinity'
  }

  if (isExpired.value) {
    return 'lucide:triangle-alert'
  }

  return 'lucide:clock-3'
})

const tooltipLabel = computed(() => {
  if (!expirationDate.value) {
    return 'No expiration date'
  }

  const formattedExpiration = new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(expirationDate.value)

  return `Expires ${formattedExpiration}`
})
</script>
