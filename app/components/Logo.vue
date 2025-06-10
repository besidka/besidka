<template>
  <div class="flex items-center min-h-16 ml-4 mb-4">
      <NuxtLink
        to="/"
        class="btn btn-link p-0 !no-underline"
      >
        <figure class="flex items-center">
          <ClientOnly>
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
          <Transition name="title">
            <span
              v-show="!short"
              class="ml-2 font-black text-2xl dark:text-white"
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
  alt?: string
}

withDefaults(defineProps<Props>(), {
  alt: 'Logo',
})

const colorMode = useColorMode()

const src = computed<string>(() => {
  let prefix = 'logo'

  if (colorMode.value === 'dark') {
    prefix += '-light'
  }

  return `/${prefix}.svg`
})

const size = computed<{ width: number, height: number }>(() => ({
  width: 40,
  height: 40,
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
