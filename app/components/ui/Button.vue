<template>
  <div
    :class="{
      'tooltip before:font-normal': showTooltip,
      'before:hidden after:hidden': showTooltip,
      'lg:before:block lg:after:block': showTooltip,
      'tooltip-bottom': showTooltip,
      'tooltip-accent': showTooltip && mode === 'accent',
      'tooltip-primary': showTooltip && mode === 'primary',
      'tooltip-secondary': showTooltip && mode === 'secondary',
      'tooltip-error': showTooltip && mode === 'error',
    }"
    v-bind="containerAttrs"
  >
    <component
      :is="buttonTag"
      ref="button"
      v-bind="buttonAttrs"
      class="btn"
      :class="{
        'btn-neutral': mode === 'neutral',
        'btn-accent': mode === 'accent',
        'btn-primary': mode === 'primary',
        'btn-secondary': mode === 'secondary',
        'btn-info': mode === 'info',
        'btn-warning': mode === 'warning',
        'btn-error': mode === 'error',
        'btn-success': mode === 'success',
        'btn-ghost': mode === 'ghost',
        'btn-soft': soft,
        'btn-outline': outline,
        'btn-link': mode === 'link',
        'btn-disabled': disabled,
        'btn-xs': size === 'xs',
        'max-lg:btn-xs': sizeMobile === 'xs',
        'lg:btn-xs': sizeDesktop === 'xs',
        'btn-sm': size === 'sm',
        'max-lg:btn-sm': sizeMobile === 'sm',
        'lg:btn-sm': sizeDesktop === 'sm',
        'btn-md': size === 'md',
        'max-lg:btn-md': sizeMobile === 'md',
        'lg:btn-md': sizeDesktop === 'md',
        'btn-lg': size === 'lg',
        'max-lg:btn-lg': sizeMobile === 'lg',
        'lg:btn-lg': sizeDesktop === 'lg',
        'max-lg:btn-square': iconOnly || iconOnlyMobile,
        'lg:btn-square': iconOnly || iconOnlyDesktop,
        ...(nativeAttrs.class ? { [`${nativeAttrs.class}`]: true } : {}),
      }"
    >
      <span
        class="relative z-c2 flex gap-2 items-center"
      >
        <Icon
          v-if="iconName && !hasCustomIcon"
          :name="iconNameDisabled && disabled ? iconNameDisabled : iconName"
          :size="iconSize"
        />
        <slot name="icon" />
        <span
          :class="{
            'sr-only': iconOnly,
            'max-lg:not-sr-only lg:sr-only': iconOnlyDesktop && !iconOnly,
            'max-lg:sr-only lg:not-sr-only': iconOnlyMobile && !iconOnly,
          }"
        >
          <span
            class="capitalize"
            :class="{
              'sr-only lg:not-sr-only': mobileText,
            }"
          >
            {{ text }}
          </span>
          <span
            v-if="mobileText && !(iconOnly || iconOnlyMobile)"
            class="lg:sr-only capitalize"
          >
            {{ mobileText }}
          </span>
        </span>
      </span>
    </component>
  </div>
</template>

<script setup lang='ts'>
import type { Slots } from 'vue'
import type {
  ButtonProps,
  ButtonContainerAttrs,
  ButtonAttrs,
} from '~/types/button.d'

defineOptions({
  inheritAttrs: false,
})

const props = withDefaults(defineProps<ButtonProps>(), {
  type: 'button',
  mode: 'primary',
  text: 'Text',
  iconSize: 20,
})

const slots: Slots = useSlots()
const nativeAttrs = useAttrs()

const button = ref<HTMLElement | null>(null)

const hasCustomIcon = computed<boolean>(() => {
  return !!slots.icon
})

const showTooltip = computed<boolean>(() => {
  return !props.disabled && (props.iconOnly || props.iconOnlyDesktop)
})

const buttonTag = computed(() => {
  return props.disabled
    ? 'span'
    : props.to
      ? resolveComponent('NuxtLink')
      : 'button'
})

const resultTitle = computed<string>(() => {
  if (props.disabled) {
    return ''
  }

  return props.title ?? props.text
})

const containerAttrs = computed<ButtonContainerAttrs>(() => {
  return props.disabled
    ? {}
    : {
      'data-tip': toValue(resultTitle),
    }
})

const buttonAttrs = computed<ButtonAttrs>(() => {
  const result = {}

  if (props.disabled) {
    return result
  }

  const title = toValue(resultTitle)

  return Object.assign(
    result,
    props.to
      ? {
        'to': props.to,
        'aria-label': title,
      }
      : {
        'type': props.type,
        'aria-label': title,
        'onClick': nativeAttrs.onClick,
      },
  )
})

const focus = () => {
  button.value?.focus()
}

defineExpose({
  focus,
})
</script>
