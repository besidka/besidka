<script setup lang="ts">
import {
  shallowRef,
  watch,
  onMounted,
  onBeforeUnmount,
  useId,
} from 'vue'
import { useI18n } from '#imports'
import { useCookieConsentUi } from '../composables/ui'
import { useCookieConsent } from '../composables/consent'
import { trapTabKey } from '../utils/focus-trap'

const props = withDefaults(defineProps<{
  autoShow?: boolean
  transition?: string
}>(), { autoShow: true, transition: undefined })

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

function handleEsc(event: KeyboardEvent): void {
  if (event.key === 'Escape') {
    ui.close()
  }
}

function handleTab(event: KeyboardEvent): void {
  if (!containerRef.value) {
    return
  }

  trapTabKey(event, containerRef.value)
}

function handleKeydown(event: KeyboardEvent): void {
  handleEsc(event)
  handleTab(event)
}

let outsideClickHandler: ((event: MouseEvent) => void) | null = null

function attachOutsideClick(): void {
  outsideClickHandler = (event: MouseEvent) => {
    if (ui.isTriggerNode(event.target as Node | null)) {
      return
    }

    if (
      containerRef.value
      && !containerRef.value.contains(event.target as Node)
    ) {
      ui.close()
    }
  }

  document.addEventListener('mousedown', outsideClickHandler)
}

function detachOutsideClick(): void {
  if (outsideClickHandler) {
    document.removeEventListener('mousedown', outsideClickHandler)
    outsideClickHandler = null
  }
}

watch(
  () => ui.view.value,
  (newView) => {
    if (newView === 'popup') {
      attachOutsideClick()
    } else {
      detachOutsideClick()
    }
  },
  { flush: 'post' },
)

watch(
  () => ui.view.value === 'popup',
  (isVisible) => {
    if (!isVisible) {
      return
    }

    containerRef.value?.focus()
  },
  { flush: 'post' },
)

onMounted(() => {
  if (props.autoShow) {
    ui.scheduleAutoShow()
  }
})

onBeforeUnmount(() => {
  detachOutsideClick()
})

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
  <Transition :name="transition">
    <div
      v-if="ui.view.value === 'popup'"
      ref="containerRef"
      role="dialog"
      :aria-labelledby="titleId"
      tabindex="-1"
      @keydown="handleKeydown"
    >
      <slot v-bind="slotProps">
        <div>
          <h2 :id="titleId">
            {{ translate('cookieConsent.title') }}
          </h2>
          <p>{{ translate('cookieConsent.description') }}</p>
          <ul>
            <li
              v-for="category in consent.categories"
              :key="category.id"
            >
              <button
                v-bind="ui.switchProps(category.id)"
                type="button"
                @click="ui.toggleDraft(category.id)"
              >
                {{
                  translate(
                    `cookieConsent.categories.${category.id}.title`,
                  )
                }}
              </button>
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
              @click="ui.expand()"
            >
              {{ translate('cookieConsent.actions.customize') }}
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
  </Transition>
</template>
