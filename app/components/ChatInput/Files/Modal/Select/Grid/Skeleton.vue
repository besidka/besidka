<template>
  <div class="grid grid-cols-3 sm:grid-cols-4 gap-2">
    <div
      v-for="i in 8"
      :key="i"
      class="skeleton skeleton--default aspect-square rounded-box"
    />
  </div>
</template>
