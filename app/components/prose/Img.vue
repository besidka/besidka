<template>
  <NuxtImg
    v-if="allowedSrc"
    :src="allowedSrc"
    :alt="props.alt"
    :width="props.width"
    :height="props.height"
    data-testid="prose-img"
  />
  <button
    v-else-if="externalUrl"
    type="button"
    class="btn btn-xs btn-ghost inline-flex max-w-full items-center gap-1
      align-middle font-normal text-base-content/70"
    data-testid="prose-img-blocked"
    :aria-label="blockedAriaLabel"
    @click="onClick"
  >
    <Icon
      name="lucide:image-off"
      class="size-3.5 shrink-0"
      aria-hidden="true"
    />
    <span class="truncate">External image blocked</span>
    <span class="truncate text-base-content/50">{{ hostname }}</span>
  </button>
  <span
    v-else
    class="inline-flex max-w-full items-center gap-1 align-middle text-xs
      text-base-content/50"
    data-testid="prose-img-blocked"
  >
    <Icon
      name="lucide:image-off"
      class="size-3.5 shrink-0"
      aria-hidden="true"
    />
    <span class="truncate">External image blocked</span>
  </span>
</template>

<script setup lang="ts">
const props = withDefaults(defineProps<{
  src?: string
  alt?: string
  width?: string | number
  height?: string | number
}>(), {
  src: '',
  alt: '',
  width: undefined,
  height: undefined,
})

const ALLOWED_DATA_IMAGE_PATTERN
  = /^data:image\/(?:png|jpe?g|gif|webp|avif)[;,]/i

const { openResearchLink } = useResearchLink()
const appBaseUrl = useRuntimeConfig().app.baseURL
const appOrigin = useRequestURL().origin

interface ClassifiedImage {
  allowedSrc: string
  externalUrl: string
}

function withAppBaseUrl(path: string): string {
  const baseUrl = appBaseUrl.endsWith('/') ? appBaseUrl : `${appBaseUrl}/`

  if (baseUrl === '/' || path.startsWith(baseUrl)) {
    return path
  }

  return `${baseUrl.slice(0, -1)}${path}`
}

function classifyImage(source: string): ClassifiedImage {
  const blocked: ClassifiedImage = { allowedSrc: '', externalUrl: '' }
  let resolved: URL

  if (!source.trim()) {
    return blocked
  }

  try {
    resolved = new URL(source, appOrigin)
  } catch {
    return blocked
  }

  if (resolved.protocol === 'data:') {
    if (ALLOWED_DATA_IMAGE_PATTERN.test(resolved.href)) {
      return { allowedSrc: resolved.href, externalUrl: '' }
    }

    return blocked
  }

  if (resolved.protocol !== 'http:' && resolved.protocol !== 'https:') {
    return blocked
  }

  if (resolved.origin !== appOrigin) {
    return { allowedSrc: '', externalUrl: resolved.href }
  }

  return {
    allowedSrc: withAppBaseUrl(
      `${resolved.pathname}${resolved.search}${resolved.hash}`,
    ),
    externalUrl: '',
  }
}

const classifiedImage = computed<ClassifiedImage>(() => {
  return classifyImage(props.src)
})

const allowedSrc = computed<string>(() => {
  return classifiedImage.value.allowedSrc
})

const externalUrl = computed<string>(() => {
  return classifiedImage.value.externalUrl
})

const hostname = computed<string>(() => {
  return externalUrl.value ? formatResearchLinkLabel(externalUrl.value) : ''
})

const blockedAriaLabel = computed<string>(() => {
  return `External image blocked from ${hostname.value}. Open link`
})

function onClick() {
  if (!externalUrl.value) {
    return
  }

  openResearchLink(externalUrl.value)
}
</script>
