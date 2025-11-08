<template>
  <Teleport to="body">
    <div
      v-show="isPulling"
      class="fixed inset-0 z-50 pointer-events-none"
    >
      <div
        class="absolute top-0 left-1/2 -translate-x-1/2 transition-all duration-200"
        :style="{
          transform: `translateY(${
            Math.max(pullDistance - 20, 0)
          }px)`,
          opacity: isPulling ? Math.min(pullDistance / 60, 1) : 1
        }"
      >
        <div class="grid place-items-center size-10 bg-base-100 rounded-full shadow-lg border border-base-300">
          <span
            v-show="isRefreshing || pullDistance >= 70"
            class="loading loading-spinner loading-sm"
          />
          <span
            v-show="!isRefreshing && pullDistance < 70"
            class="grid place-items-center"
          >
            <Icon name="lucide:arrow-down" />
          </span>
        </div>
      </div>
    </div>
  </Teleport>
</template>

<script setup lang="ts">
const { isPulling, isRefreshing, pullDistance } = usePullToRefresh()
</script>
