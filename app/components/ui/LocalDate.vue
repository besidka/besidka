<template>
  <time :datetime="isoValue">{{ text }}</time>
</template>

<script setup lang="ts">
import type { LocalDateValue } from '~/utils/local-date'

const props = withDefaults(defineProps<{
  value: LocalDateValue
  withTime?: boolean
}>(), {
  withTime: false,
})

const isMounted = shallowRef<boolean>(false)

const isoValue = computed<string | undefined>(() => {
  return toIsoDateTime(props.value)
})

const text = computed<string>(() => {
  if (!isMounted.value) {
    return ''
  }

  return formatLocalDate(props.value, props.withTime)
})

onMounted(() => {
  isMounted.value = true
})
</script>
