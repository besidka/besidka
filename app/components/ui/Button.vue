<template>
  <component
    :is="props.tag === 'summary' ? 'summary' : 'div'"
    :class="{
      'tooltip before:font-normal': showTooltip,
      'before:hidden after:hidden': showTooltip,
      'md:before:block md:after:block': showTooltip,
      'z-[2]': props.tag === 'summary',
      'tooltip-accent':
        showTooltip && (
          tooltipStyle === 'accent'
          || (tooltipStyle === 'inherit' && mode === 'accent')
        ),
      'tooltip-primary': showTooltip && (
          tooltipStyle === 'primary'
          || (tooltipStyle === 'inherit' && mode === 'primary')
        ),
      'tooltip-secondary': showTooltip && (
          tooltipStyle === 'secondary'
          || (tooltipStyle === 'inherit' && mode === 'secondary')
        ),
      'tooltip-error':
        showTooltip && (
          tooltipStyle === 'error'
          || (tooltipStyle === 'inherit' && mode === 'error')
        ),
      'tooltip-warning':
        showTooltip && (
          tooltipStyle === 'warning'
          || (tooltipStyle === 'inherit' && mode === 'warning')
        ),
      'tooltip-info':
        showTooltip && (
          tooltipStyle === 'info'
          || (tooltipStyle === 'inherit' && mode === 'info')
        ),
      'tooltip-success':
        showTooltip && (
          tooltipStyle === 'success'
          || (tooltipStyle === 'inherit' && mode === 'success')
        ),
      'tooltip-left': showTooltip && tooltipPosition === 'left',
      'tooltip-right': showTooltip && tooltipPosition === 'right',
      'tooltip-top': showTooltip && tooltipPosition === 'top',
      'tooltip-bottom': showTooltip && tooltipPosition === 'bottom',
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
        'btn-ghost': ghost,
        'btn-soft': soft,
        'btn-outline': outline,
        'btn-circle': circle,
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
  </component>
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
  tooltipPosition: 'bottom',
  tooltipStyle: 'inherit',
  tag: 'button',
})

const slots: Slots = useSlots()
const nativeAttrs = useAttrs()

const button = ref<HTMLElement | null>(null)

const hasCustomIcon = computed<boolean>(() => {
  return !!slots.icon
})

const showTooltip = computed<boolean>(() => {
  if (props.disabled && props.tooltip === null) {
    return false
  }

  return props.iconOnly || props.iconOnlyDesktop
})

const buttonTag = computed<ButtonProps['tag'] | ReturnType<typeof resolveComponent>>(() => {
  return props.disabled
    ? 'span'
    : props.to
      ? resolveComponent('NuxtLink')
      : props.tag === 'summary' ? 'span' : props.tag
})

const resultTitle = computed<string>(() => {
  if (props.disabled && props.tooltip === null) {
    return ''
  }

  return props.title ?? props.text
})

const containerAttrs = computed<ButtonContainerAttrs>(() => {
  return props.disabled && props.tooltip === null
    ? {}
    : {
      'data-tip': props.tooltip === null ? undefined : toValue(resultTitle),
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
        'type': props.tag === 'button' ? props.type : undefined,
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
