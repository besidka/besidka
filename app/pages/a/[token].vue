<template>
  <div
    class="mx-auto flex min-h-0 w-full max-w-7xl flex-1 flex-col gap-2 p-2 sm:gap-3 sm:p-3"
    data-testid="artifact-share-page"
    :data-state="pageState"
  >
    <template v-if="pageState === 'ready' && share">
      <a
        href="#artifact-share-report"
        class="sr-only focus:not-sr-only focus:self-start focus:rounded-field focus:bg-base-100 focus:px-3 focus:py-1 focus:text-sm"
        data-testid="artifact-share-skip-to-report"
        @click.prevent="focusReportButton"
      >
        Skip to report
      </a>
      <section
        role="region"
        aria-label="About this artifact"
        class="alert alert-info alert-soft shrink-0 items-start text-sm"
        data-testid="artifact-share-banner"
      >
        <Icon
          name="lucide:sparkles"
          size="16"
          class="mt-0.5 shrink-0"
          aria-hidden="true"
        />
        <div class="min-w-0 grow">
          <h1
            class="font-medium break-words"
            data-testid="artifact-share-title"
          >
            {{ share.title }}
          </h1>
          <p>{{ ARTIFACT_SHARE_BANNER_TEXT }}</p>
          <p class="text-base-content/70">
            {{ ARTIFACT_SHARE_BANNER_WARNING }}
          </p>
          <p
            v-if="isSignInCaptionShown"
            class="text-base-content/70"
            data-testid="artifact-share-sign-in"
          >
            <NuxtLink
              :to="signInLocation"
              class="link"
            >
              Sign in to save your progress
            </NuxtLink>
          </p>
        </div>
        <button
          id="artifact-share-report"
          ref="reportButton"
          type="button"
          class="btn btn-ghost btn-sm min-h-6 shrink-0"
          aria-haspopup="dialog"
          data-testid="artifact-share-report"
          @click="isReportOpen = true"
        >
          <Icon
            name="lucide:flag"
            size="14"
            aria-hidden="true"
          />
          Report
        </button>
      </section>
      <div
        class="relative min-h-[60svh] flex-1 overflow-hidden rounded-box border border-base-300 bg-base-100 sm:min-h-0"
        data-testid="artifact-share-frame"
      >
        <ChatArtifactFrame
          :key="token"
          :title="share.title"
          :result="frameResult"
          :partial="null"
          :artifact-id="share.artifactId"
          :version="share.version"
          source="public-share"
          :share-token="token"
          :share-capabilities="share.capabilities"
          display-mode-override="fullscreen"
        />
      </div>
      <ArtifactReportModal
        v-model:open="isReportOpen"
        :title="share.title"
        :endpoint="REPORT_ENDPOINT"
        :headers="shareHeaders"
      />
    </template>

    <div
      v-else-if="pageState === 'loading'"
      class="flex min-h-0 flex-1 flex-col gap-2 sm:gap-3"
      aria-busy="true"
      data-testid="artifact-share-loading"
    >
      <span class="sr-only">Loading the artifact</span>
      <span class="skeleton skeleton--default block h-20 w-full shrink-0" />
      <span class="skeleton skeleton--default block min-h-[60svh] w-full flex-1 sm:min-h-0" />
    </div>

    <div
      v-else
      class="grid flex-1 place-items-center p-4"
    >
      <div
        class="flex max-w-md flex-col items-center gap-3 text-center"
        :data-testid="`artifact-share-${pageState}`"
      >
        <Icon
          :name="stateIcon"
          size="32"
          class="text-base-content/60"
          aria-hidden="true"
        />
        <h1 class="text-xl font-bold">
          {{ stateCopy.title }}
        </h1>
        <p class="text-sm text-base-content/70">
          {{ stateCopy.description }}
        </p>
        <NuxtLink
          v-if="pageState === 'taken-down'"
          to="/privacy-policy#reports-and-notices-about-content"
          class="link text-sm"
          data-testid="artifact-share-takedown-link"
        >
          How reports and removals work
        </NuxtLink>
        <button
          v-if="pageState === 'error'"
          type="button"
          class="btn btn-sm min-h-6"
          data-testid="artifact-share-retry"
          @click="retry"
        >
          Retry
        </button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import type { ToolResultContent } from '@besidka/artifacts-protocol'
import {
  ARTIFACT_SHARE_HEADER,
  ARTIFACT_SHARE_PATH_PREFIX,
} from '#shared/utils/artifacts'
import {
  ARTIFACT_SHARE_BANNER_TEXT,
  ARTIFACT_SHARE_BANNER_WARNING,
  ARTIFACT_SHARE_STATE_COPY,
  resolveArtifactSharePageState,
} from '~/utils/artifact-share-page'
import type { ArtifactSharePageState } from '~/utils/artifact-share-page'

definePageMeta({
  auth: false,
  layout: 'artifact-share',
})

const REPORT_ENDPOINT = '/api/v1/artifact-shares/current/report'

const route = useRoute('a-token')
const { loggedIn } = useAuth()
const reportButton = useTemplateRef<HTMLButtonElement>('reportButton')
const isReportOpen = shallowRef<boolean>(false)

const token = computed<string>(() => {
  return String(route.params.token ?? '')
})

const shareHeaders = computed<Record<string, string>>(() => {
  return { [ARTIFACT_SHARE_HEADER]: token.value }
})

const { data: share, error, status, refresh } = await useFetch(
  '/api/v1/artifact-shares/current',
  {
    key: () => `artifact-share-current:${token.value}`,
    server: false,
    headers: shareHeaders,
  },
)

const pageState = computed<ArtifactSharePageState>(() => {
  return resolveArtifactSharePageState({
    status: status.value,
    hasData: !!share.value,
    error: error.value,
  })
})

const stateCopy = computed(() => {
  return ARTIFACT_SHARE_STATE_COPY[pageState.value]
})

const stateIcon = computed<string>(() => {
  if (pageState.value === 'taken-down') {
    return 'lucide:shield-x'
  }

  return pageState.value === 'error'
    ? 'lucide:circle-alert'
    : 'lucide:link-2-off'
})

const frameResult = computed<ToolResultContent | null>(() => {
  const value = share.value

  if (!value) {
    return null
  }

  return {
    kind: value.kind,
    title: value.title,
    content: value.content,
    artifactId: value.artifactId,
    version: value.version,
  }
})

const isSignInCaptionShown = computed<boolean>(() => {
  return !loggedIn.value && share.value?.capabilities.storageAllowed === true
})

const signInLocation = computed(() => {
  return {
    path: '/signin',
    query: { next: `${ARTIFACT_SHARE_PATH_PREFIX}${token.value}` },
  }
})

useSeoMeta({
  title: () => share.value?.title || 'Shared artifact',
  robots: 'noindex, nofollow',
})

useHead({
  meta: [{ name: 'ai-generated', content: 'true' }],
})

function focusReportButton() {
  reportButton.value?.focus()
}

async function retry() {
  await refresh()
}
</script>
