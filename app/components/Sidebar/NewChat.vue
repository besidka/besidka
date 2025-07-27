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
          'max-sm:-translate-y-3': true,
        }"
        class="group border-none [background:none_!important] shadow-none md:hover:scale-90 transition-transform"
      >
        <template #icon>
          <Logo
            short
            :spinning="spinning"
            once
            class="size-14 sm:[.group:not(:focus-visible)_&]:size-11 group-focus:sm:size-9 [--color-logo-eyes-bg:var(--color-white)] sm:-scale-x-100"
            :class="{
              'text-accent': !disabled,
              'text-primary': disabled
            }"
            @mouseover="spinning = $device.isDesktop"
            @mouseleave="spinning = false"
            @blur="spinning = false"
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

const spinning = shallowRef<boolean>(false)
</script>
