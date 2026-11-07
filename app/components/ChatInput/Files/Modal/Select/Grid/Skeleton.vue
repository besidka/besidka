<template>
  <div class="grid grid-cols-3 sm:grid-cols-4 lg:grid-cols-6 gap-2 py-1">
    <div
      v-for="i in 12"
      :key="i"
      class="skeleton skeleton--default aspect-square rounded-box"
      :class="{ 'max-sm:hidden': i > 9 }"
    />
  </div>
</template>
