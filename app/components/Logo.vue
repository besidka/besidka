<template>
  <div class="flex items-center min-h-16 ml-4 mb-4">
    <NuxtLink
      to="/"
      class="w-full btn !p-0 !no-underline"
      :class="{
        'btn-circle btn-primary': !asLink,
        'btn-link': asLink,
      }"
      :disabled="!asLink && disabled"
    >
      <figure class="flex items-center gap-2">
        <ClientOnly v-if="asLink || disabled">
          <template #fallback>
            <span
              :style="{
                width: `${size.width}px`,
                height: `${size.height}px`,
              }"
              class="block skeleton"
            />
          </template>
          <NuxtImg
            :src="src"
            :alt="alt"
            v-bind="size"
          />
        </ClientOnly>
        <NuxtImg
          v-else
          :src="src"
          :alt="alt"
          v-bind="size"
        />
        <Transition name="title">
          <span
            v-show="!short"
            class="font-black text-2xl text-base-content"
          >
            chernenko.chat
          </span>
        </Transition>
      </figure>
    </NuxtLink>
  </div>
</template>

<script setup lang="ts">
interface Props {
  short?: boolean
  asLink?: boolean
  disabled?: boolean | null
  alt?: string
}

const props = withDefaults(defineProps<Props>(), {
  disabled: null,
  asLink: true,
  alt: 'Logo',
})

const colorMode = useColorMode()

const src = computed<string>(() => {
  let prefix = 'logo'

  if ((!props.disabled && !props.asLink) || colorMode.value === 'dark') {
    prefix += '-light'
  }

  return `/${prefix}.svg`
})

const size = computed<{ width: number, height: number }>(() => ({
  width: props.asLink ? 40 : 28,
  height: props.asLink ? 40 : 28,
}))
</script>

<style scoped>
@reference "~/assets/css/main.css";

.title-enter-active {
  @apply transition-all duration-500;
}

.title-enter-from {
  @apply opacity-0 transform -translate-x-8;
}
</style>
