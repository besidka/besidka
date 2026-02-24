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
        :tooltip="disabled ? null : undefined"
        tooltip-position="left"
        :class="{
          [`
            max-sm:-translate-y-3
            max-sm:active:!-translate-y-3
          `]: !disabled,
          'scale-70 sm:scale-90': disabled,
        }"
        class="group border-none ![background:unset] shadow-none sm:hover:scale-90 transition-transform"
      >
        <template #icon>
          <Logo
            short
            once
            class="size-14 sm:[.group:not(:focus-visible)_&]:size-11 group-focus:sm:size-9 [--color-logo-eyes-bg:var(--color-white)] sm:-scale-x-100"
            :class="{
              'text-accent': !disabled,
              'text-stone-400': disabled
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
