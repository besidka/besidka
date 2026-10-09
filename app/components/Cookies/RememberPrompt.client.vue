<template>
  <UiAlert
    fixed
    data-testid="cookies-remember-prompt"
    class="-translate-y-full"
    :class="{
      'transition-transform duration-500 ease-in': !mounted,
      'translate-y-0': visible,
      '!hidden': !isVisible,
    }"
    @click="dismissRequest"
  >
    <span>
      {{ $t('cookieConsent.prompt.message') }}
    </span>
    <div class="mt-2 flex justify-center gap-2">
      <UiButton
        data-testid="cookies-remember"
        mode="accent"
        size="xs"
        :text="$t('cookieConsent.prompt.remember')"
        @click="grantRequest('preferences')"
      />
      <UiButton
        data-testid="cookies-remember-dismiss"
        mode="accent"
        size="xs"
        :text="$t('cookieConsent.prompt.notNow')"
        @click="dismissRequest"
      />
    </div>
  </UiAlert>
</template>

<script setup lang="ts">
const { mounted, visible } = useAnimateAppear()
const { consentRequest, grantRequest, dismissRequest } = useCookieConsentUi()
const router = useRouter()

const isVisible = computed<boolean>(() => {
  return consentRequest.value === 'preferences'
})

const removeAfterEachHook = router.afterEach(() => {
  dismissRequest()
})

onBeforeUnmount(removeAfterEachHook)
</script>
