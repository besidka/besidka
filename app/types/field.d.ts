// import type { ValidationRule } from '~/types/validation.d'
import type { ComponentInternalInstance } from 'vue'

export type Field = ComponentInternalInstance
export type FieldType = 'select' | 'text' | 'email' | 'password' | 'phone' | 'number' | 'file'
export type FieldSize = 'xs' | 'sm' | 'md' | 'lg' | 'xl'

export interface FieldProps {
  type?: FieldType
  placeholder?: MaybeRefOrGetter<string>
  rules?: MaybeRefOrGetter<ValidationRule[]>
  showError?: MaybeRefOrGetter<boolean>
  emitOnInput?: MaybeRefOrGetter<boolean>
  disabled?: MaybeRefOrGetter<boolean>
  value?: MaybeRefOrGetter<string>
  label?: MaybeRefOrGetter<string>
  note?: MaybeRefOrGetter<string | string[]>
  size?: FieldSize
  autocomplete?: string
}

export interface FieldFileProps extends Pick<
  FieldProps, 'disabled' | 'showError' | 'size' | 'label' | 'note'
> {
  required?: MaybeRefOrGetter<boolean | string>
  maxFiles?: MaybeRefOrGetter<string | number>
  accept?: MaybeRefOrGetter<string[]>
  maxSize?: MaybeRefOrGetter<string | number>
}

export interface FieldExposed {
  field: Ref<HTMLInputElement | HTMLSelectElement | null>
  required: ComputedRef<boolean>
  error: Ref<string>
  success: Ref<boolean>
  validated: Ref<boolean>
  validate: () => Promise<void>
  dispatchChange: () => void
  resetValidation: () => Promise<void>
}

export interface FieldData extends Omit<
  FieldProps,
  'field' | 'dispatchChange'
> {
  value: Ref<string | number | boolean>
  required: ComputedRef<boolean>
  error: FieldExposed['error']
  success: FieldExposed['success']
  validate: FieldExposed['validate']
  validated: FieldExposed['validated']
  resetValidation: FieldExposed['resetValidation']
  placeholder: ComputedRef<string>
  rules: ComputedRef<ValidationRule[]>
  disabled: ComputedRef<boolean>
  allowError: Ref<boolean>
  listeners: ComputedRef<Partial<Record<'change' | 'input' | 'focus' | 'blur', Function>>>
  isValid: ComputedRef<boolean | undefined>
  isInvalid: ComputedRef<boolean | undefined>
}
