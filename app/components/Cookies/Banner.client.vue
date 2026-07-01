<script setup lang="ts">
const route = useRoute()
const isDetailsOpen = shallowRef<boolean>(false)
const ui = useCookieConsentUi()
const isCookieUiOpen = computed(() => ui.view.value !== 'hidden')
const isChatLayout = computed<boolean>(() => route.meta.layout === 'chat')
const isHomePage = computed<boolean>(() => route.path === '/')
</script>

<template>
  <div>
    <CookieConsentTrigger
      v-if="!isChatLayout"
      v-slot="{ isOpen }"
      data-testid="cookies-trigger"
      :title="
        isCookieUiOpen
          ? $t('cookieConsent.close')
          : $t('cookieConsent.title')
      "
      :aria-label="
        isCookieUiOpen
          ? $t('cookieConsent.close')
          : $t('cookieConsent.title')
      "
      class="
        cc-trigger
        btn btn-circle btn-ghost bubble rounded-full!
        fixed
        sm:bottom-[calc(var(--spacing)*6+var(--sab))]
        left-2 sm:left-4 z-40
        max-sm:btn-sm hitslop
      "
      :class="isHomePage
        ? 'max-sm:bottom-[calc(var(--spacing)*6+var(--sab))]'
        : 'max-sm:bottom-[calc(var(--spacing)*24+var(--sab))]'"
    >
      <span class="relative flex size-5 items-center justify-center">
        <Transition name="cc-icon">
          <Icon
            :key="isOpen ? 'x' : 'cookie'"
            :name="isOpen ? 'lucide:x' : 'lucide:cookie'"
            size="20"
          />
        </Transition>
      </span>
    </CookieConsentTrigger>

    <CookieConsentPopup
      v-if="!isChatLayout"
      v-slot="{
        titleId,
        categories,
        isDecided,
        isAllowed,
        withdrawAll,
        expand,
        close,
        consentId,
        consentDate,
      }"
      transition="cc-popup"
      class="
        fixed
        sm:bottom-[calc(var(--spacing)*20+var(--sab))]
        left-4
        z-40
        w-[min(20rem,calc(100vw-2rem))]
        focus:outline-none focus-visible:outline-none
      "
      :class="isHomePage
        ? 'max-sm:bottom-[calc(var(--spacing)*20+var(--sab))]'
        : 'max-sm:bottom-[calc(var(--spacing)*38+var(--sab))]'"
    >
      <div
        data-testid="cookies-popup"
        class="bubble card card-sm gap-0 p-0"
      >
        <div class="card-body p-3 gap-3">
          <div class="flex items-center justify-between gap-2">
            <h2
              :id="titleId"
              class="font-semibold text-sm leading-tight"
            >
              {{ $t('cookieConsent.title') }}
            </h2>
            <button
              type="button"
              data-testid="cookies-close"
              class="btn btn-ghost btn-circle btn-xs shrink-0 translate-x-2"
              :aria-label="$t('cookieConsent.close')"
              @click="close()"
            >
              <Icon name="lucide:x" size="14" />
            </button>
          </div>

          <p class="text-xs text-base-content/60 font-medium">
            {{ $t('cookieConsent.currentState') }}
          </p>

          <ul class="flex flex-col gap-2">
            <li
              v-for="category in categories"
              :key="category.id"
              :data-testid="`cookies-state-${category.id}`"
              :data-allowed="
                category.required || isAllowed(category.id)
                  ? 'true'
                  : 'false'
              "
              class="flex items-center justify-between gap-2"
            >
              <span class="text-xs">
                {{ $t(`cookieConsent.categories.${category.id}.title`) }}
              </span>
              <template v-if="category.required">
                <Icon
                  name="lucide:lock"
                  size="14"
                  class="shrink-0 text-base-content/40"
                  :aria-label="$t('cookieConsent.required')"
                />
              </template>
              <template v-else-if="isAllowed(category.id)">
                <Icon
                  name="lucide:check"
                  size="14"
                  class="shrink-0 text-accent"
                />
              </template>
              <template v-else>
                <Icon
                  name="lucide:x"
                  size="14"
                  class="shrink-0 text-base-content/40"
                />
              </template>
            </li>
          </ul>

          <template v-if="isDecided">
            <button
              type="button"
              data-testid="cookies-details-toggle"
              class="link link-accent text-xs self-start flex items-center gap-1"
              @click="isDetailsOpen = !isDetailsOpen"
            >
              <span>
                {{
                  isDetailsOpen
                    ? $t('cookieConsent.details.hide')
                    : $t('cookieConsent.details.show')
                }}
              </span>
              <Icon
                :name="
                  isDetailsOpen
                    ? 'lucide:chevron-up'
                    : 'lucide:chevron-down'
                "
                size="12"
              />
            </button>

            <div
              v-if="isDetailsOpen"
              class="
                bg-base-200/50 p-3 rounded-lg text-xs
                flex flex-col gap-1.5
              "
            >
              <div class="flex flex-col gap-0.5">
                <span class="text-base-content/60">
                  {{ $t('cookieConsent.details.date') }}
                </span>
                <span
                  data-testid="cookies-consent-date"
                  class="text-base-content/80"
                >
                  {{
                    consentDate
                      ? new Date(consentDate).toLocaleString()
                      : '—'
                  }}
                </span>
              </div>
              <div class="flex flex-col gap-0.5">
                <span class="text-base-content/60">
                  {{ $t('cookieConsent.details.id') }}
                </span>
                <span
                  data-testid="cookies-consent-id"
                  class="font-mono break-all text-base-content/80"
                >
                  {{ consentId ?? '—' }}
                </span>
              </div>
            </div>
          </template>

          <div class="grid xxs:grid-cols-2 items-center gap-1.5">
            <button
              type="button"
              data-testid="cookies-withdraw"
              class="btn btn-sm btn-ghost btn-block hitslop"
              @click="withdrawAll()"
            >
              {{ $t('cookieConsent.actions.withdraw') }}
            </button>
            <button
              type="button"
              data-testid="cookies-change"
              class="btn btn-sm btn-accent btn-block max-xxs:-order-1 hitslop"
              @click="expand()"
            >
              {{ $t('cookieConsent.actions.change') }}
            </button>
          </div>
        </div>
      </div>
    </CookieConsentPopup>

    <CookieConsentModal
      v-slot="{
        titleId,
        categories,
        draft,
        toggleDraft,
        switchProps,
        commitDraft,
        allowAll,
        withdrawAll,
        close,
      }"
      :auto-show="isChatLayout"
      transition="cc-modal"
      class="
        fixed inset-0 z-50
        flex items-center justify-center
        bg-black/50
        [&_[role=dialog]]:outline-none
      "
    >
      <div
        data-testid="cookies-modal"
        class="
          bubble card
          w-[calc(100vw-2rem)] max-w-2xl
          max-h-[calc(100dvh-2rem)] flex flex-col
          p-0 gap-0
          bg-base-100/80
        "
      >
        <div class="shrink-0 flex items-center justify-between gap-3 p-4 pb-3">
          <h2
            :id="titleId"
            class="text-lg font-bold"
          >
            {{ $t('cookieConsent.title') }}
          </h2>
          <button
            type="button"
            data-testid="cookies-close"
            class="btn btn-ghost btn-circle btn-sm"
            :aria-label="$t('cookieConsent.close')"
            @click="close()"
          >
            <Icon name="lucide:x" size="18" />
          </button>
        </div>

        <div class="flex-1 min-h-0 overflow-y-auto px-4 pb-2">
          <p class="text-sm text-base-content/70 mb-4">
            {{ $t('cookieConsent.description') }}
          </p>

          <ul class="flex flex-col gap-4">
            <li
              v-for="category in categories"
              :key="category.id"
              class="flex flex-col gap-2"
            >
              <div class="flex items-center justify-between gap-3">
                <span class="font-semibold text-sm">
                  {{
                    $t(`cookieConsent.categories.${category.id}.title`)
                  }}
                </span>
                <template v-if="category.required">
                  <Icon
                    name="lucide:lock"
                    size="16"
                    class="shrink-0 text-base-content/40"
                    :aria-label="$t('cookieConsent.required')"
                  />
                </template>
                <template v-else>
                  <label
                    class="
                      toggle toggle-sm
                      text-base-content/40
                      has-[:checked]:text-accent
                      relative
                    "
                  >
                    <input
                      type="checkbox"
                      :data-testid="`cookies-toggle-${category.id}`"
                      v-bind="switchProps(category.id)"
                      :checked="draft[category.id]"
                      @change="toggleDraft(category.id)"
                    >
                    <Icon
                      name="lucide:x"
                      size="10"
                      class="
                        pointer-events-none
                        absolute top-2/5 left-1/2
                        -translate-x-1/2 -translate-y-1/2
                      "
                    />
                    <Icon
                      name="lucide:check"
                      size="10"
                      class="
                        pointer-events-none
                        absolute top-2/5 left-1/2
                        -translate-x-1/2 -translate-y-1/2
                      "
                    />
                  </label>
                </template>
              </div>

              <p class="text-xs text-base-content/60">
                {{
                  $t(`cookieConsent.categories.${category.id}.description`)
                }}
              </p>

              <template v-if="category.entries?.length">
                <details
                  class="collapse collapse-arrow bg-base-200/50 rounded-lg shadow-none"
                >
                  <summary
                    class="
                      collapse-title text-xs font-medium py-2 px-3
                      min-h-0 leading-5
                    "
                  >
                    {{
                      $t('cookieConsent.entriesSummary', {
                        count: category.entries.length,
                      })
                    }}
                  </summary>
                  <div class="collapse-content px-3 pb-1 flex flex-col gap-1">
                    <details
                      v-for="entry in category.entries"
                      :key="entry.id"
                      class="collapse collapse-arrow bg-base-200/90 rounded-md"
                    >
                      <summary
                        class="
                          flex items-center max-xs:flex-col max-xs:items-start
                          gap-1 py-2 px-3
                          collapse-title text-xs font-medium
                          min-h-0 leading-5
                        "
                      >
                        <code class="font-mono">{{ entry.name }}</code>
                        <span class="badge badge-ghost badge-xs">
                          {{
                            $t(
                              'cookieConsent.storageTypes.'
                                + (entry.type ?? 'cookie'),
                            )
                          }}
                        </span>
                      </summary>
                      <div class="collapse-content px-3 pb-3">
                        <p class="text-xs text-base-content/70 mb-1">
                          {{
                            $t(
                              `cookieConsent.entries.${entry.id}.description`,
                            )
                          }}
                        </p>
                        <p class="text-xs text-base-content/50">
                          {{ $t('cookieConsent.entryDuration') }}:
                          {{
                            $t(
                              `cookieConsent.entries.${entry.id}.duration`,
                            )
                          }}
                        </p>
                        <p class="text-xs text-base-content/50">
                          {{ $t('cookieConsent.entryStorage') }}:
                          {{
                            $t(
                              'cookieConsent.storageTypes.'
                                + (entry.type ?? 'cookie'),
                            )
                          }}
                        </p>
                      </div>
                    </details>
                  </div>
                </details>
              </template>
              <template v-else>
                <p class="text-xs text-base-content/40 italic">
                  {{ $t('cookieConsent.empty') }}
                </p>
              </template>
            </li>
          </ul>
        </div>

        <div
          class="
            shrink-0 flex flex-wrap gap-2 justify-end
            max-sm:grid max-sm:grid-cols-1 max-sm:justify-items-center
            p-4 pt-3
            border-t border-base-content/10
          "
        >
          <button
            type="button"
            data-testid="cookies-withdraw"
            class="btn btn-sm btn-ghost max-sm:btn-block"
            @click="withdrawAll()"
          >
            {{ $t('cookieConsent.actions.withdraw') }}
          </button>
          <button
            type="button"
            data-testid="cookies-allow-selected"
            class="
              btn btn-sm max-sm:btn-block
              light:btn-primary light:btn-outline
              dark:btn-secondary
            "
            @click="commitDraft()"
          >
            {{ $t('cookieConsent.actions.allowSelected') }}
          </button>
          <button
            type="button"
            data-testid="cookies-allow-all"
            class="btn btn-sm btn-accent max-sm:btn-block"
            @click="allowAll()"
          >
            {{ $t('cookieConsent.actions.allowAll') }}
          </button>
        </div>
      </div>
    </CookieConsentModal>
  </div>
</template>
