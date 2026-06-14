<script setup lang="ts">
import {
  shallowRef,
  watch,
  useId,
} from 'vue'
import { useI18n } from '#imports'
import { useCookieConsentUi } from '../composables/ui'
import { useCookieConsent } from '../composables/consent'
import { trapTabKey } from '../utils/focus-trap'

const props = withDefaults(defineProps<{
  autoShow?: boolean
  transition?: string
}>(), { autoShow: false, transition: undefined })

const { t } = useI18n()

function translate(key: string): string {
  try {
    const result = t(key)

    return result === key ? key.split('.').pop() ?? key : result
  } catch {
    return key.split('.').pop() ?? key
  }
}

const ui = useCookieConsentUi()
const consent = useCookieConsent()

const titleId = useId()
const containerRef = shallowRef<HTMLElement | null>(null)

function handleKeydown(event: KeyboardEvent): void {
  if (event.key === 'Escape') {
    ui.close()

    return
  }

  if (!containerRef.value) {
    return
  }

  trapTabKey(event, containerRef.value)
}

watch(
  () => ui.view.value === 'modal',
  (isVisible) => {
    if (!isVisible) {
      return
    }

    containerRef.value?.focus()
  },
  { flush: 'post' },
)

// The modal is mounted for the whole app lifetime, so `autoShow` toggles
// reactively when the layout changes (e.g. navigating into the chat layout).
// `flush: 'post'` runs this after the popup's unmount cleanup, so its
// cancelAutoShow() has reopened the gate before the modal reschedules.
watch(
  () => props.autoShow,
  (enabled) => {
    if (enabled) {
      ui.scheduleAutoShow('modal')
    }
  },
  { immediate: true, flush: 'post' },
)

const slotProps = {
  titleId,
  get categories() {
    return consent.categories
  },
  get draft() {
    return ui.draft.value
  },
  toggleDraft: ui.toggleDraft,
  switchProps: ui.switchProps,
  commitDraft: ui.commitDraft,
  allowAll: ui.allowAll,
  withdrawAll: ui.withdrawAll,
  expand: ui.expand,
  close: ui.close,
  get isDecided() {
    return consent.isDecided.value
  },
  get granted() {
    return consent.granted.value
  },
  isAllowed: consent.isAllowed,
  get consentId() {
    return consent.consentId.value
  },
  get consentDate() {
    return consent.consentDate.value
  },
}
</script>

<template>
  <Transition :name="props.transition">
    <div
      v-if="ui.view.value === 'modal'"
      @click.self="ui.close()"
    >
      <div
        ref="containerRef"
        role="dialog"
        aria-modal="true"
        :aria-labelledby="titleId"
        tabindex="-1"
        @keydown="handleKeydown"
      >
        <slot v-bind="slotProps">
          <div>
            <h2 :id="titleId">
              {{ translate('cookieConsent.title') }}
            </h2>
            <button
              type="button"
              @click="ui.close()"
            >
              {{ translate('cookieConsent.close') }}
            </button>
            <ul>
              <li
                v-for="category in consent.categories"
                :key="category.id"
              >
                <div>
                  <strong>
                    {{
                      translate(
                        `cookieConsent.categories.${category.id}.title`,
                      )
                    }}
                  </strong>
                  <button
                    v-bind="ui.switchProps(category.id)"
                    type="button"
                    @click="ui.toggleDraft(category.id)"
                  >
                    {{
                      ui.draft.value[category.id]
                        ? translate('cookieConsent.actions.allowSelected')
                        : translate('cookieConsent.actions.withdraw')
                    }}
                  </button>
                </div>
                <p>
                  {{
                    translate(
                      `cookieConsent.categories.${category.id}.description`,
                    )
                  }}
                </p>
                <ul v-if="category.entries?.length">
                  <li
                    v-for="entry in category.entries"
                    :key="entry.id"
                  >
                    <strong>{{ entry.name }}</strong>
                    <span>
                      {{
                        translate(
                          `cookieConsent.entries.${entry.id}.description`,
                        )
                      }}
                    </span>
                    <span>
                      {{
                        translate(
                          `cookieConsent.entries.${entry.id}.duration`,
                        )
                      }}
                    </span>
                  </li>
                </ul>
              </li>
            </ul>
            <div>
              <button
                type="button"
                @click="ui.allowAll()"
              >
                {{ translate('cookieConsent.actions.allowAll') }}
              </button>
              <button
                type="button"
                @click="ui.commitDraft()"
              >
                {{ translate('cookieConsent.actions.allowSelected') }}
              </button>
              <button
                type="button"
                @click="ui.withdrawAll()"
              >
                {{ translate('cookieConsent.actions.withdraw') }}
              </button>
              <button
                type="button"
                @click="ui.close()"
              >
                {{ translate('cookieConsent.close') }}
              </button>
            </div>
          </div>
        </slot>
      </div>
    </div>
  </Transition>
</template>
