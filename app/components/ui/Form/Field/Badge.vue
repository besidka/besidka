<template>
  <template v-if="validated">
    <template v-if="error">
      <span class="indicator-item status z-10 status-lg status-error motion-safe:animate-ping" />
      <span class="indicator-item status z-20 status-lg status-error" />
    </template>
    <template v-else-if="success">
      <span
        class="indicator-item badge z-10 badge-success motion-safe:animate-[ping_1s]"
        :class="{
          'badge-sm': !size || size === 'sm',
          'badge-xs': size === 'xs',
        }"
      />
      <span
        class="indicator-item badge z-20 badge-sm status-success"
        :class="{
          'badge-sm': !size || size === 'sm',
          'badge-xs': size === 'xs',
        }"
      >
        <Icon
          :name="iconName"
          size="iconSize"
          class="!bg-base-100"
        />
      </span>
    </template>
  </template>
  <span
    v-else-if="!required"
    class="indicator-item indicator-top indicator-end badge badge-xs z-10 badge-soft lowercase -translate-x-1 -translate-y-1/2"
    :class="{
      'badge-sm': !size || size === 'sm',
      'badge-xs': size === 'xs',
    }"
  >
    {{ labelOptional }}
  </span>
</template>

<script setup lang="ts">
import type { FieldSize } from '~/types/field.d'

withDefaults(defineProps<{
  validated?: boolean
  required?: boolean
  error?: string
  success?: boolean
  iconName?: string
  iconSize?: string | number
  labelRequired?: string
  labelOptional?: string
  size?: FieldSize
}>(), {
  error: '',
  iconName: 'lucide:check',
  iconSize: '20',
  labelRequired: 'Required',
  labelOptional: 'Optional',
  size: 'sm',
})
</script>
