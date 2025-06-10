export type Styles = string | string[]

type ButtonMode =
  | 'default'
  | 'neutral'
  | 'accent'
  | 'primary'
  | 'secondary'
  | 'error'
  | 'ghost'
  | 'link'
  | 'info'
  | 'warning'
  | 'success'

type ButtonSize =
  | 'xs'
  | 'sm'
  | 'md'
  | 'lg'

export interface ButtonProps {
  to?: string
  type?: 'button' | 'submit' | 'reset'
  soft?: boolean
  outline?: boolean
  disabled?: boolean
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
