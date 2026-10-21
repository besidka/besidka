import '@videojs/html/video/player'
import '@videojs/html/ui/container'
import '@videojs/html/ui/controls'
import '@videojs/html/ui/controls-content'
import '@videojs/html/ui/controls-group'
import '@videojs/html/ui/tooltip-group'
import '@videojs/html/ui/tooltip'
import '@videojs/html/ui/tooltip-label'
import '@videojs/html/ui/play-button'
import '@videojs/html/ui/mute-button'
import '@videojs/html/ui/volume-slider'
import '@videojs/html/ui/time'
import '@videojs/html/ui/time-slider'
import '@videojs/html/ui/time-slider-chapters'
import '@videojs/html/ui/time-slider-chapter-title'
import '@videojs/html/ui/slider-track'
import '@videojs/html/ui/slider-buffer'
import '@videojs/html/ui/slider-fill'
import '@videojs/html/ui/slider-thumb'
import '@videojs/html/ui/slider-preview'
import '@videojs/html/ui/slider-thumbnail'
import '@videojs/html/ui/slider-value'
import '@videojs/html/ui/captions-button'
import '@videojs/html/ui/captions-radio-group'
import '@videojs/html/ui/menu'
import '@videojs/html/ui/menu-content'
import '@videojs/html/ui/menu-item'
import '@videojs/html/ui/menu-radio-group'
import '@videojs/html/ui/menu-radio-item'
import '@videojs/html/ui/menu-item-indicator'
import '@videojs/html/ui/pip-button'
import '@videojs/html/ui/airplay-button'
import '@videojs/html/ui/fullscreen-button'
import '@videojs/html/ui/hotkey'
import '@videojs/html/ui/gesture'
import {
  airPlayEnterIcon,
  airPlayExitIcon,
  captionsOffIcon,
  captionsOnIcon,
  fullscreenEnterIcon,
  fullscreenExitIcon,
  gearIcon,
  pauseIcon,
  pipEnterIcon,
  pipExitIcon,
  playIcon,
  registerIcons,
  restartIcon,
  volumeHighIcon,
  volumeLowIcon,
  volumeOffIcon,
} from '@videojs/html/icons'
import { registerI18n } from '@videojs/html/i18n'

registerIcons('default', {
  'airplay-enter': airPlayEnterIcon,
  'airplay-exit': airPlayExitIcon,
  'captions-off': captionsOffIcon,
  'captions-on': captionsOnIcon,
  'fullscreen-enter': fullscreenEnterIcon,
  'fullscreen-exit': fullscreenExitIcon,
  'gear': gearIcon,
  'pause': pauseIcon,
  'pip-enter': pipEnterIcon,
  'pip-exit': pipExitIcon,
  'play': playIcon,
  'restart': restartIcon,
  'volume-high': volumeHighIcon,
  'volume-low': volumeLowIcon,
  'volume-off': volumeOffIcon,
})

registerI18n('en', {
  menu: {
    off: 'Disabled',
  },
})
