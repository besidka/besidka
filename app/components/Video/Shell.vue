<template>
  <video-player
    ref="playerRef"
    class="video-shell block w-full"
  >
    <media-container
      ref="containerRef"
      class="landing-player relative block w-full aspect-video rounded-2xl
        bg-base-300 ring-1 ring-base-content/10"
      :class="containerClass"
      data-testid="video-player"
    >
      <slot />

      <template v-if="isDefined">
        <media-play-button
          class="video-big-play"
          data-testid="video-big-play"
        >
          <media-icon
            name="play"
            class="video-icon"
          />
        </media-play-button>

        <media-controls class="video-controls">
          <media-controls-content class="video-controls__content">
            <media-tooltip-group
              delay="600"
              timeout="400"
            >
              <media-controls-group
                class="video-controls__bar"
                aria-label="Video controls"
                @pointerenter="lockControlsWhileHovered"
                @pointerleave="releaseHoverLock"
              >
                <media-play-button
                  :id="ids.play"
                  class="video-button video-play-button"
                  data-testid="video-play-button"
                >
                  <media-icon
                    name="restart"
                    class="video-icon video-play-button__restart"
                  />
                  <media-icon
                    name="play"
                    class="video-icon video-play-button__play"
                  />
                  <media-icon
                    name="pause"
                    class="video-icon video-play-button__pause"
                  />
                </media-play-button>
                <media-tooltip
                  :trigger="ids.play"
                  side="top"
                  class="video-tooltip"
                >
                  <media-tooltip-label />
                </media-tooltip>

                <media-time-slider
                  ref="timeSliderRef"
                  class="video-slider video-time-slider js-video-time-slider"
                  data-testid="video-time-slider"
                >
                  <media-time-slider-chapters class="video-chapters">
                    <template v-html="CHAPTER_TEMPLATE" />
                  </media-time-slider-chapters>
                  <media-slider-thumb
                    class="video-slider__thumb video-time-slider__thumb"
                  />
                  <media-slider-preview
                    class="video-preview"
                    overflow="visible"
                  >
                    <div class="video-preview__card bubble">
                      <media-slider-thumbnail
                        class="video-preview__thumbnail"
                        data-testid="video-preview-thumbnail"
                      />
                      <div class="video-preview__meta">
                        <media-time-slider-chapter-title
                          class="video-preview__chapter"
                          data-testid="video-preview-chapter"
                        />
                        <media-slider-value
                          type="pointer"
                          class="video-preview__time"
                        />
                      </div>
                    </div>
                  </media-slider-preview>
                </media-time-slider>

                <media-time
                  v-if="isFull"
                  type="remaining"
                  toggle
                  class="video-time"
                  data-testid="video-time"
                />

                <media-mute-button
                  :id="ids.mute"
                  class="video-button video-mute-button"
                  data-testid="video-mute-button"
                >
                  <media-icon
                    name="volume-off"
                    class="video-icon video-mute-button__off"
                  />
                  <media-icon
                    name="volume-low"
                    class="video-icon video-mute-button__low"
                  />
                  <media-icon
                    name="volume-high"
                    class="video-icon video-mute-button__high"
                  />
                </media-mute-button>
                <media-tooltip
                  :trigger="ids.mute"
                  side="top"
                  class="video-tooltip"
                >
                  <media-tooltip-label />
                </media-tooltip>

                <media-volume-slider
                  v-if="isFull"
                  class="video-slider video-volume-slider"
                  thumb-alignment="edge"
                  data-testid="video-volume-slider"
                >
                  <media-slider-track class="video-slider__track">
                    <media-slider-fill class="video-slider__fill" />
                  </media-slider-track>
                  <media-slider-thumb class="video-slider__thumb" />
                </media-volume-slider>

                <template v-if="isFull">
                  <media-captions-button
                    :id="ids.captions"
                    class="video-button video-captions-button"
                    data-testid="video-captions-button"
                  >
                    <media-icon
                      name="captions-off"
                      class="video-icon video-captions-button__off"
                    />
                    <media-icon
                      name="captions-on"
                      class="video-icon video-captions-button__on"
                    />
                  </media-captions-button>
                  <media-tooltip
                    :trigger="ids.captions"
                    side="top"
                    class="video-tooltip"
                  >
                    <media-tooltip-label />
                  </media-tooltip>
                </template>

                <template v-if="hasSettingsMenu">
                  <button
                    :id="ids.settings"
                    type="button"
                    class="video-button video-settings-button
                      js-video-settings-trigger"
                    aria-label="Settings"
                    data-testid="video-settings-button"
                    v-bind="{ commandfor: ids.menu }"
                  >
                    <media-icon
                      name="gear"
                      class="video-icon"
                    />
                  </button>
                  <media-tooltip
                    :trigger="ids.settings"
                    side="top"
                    class="video-tooltip"
                  >
                    Settings
                  </media-tooltip>

                  <media-menu
                    :id="ids.menu"
                    side="top"
                    align="end"
                    class="video-menu"
                    data-testid="video-settings-menu"
                  >
                    <media-menu-content class="video-menu__page">
                      <media-menu-item
                        v-if="isFull"
                        :commandfor="ids.captionsMenu"
                        class="video-menu__item video-menu__trigger"
                        data-testid="video-settings-captions"
                      >
                        <span>Captions</span>
                        <span class="video-menu__hint">
                          <span
                            data-part="value"
                            class="video-menu__value"
                          />
                          <span
                            class="video-menu__arrow"
                            aria-hidden="true"
                          />
                        </span>
                      </media-menu-item>

                      <media-menu-item
                        v-if="hasQualityMenu"
                        :commandfor="ids.qualityMenu"
                        class="video-menu__item video-menu__trigger"
                        data-testid="video-settings-quality"
                      >
                        <span>Quality</span>
                        <span class="video-menu__hint">
                          <span class="video-menu__value">
                            {{ selectedQualityLabel }}
                          </span>
                          <span
                            class="video-menu__arrow"
                            aria-hidden="true"
                          />
                        </span>
                      </media-menu-item>

                      <media-menu-item
                        :commandfor="ids.speedMenu"
                        class="video-menu__item video-menu__trigger"
                        data-testid="video-settings-speed"
                      >
                        <span>Speed</span>
                        <span class="video-menu__hint">
                          <span class="video-menu__value">
                            {{ selectedSpeedLabel }}
                          </span>
                          <span
                            class="video-menu__arrow"
                            aria-hidden="true"
                          />
                        </span>
                      </media-menu-item>
                    </media-menu-content>

                    <media-menu-content
                      v-if="isFull"
                      :id="ids.captionsMenu"
                      class="video-menu__page video-menu__submenu"
                    >
                      <media-menu-item
                        class="video-menu__item video-menu__back"
                      >
                        <span
                          class="video-menu__arrow video-menu__arrow--back"
                          aria-hidden="true"
                        />
                        <span>Captions</span>
                      </media-menu-item>
                      <media-captions-radio-group
                        class="video-menu__group"
                        data-testid="video-captions-options"
                      >
                        <template v-html="RADIO_ITEM_TEMPLATE" />
                      </media-captions-radio-group>
                    </media-menu-content>

                    <media-menu-content
                      v-if="hasQualityMenu"
                      :id="ids.qualityMenu"
                      class="video-menu__page video-menu__submenu"
                    >
                      <media-menu-item
                        class="video-menu__item video-menu__back"
                      >
                        <span
                          class="video-menu__arrow video-menu__arrow--back"
                          aria-hidden="true"
                        />
                        <span>Quality</span>
                      </media-menu-item>
                      <media-menu-radio-group
                        class="video-menu__group js-video-custom-options"
                        aria-label="Quality"
                        :value="selectedQuality"
                        data-testid="video-quality-options"
                        @value-change="onQualityChange"
                      >
                        <media-menu-radio-item
                          v-for="option in qualities"
                          :key="option.value"
                          :value="option.value"
                          class="video-menu__item video-menu__radio"
                          :data-testid="`video-quality-${option.value}`"
                        >
                          <span data-part="label">{{ option.label }}</span>
                        </media-menu-radio-item>
                      </media-menu-radio-group>
                    </media-menu-content>

                    <media-menu-content
                      :id="ids.speedMenu"
                      class="video-menu__page video-menu__submenu"
                    >
                      <media-menu-item
                        class="video-menu__item video-menu__back"
                      >
                        <span
                          class="video-menu__arrow video-menu__arrow--back"
                          aria-hidden="true"
                        />
                        <span>Speed</span>
                      </media-menu-item>
                      <media-menu-radio-group
                        class="video-menu__group js-video-custom-options"
                        aria-label="Speed"
                        :value="selectedSpeed"
                        data-testid="video-speed-options"
                        @value-change="onSpeedChange"
                      >
                        <media-menu-radio-item
                          v-for="option in speeds"
                          :key="option.value"
                          :value="option.value"
                          class="video-menu__item video-menu__radio"
                          :data-testid="`video-speed-${option.value}`"
                        >
                          <span data-part="label">{{ option.label }}</span>
                        </media-menu-radio-item>
                      </media-menu-radio-group>
                    </media-menu-content>
                  </media-menu>
                </template>

                <media-pip-button
                  :id="ids.pip"
                  class="video-button video-pip-button"
                  data-testid="video-pip-button"
                >
                  <media-icon
                    name="pip-enter"
                    class="video-icon video-pip-button__enter"
                  />
                  <media-icon
                    name="pip-exit"
                    class="video-icon video-pip-button__exit"
                  />
                </media-pip-button>
                <media-tooltip
                  :trigger="ids.pip"
                  side="top"
                  class="video-tooltip"
                >
                  <media-tooltip-label />
                </media-tooltip>

                <template v-if="isFull">
                  <media-airplay-button
                    :id="ids.airplay"
                    class="video-button video-airplay-button"
                    data-testid="video-airplay-button"
                  >
                    <media-icon
                      name="airplay-enter"
                      class="video-icon video-airplay-button__enter"
                    />
                    <media-icon
                      name="airplay-exit"
                      class="video-icon video-airplay-button__exit"
                    />
                  </media-airplay-button>
                  <media-tooltip
                    :trigger="ids.airplay"
                    side="top"
                    class="video-tooltip"
                  >
                    <media-tooltip-label />
                  </media-tooltip>
                </template>

                <media-fullscreen-button
                  :id="ids.fullscreen"
                  class="video-button video-fullscreen-button"
                  data-testid="video-fullscreen-button"
                >
                  <media-icon
                    name="fullscreen-enter"
                    class="video-icon video-fullscreen-button__enter"
                  />
                  <media-icon
                    name="fullscreen-exit"
                    class="video-icon video-fullscreen-button__exit"
                  />
                </media-fullscreen-button>
                <media-tooltip
                  :trigger="ids.fullscreen"
                  side="top"
                  class="video-tooltip"
                >
                  <media-tooltip-label />
                </media-tooltip>
              </media-controls-group>
            </media-tooltip-group>
          </media-controls-content>
        </media-controls>

        <media-hotkey
          v-for="hotkey in hotkeys"
          :key="hotkey.keys"
          :keys="hotkey.keys"
          :action="hotkey.action"
          :value="hotkey.value"
        />
        <media-gesture
          type="tap"
          action="togglePaused"
          pointer="mouse"
        />
        <media-gesture
          type="tap"
          action="toggleControls"
          pointer="touch"
        />
        <media-gesture
          type="doubletap"
          action="toggleFullscreen"
          region="center"
        />
      </template>

      <slot name="overlay" />
    </media-container>
  </video-player>
</template>

<script setup lang="ts">
import type { VideoPlayerElement } from '@videojs/html/video'
import type {
  VideoMenuOption,
  VideoShellReadyPayload,
} from '~/types/video-player.d'
import '~/assets/css/video-player-theme.css'

const props = withDefaults(defineProps<{
  variant?: 'full' | 'lean'
  containerClass?: string
  qualities?: VideoMenuOption[]
  selectedQuality?: string
  speeds?: VideoMenuOption[]
  selectedSpeed?: string
}>(), {
  variant: 'full',
  containerClass: undefined,
  qualities: () => [],
  selectedQuality: '',
  speeds: () => [],
  selectedSpeed: '',
})

const emit = defineEmits<{
  ready: [payload: VideoShellReadyPayload]
  failed: []
  selectQuality: [value: string]
  selectSpeed: [value: string]
}>()

interface MenuOptionStatePublisher extends HTMLElement {
  publishMenuOptionState?: (
    disabled: boolean,
    hidden: boolean,
    availability: 'available' | 'unavailable' | 'unsupported',
  ) => void
}

interface HotkeyBinding {
  keys: string
  action: string
  value?: number
}

const ATTACH_TIMEOUT_MS = 4000

const FULL_HOTKEYS: HotkeyBinding[] = [
  { keys: 'Space', action: 'togglePaused' },
  { keys: 'k', action: 'togglePaused' },
  { keys: 'm', action: 'toggleMuted' },
  { keys: 'ArrowRight', action: 'seekStep' },
  { keys: 'ArrowLeft', action: 'seekStep' },
  { keys: 'l', action: 'seekStep' },
  { keys: 'j', action: 'seekStep' },
  { keys: 'ArrowUp', action: 'volumeStep' },
  { keys: 'ArrowDown', action: 'volumeStep' },
  { keys: '0-9', action: 'seekToPercent' },
  { keys: 'Home', action: 'seekToPercent', value: 0 },
  { keys: 'End', action: 'seekToPercent', value: 100 },
  { keys: 'f', action: 'toggleFullscreen' },
  { keys: 'c', action: 'toggleSubtitles' },
  { keys: 'i', action: 'togglePictureInPicture' },
]

const LEAN_HOTKEY_ACTIONS = new Set([
  'togglePaused',
  'toggleMuted',
  'seekStep',
  'seekToPercent',
  'toggleFullscreen',
  'togglePictureInPicture',
])

const CHAPTER_TEMPLATE = [
  '<div class="video-chapter">',
  '<media-slider-track class="video-slider__track video-chapter__track">',
  '<media-slider-buffer class="video-chapter__buffer"></media-slider-buffer>',
  '<media-slider-fill class="video-chapter__fill"></media-slider-fill>',
  '</media-slider-track>',
  '</div>',
].join('')

const RADIO_ITEM_TEMPLATE = [
  '<media-menu-radio-item class="video-menu__item video-menu__radio">',
  '<span data-part="label"></span>',
  '</media-menu-radio-item>',
].join('')

const playerRef = shallowRef<VideoPlayerElement | null>(null)
const containerRef = shallowRef<HTMLElement | null>(null)
const timeSliderRef = shallowRef<HTMLElement | null>(null)
const isDefined = shallowRef<boolean>(false)

const baseId = useId()
const ids = {
  play: `${baseId}-play`,
  mute: `${baseId}-mute`,
  captions: `${baseId}-captions`,
  settings: `${baseId}-settings`,
  menu: `${baseId}-menu`,
  captionsMenu: `${baseId}-captions-menu`,
  qualityMenu: `${baseId}-quality-menu`,
  speedMenu: `${baseId}-speed-menu`,
  pip: `${baseId}-pip`,
  airplay: `${baseId}-airplay`,
  fullscreen: `${baseId}-fullscreen`,
}

const isFull = computed<boolean>(() => {
  return props.variant === 'full'
})

const hotkeys = computed<HotkeyBinding[]>(() => {
  if (isFull.value) {
    return FULL_HOTKEYS
  }

  return FULL_HOTKEYS.filter((hotkey) => {
    return LEAN_HOTKEY_ACTIONS.has(hotkey.action)
  })
})

const hasSettingsMenu = computed<boolean>(() => {
  return isFull.value || props.speeds.length > 0
})

const hasQualityMenu = computed<boolean>(() => {
  return props.qualities.length > 1
})

const selectedQualityLabel = computed<string>(() => {
  return props.qualities.find((option) => {
    return option.value === props.selectedQuality
  })?.label ?? ''
})

const selectedSpeedLabel = computed<string>(() => {
  return props.speeds.find((option) => {
    return option.value === props.selectedSpeed
  })?.label ?? ''
})

let isUnmounted = false
let hasWarnedMissingMenuOptionPublisher = false
let stopWaitingForMedia: (() => void) | null = null
let releaseControlsLock: (() => void) | null = null

function lockControlsWhileHovered(event: PointerEvent) {
  const store = playerRef.value?.store

  if (event.pointerType !== 'mouse' || !store?.target || releaseControlsLock) {
    return
  }

  releaseControlsLock = store.requestControlsLock()
}

function releaseHoverLock() {
  releaseControlsLock?.()
  releaseControlsLock = null
}

function readEventValue(event: Event): string | null {
  const detail = (event as CustomEvent<{ value?: unknown }>).detail
  const value = detail?.value

  return typeof value === 'string' ? value : null
}

function onQualityChange(event: Event) {
  const value = readEventValue(event)

  if (value !== null) {
    emit('selectQuality', value)
  }
}

function onSpeedChange(event: Event) {
  const value = readEventValue(event)

  if (value !== null) {
    emit('selectSpeed', value)
  }
}

function warnMissingMenuOptionPublisher() {
  if (!import.meta.dev || hasWarnedMissingMenuOptionPublisher) {
    return
  }

  hasWarnedMissingMenuOptionPublisher = true
  console.warn(
    '[video-player] media-menu-radio-group.publishMenuOptionState is gone: '
    + 'the Settings button will disappear on pages without caption tracks. '
    + 'See "Fragile seams" in docs/video-player.md.',
  )
}

function publishCustomOptionsAvailability() {
  const groups = containerRef.value?.querySelectorAll<MenuOptionStatePublisher>(
    '.js-video-custom-options',
  ) ?? []

  for (const group of groups) {
    if (typeof group.publishMenuOptionState !== 'function') {
      warnMissingMenuOptionPublisher()

      continue
    }

    group.publishMenuOptionState(false, false, 'available')
  }
}

watch(
  () => {
    return [props.selectedQuality, props.selectedSpeed, props.qualities]
  },
  publishCustomOptionsAvailability,
  { flush: 'post' },
)

function waitForMediaAttachment(player: VideoPlayerElement): Promise<void> {
  return new Promise((resolve) => {
    const store = player.store

    if (store.target) {
      resolve()

      return
    }

    let unsubscribe: (() => void) | null = null

    const timeout = setTimeout(finish, ATTACH_TIMEOUT_MS)

    function finish() {
      clearTimeout(timeout)
      unsubscribe?.()
      stopWaitingForMedia = null
      resolve()
    }

    unsubscribe = store.subscribe(() => {
      if (store.target) {
        finish()
      }
    })
    stopWaitingForMedia = finish
  })
}

async function enhance() {
  try {
    await import('~/utils/videojs-elements')
    await customElements.whenDefined('video-player')
  } catch {
    if (!isUnmounted) {
      emit('failed')
    }

    return
  }

  if (isUnmounted) {
    return
  }

  isDefined.value = true
  await nextTick()
  publishCustomOptionsAvailability()

  const player = playerRef.value

  if (!player) {
    return
  }

  await waitForMediaAttachment(player)

  if (isUnmounted) {
    return
  }

  publishCustomOptionsAvailability()
  emit('ready', { player, timeSlider: timeSliderRef.value })
}

onMounted(() => {
  enhance()
})

onBeforeUnmount(() => {
  isUnmounted = true
  stopWaitingForMedia?.()
  releaseHoverLock()
})
</script>
