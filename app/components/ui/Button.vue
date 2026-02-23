<template>
  <component
    :is="isTagSummary ? 'summary' : 'div'"
    :class="containerClasses"
    v-bind="containerAttrs"
  >
    <component
      :is="buttonTag"
      ref="button"
      v-bind="buttonAttrs"
      :class="buttonResultClasses"
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

const container = useTemplateRef<HTMLElement>('container')
const button = useTemplateRef<HTMLElement>('button')

const isTagSummary = computed<boolean>(() => {
  return props.tag === 'summary'
})

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
      : isTagSummary.value ? 'span' : props.tag
})

const resultTitle = computed<string>(() => {
  if (props.disabled && props.tooltip === null) {
    return ''
  }

  return props.title ?? props.text
})

const containerAttrs = computed<ButtonContainerAttrs>(() => {
  const baseAttrs = props.disabled && props.tooltip === null
    ? {}
    : {
      'data-tip': props.tooltip === null ? undefined : toValue(resultTitle),
    }

  if (isTagSummary.value) {
    const { class: _, ...restAttrs } = nativeAttrs
    const title = toValue(resultTitle)
    const summaryAttrs = title ? { title, 'aria-label': title } : {}
    return { ...baseAttrs, ...summaryAttrs, ...restAttrs }
  }

  return baseAttrs
})

const buttonAttrs = computed<ButtonAttrs>(() => {
  const result = {}

  if (props.disabled) {
    // Even when disabled, pass through native attrs (except class and onClick)
    const { class: _, onClick: __, ...restAttrs } = nativeAttrs
    const title = toValue(resultTitle)
    const disabledAttrs = title ? { title, 'aria-label': title } : {}
    return isTagSummary.value
      ? result
      : { ...result, ...disabledAttrs, ...restAttrs }
  }

  const title = toValue(resultTitle)

  // Extract native attrs (excluding class which is handled separately)
  const { class: _, onClick, ...restAttrs } = nativeAttrs

  const specificAttrs = props.to
    ? {
      'to': props.to,
      'aria-label': title,
      'title': title,
    }
    : {
      'type': props.tag === 'button' ? props.type : undefined,
      'aria-label': title,
      'title': title,
      'onClick': onClick,
    }

  // Only add native attrs when button is the interactive element (not summary)
  return isTagSummary.value
    ? Object.assign(result, specificAttrs)
    : Object.assign(result, specificAttrs, restAttrs)
})

const focus = () => {
  isTagSummary.value
    ? container.value?.focus()
    : button.value?.focus()
}

defineExpose({
  focus,
})

const buttonStyleClasses = computed<Partial<Record<string, boolean>>>(() => {
  return {
    'btn': true,
    'group-open:!btn-active': isTagSummary.value,
    '[.group:not([open])_&]:btn-ghost [.group:not([open])_&]:btn-ghost-legacy': props.ghost && isTagSummary.value,
    '[.group:not([open])_&]:btn-ghost': props.ghostNew && isTagSummary.value,
    'btn-neutral': props.mode === 'neutral',
    'btn-accent': props.mode === 'accent',
    'btn-primary': props.mode === 'primary',
    'btn-secondary': props.mode === 'secondary',
    'btn-info': props.mode === 'info',
    'btn-warning': props.mode === 'warning',
    'btn-error': props.mode === 'error',
    'btn-success': props.mode === 'success',
    'btn-ghost btn-ghost-legacy': props.ghost && !isTagSummary.value,
    'btn-ghost': props.ghostNew && !isTagSummary.value,
    'btn-soft': props.soft,
    'btn-outline': props.outline,
    'btn-circle': props.circle,
    'btn-square': props.square,
    'btn-block': props.block,
    'btn-link': props.mode === 'link',
    'btn-disabled': !!props.disabled,
    'btn-xs': props.size === 'xs',
    'max-lg:btn-xs': props.sizeMobile === 'xs',
    'lg:btn-xs': props.sizeDesktop === 'xs',
    'btn-sm': props.size === 'sm',
    'max-lg:btn-sm': props.sizeMobile === 'sm',
    'lg:btn-sm': props.sizeDesktop === 'sm',
    'btn-md': props.size === 'md',
    'max-lg:btn-md': props.sizeMobile === 'md',
    'lg:btn-md': props.sizeDesktop === 'md',
    'btn-lg': props.size === 'lg',
    'max-lg:btn-lg': props.sizeMobile === 'lg',
    'lg:btn-lg': props.sizeDesktop === 'lg',
    'max-lg:btn-circle': props.circle && (props.iconOnly || props.iconOnlyMobile),
    'lg:btn-circle': props.circle && (props.iconOnly || props.iconOnlyDesktop),
    'max-lg:btn-square': props.square && (props.iconOnly || props.iconOnlyMobile),
    'lg:btn-square': props.square && (props.iconOnly || props.iconOnlyDesktop),
    ...(nativeAttrs.class ? { [`${nativeAttrs.class}`]: true } : {}),
  }
})

const buttonResultClasses = computed<Partial<Record<string, boolean>>>(() => {
  return isTagSummary.value ? {} : buttonStyleClasses.value
})

const tooltipClasses = computed<Partial<Record<string, boolean>>>(() => {
  return showTooltip.value
    ? {
      'tooltip before:font-normal': true,
      'before:hidden after:hidden': true,
      'md:before:block md:after:block': true,
      'group-open:before:opacity-100 group-open:after:opacity-100 [--tt-pos:0]': isTagSummary.value,
      'tooltip-accent':
        (
          props.tooltipStyle === 'accent'
          || (props.tooltipStyle === 'inherit' && props.mode === 'accent')
        ),
      'tooltip-primary': (
        props.tooltipStyle === 'primary'
        || (props.tooltipStyle === 'inherit' && props.mode === 'primary')
      ),
      'tooltip-secondary': (
        props.tooltipStyle === 'secondary'
        || (props.tooltipStyle === 'inherit' && props.mode === 'secondary')
      ),
      'tooltip-error':
        (
          props.tooltipStyle === 'error'
          || (props.tooltipStyle === 'inherit' && props.mode === 'error')
        ),
      'tooltip-warning':
        (
          props.tooltipStyle === 'warning'
          || (props.tooltipStyle === 'inherit' && props.mode === 'warning')
        ),
      'tooltip-info':
        (
          props.tooltipStyle === 'info'
          || (props.tooltipStyle === 'inherit' && props.mode === 'info')
        ),
      'tooltip-success':
        (
          props.tooltipStyle === 'success'
          || (props.tooltipStyle === 'inherit' && props.mode === 'success')
        ),
      'tooltip-left': props.tooltipPosition === 'left',
      'tooltip-right': props.tooltipPosition === 'right',
      'tooltip-top': props.tooltipPosition === 'top',
      'tooltip-bottom': props.tooltipPosition === 'bottom',
    }
    : {}
})

const containerClasses = computed<Partial<Record<string, boolean>>>(() => {
  return {
    ...tooltipClasses.value,
    ...(isTagSummary.value
      ? {
        'z-[2]': true,
        ...buttonStyleClasses.value,
      }
      : {}),
    'w-full': props.block,
  }
})
</script>
