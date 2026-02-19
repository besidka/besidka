<template>
  <div
    role="alert"
    class="alert alert-soft alert-warning mx-3 text-xs"
  >
    <Icon name="lucide:triangle-alert" size="16" />
    <div>
      <div>
        Social {{ page }} is unavailable in in-app browsers.
      </div>
      <div>
        Open this page in your system browser and try again.
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
withDefaults(defineProps<{
  page?: 'sign-in' | 'sign-up'
}>(), {
  page: 'sign-in',
})
</script>
