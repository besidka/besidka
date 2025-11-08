export type Styles = string | string[]

type ButtonMode
  = | 'default'
    | 'neutral'
    | 'accent'
    | 'primary'
    | 'secondary'
    | 'error'
    | 'link'
    | 'info'
    | 'warning'
    | 'success'

type ButtonSize
  = | 'xs'
    | 'sm'
    | 'md'
    | 'lg'

export interface ButtonProps {
  to?: string
  type?: 'button' | 'submit' | 'reset'
  soft?: boolean
  ghost?: boolean
  outline?: boolean
  circle?: boolean
  square?: boolean
  circle?: boolean
  disabled?: boolean | null
  mode?: ButtonMode
  title?: string
  text?: string
  mobileText?: string
  size?: ButtonSize
  sizeMobile?: ButtonSize
  sizeDesktop?: ButtonSize
  iconOnly?: boolean
  iconOnlyDesktop?: boolean
  iconOnlyMobile?: boolean
  iconName?: string
  iconNameDisabled?: string
  iconSize?: number
  tooltip?: string | null
  tooltipPosition?: 'top' | 'bottom' | 'left' | 'right'
  tooltipStyle?: 'inherit' | Exclude<ButtonMode, 'default' | 'ghost' | 'link'>
  tag?: 'button' | 'span' | 'summary'
}

export interface ButtonContainerAttrs {
  'data-tip'?: string
}

export interface ButtonAttrs {
  'type'?: string
  'title'?: string
  'to'?: string
  'class'?: string
  'aria-label'?: string
  'onClick'?: (event: MouseEvent) => void
}
