<template>
  <ClientOnly>
    <template #fallback>
      <SidebarSkeleton />
    </template>

    <div class="max-sm:px-3">
      <UiButton
        to="/chats/new"
        :disabled="disabled"
        :mode="mode"
        :icon-only="true"
        title="Start new chat"
        circle
        tooltip-position="left"
        :class="{
          'max-sm:-translate-y-3': !disabled,
        }"
        class="border-none [background:none_!important] shadow-none md:hover:scale-90 transition-transform"
      >
        <template #icon>
          <Logo
            short
            class="size-14 sm:size-11 [--color-logo-eyes-bg:var(--color-white)]"
            :class="{
              'text-accent': !disabled,
              'text-primary': disabled
            }"
          />
        </template>
      </UiButton>
    </div>
  </ClientOnly>
</template>

<script setup lang="ts">
import type { ButtonProps } from '~/types/button.d'

const route = useRoute()

const disabled = computed<boolean>(() => {
  return route.path === '/chats/new'
})

const mode = computed<ButtonProps['mode']>(() => {
  return disabled.value ? 'primary' : 'accent'
})
</script>
