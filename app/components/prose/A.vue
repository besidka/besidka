<template>
  <NuxtLink
    :href="href"
    :target="target"
    @click="onClick"
  >
    <slot />
  </NuxtLink>
</template>

<script setup lang="ts">
const props = withDefaults(defineProps<{
  href?: string
  target?: string
}>(), {
  href: '',
  target: undefined,
})

const { openResearchLink } = useResearchLink()

function resolveExternalUrl(href: string): string | null {
  if (!import.meta.client) {
    return null
  }

  let url: URL

  try {
    url = new URL(href, window.location.href)
  } catch {
    return null
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return null
  }

  if (url.origin === window.location.origin) {
    return null
  }

  return url.toString()
}

function onClick(event: MouseEvent) {
  if (event.defaultPrevented) {
    return
  }

  if (event.button !== 0) {
    return
  }

  if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
    return
  }

  const url = resolveExternalUrl(props.href)

  if (!url) {
    return
  }

  event.preventDefault()
  openResearchLink(url)
}
</script>
