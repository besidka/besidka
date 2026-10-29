<template>
  <UiBubble class="grow sm:w-lg max-w-full">
    <div
      v-if="!request"
      class="grid gap-4 p-3 text-center"
      data-testid="oauth-consent-invalid"
    >
      <template v-if="status === 'pending'">
        <div class="skeleton skeleton--default h-8 w-2/3 mx-auto" />
        <div class="skeleton skeleton--default h-24 w-full" />
      </template>
      <template v-else>
        <h1 class="text-2xl font-bold">
          This connection request isn't valid
        </h1>
        <p class="opacity-80">
          {{ invalidReason }}
        </p>
        <UiButton
          to="/chats/new"
          mode="default"
          outline
          text="Back to Besidka"
        />
      </template>
    </div>
    <div
      v-else
      class="grid gap-6 p-3"
    >
      <div class="grid justify-items-center gap-3 text-center">
        <div class="avatar avatar-placeholder">
          <div class="w-14 rounded-box bg-base-200">
            <Icon
              name="lucide:plug"
              size="28"
              aria-hidden="true"
            />
          </div>
        </div>
        <h1 class="text-2xl font-bold text-balance">
          Connect {{ request.client.name }} to Besidka
        </h1>
        <p class="text-sm opacity-80">
          <a
            v-if="request.client.uri"
            :href="request.client.uri"
            target="_blank"
            rel="noopener noreferrer"
            class="underline hover:no-underline"
          >{{ request.client.name }}</a>
          <span v-else>{{ request.client.name }}</span>
          wants to access your Besidka account. After you decide, you go back
          to
          <strong
            class="break-all"
            data-testid="oauth-redirect-host"
          >{{ request.redirectHost || 'the app' }}</strong>.
        </p>
        <p class="text-xs opacity-70">
          The app chose its own name. Besidka hasn't verified it, so check
          that you started this connection yourself.
        </p>
      </div>
      <div class="flex flex-wrap items-center justify-between gap-2 text-sm">
        <span>
          Signed in as
          <strong data-testid="oauth-signed-in-email">{{ user?.email }}</strong>
        </span>
        <button
          type="button"
          class="underline hover:no-underline"
          :disabled="isSubmitting"
          data-testid="oauth-switch-account"
          @click="switchAccount"
        >
          Use a different account
        </button>
      </div>
      <OAuthScopePicker
        v-model="selectedScopes"
        :scopes="request.scopes"
        :disabled="isSubmitting"
      />
      <div
        class="rounded-box bg-base-200/60 p-4 text-sm grid gap-2"
        data-testid="oauth-consent-legal"
      >
        <p>
          Your chats, projects and memory can contain sensitive information,
          including information about other people.
        </p>
        <p>
          By approving, you explicitly consent to Besidka sending the data
          you allow above to {{ request.client.name }}. The app may be run
          from outside the EU, and Besidka has no contract with it, so its
          own terms and privacy policy apply to what it receives.
          <NuxtLink
            to="/privacy-policy#connected-ai-apps"
            target="_blank"
            class="underline hover:no-underline"
          >How connected apps work</NuxtLink>
        </p>
        <p>
          You can disconnect the app at any time in Profile, Connected apps.
        </p>
      </div>
      <div class="grid grid-cols-2 gap-3">
        <UiButton
          mode="default"
          outline
          block
          text="Deny"
          :disabled="isSubmitting"
          data-testid="oauth-consent-deny"
          @click="submit(false)"
        />
        <UiButton
          mode="primary"
          block
          :text="isSubmitting ? 'Connecting...' : 'Approve'"
          :disabled="isSubmitting"
          data-testid="oauth-consent-approve"
          @click="submit(true)"
        />
      </div>
    </div>
  </UiBubble>
</template>
<script setup lang="ts">
import { parseError } from 'evlog'
import { MCP_IDENTITY_SCOPES } from '#shared/utils/mcp-oauth-scopes'

definePageMeta({
  layout: 'auth',
  auth: {
    only: 'user',
  },
})

useSeoMeta({
  title: 'Connect an app',
  robots: 'noindex, nofollow',
})

const $auth = useAuth()
const { user } = $auth
const route = useRoute()

const signedOAuthQuery = computed<SignedOAuthQuery | null>(() => {
  return pickSignedOAuthQuery(route.query)
})
const oauthQuery = computed<string>(() => {
  return signedOAuthQuery.value
    ? signedOAuthQueryToString(signedOAuthQuery.value)
    : ''
})

const { data: request, error, status } = await useFetch(
  '/api/v1/profiles/connected-apps/authorization-request',
  {
    query: { oauth_query: oauthQuery },
    immediate: !!oauthQuery.value,
    watch: false,
  },
)

const selectedScopes = ref<string[]>([])
const isSubmitting = shallowRef<boolean>(false)

const invalidReason = computed<string>(() => {
  if (!oauthQuery.value) {
    return 'The link is missing the details of the app that asked to connect.'
  }

  return error.value?.message
    || 'It may have expired. Go back to the app and start again.'
})

const identityScopeSet = new Set<string>(MCP_IDENTITY_SCOPES)

function buildApprovedScope(): string {
  const requestedIdentityScopes = (request.value?.scopes ?? [])
    .filter((scope) => {
      return identityScopeSet.has(scope)
    })

  return [...requestedIdentityScopes, ...selectedScopes.value].join(' ')
}

function isRequestExpired(): boolean {
  const expiresAt = request.value?.expiresAt

  return !expiresAt || new Date(expiresAt).getTime() < Date.now()
}

async function submit(accept: boolean) {
  if (isSubmitting.value) {
    return
  }

  if (isRequestExpired()) {
    useErrorMessage(
      'This connection request has expired',
      'Go back to the app you were connecting and start again.',
    )

    return
  }

  isSubmitting.value = true

  try {
    const { data, error: consentError } = await $auth.client.oauth2.consent(
      accept
        ? { accept: true, scope: buildApprovedScope() }
        : { accept: false },
    )

    if (consentError) {
      useErrorMessage(
        consentError.message || 'Failed to save your decision',
      )
      isSubmitting.value = false

      return
    }

    if (!readOAuthRedirectUrl(data)) {
      isSubmitting.value = false
    }
  } catch (exception) {
    const parsedException = parseError(exception)

    useErrorMessage(
      parsedException.message || 'Failed to save your decision',
      parsedException.why,
    )
    isSubmitting.value = false
  }
}

async function switchAccount() {
  const signedQuery = signedOAuthQuery.value

  await $auth.signOut()
  await navigateTo(appendSignedOAuthQueryToPath('/signin', signedQuery))
}
</script>
