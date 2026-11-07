<template>
  <label class="flex items-center gap-2 text-xs text-base-content/70">
    Version
    <select
      v-model="version"
      class="select select-sm w-28"
      data-testid="side-panel-demo-version"
    >
      <option
        v-for="option in versions"
        :key="option"
        :value="option"
      >
        v{{ option }}
      </option>
    </select>
  </label>
</template>

<script setup lang="ts">
const versions = [1, 2, 3] as const

const version = shallowRef<number>(3)
</script>
