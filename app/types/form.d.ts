// import type { Field } from '~/types/field.d'

export type FieldRegistry = (field: Field) => Field[]

export type FormSubmit = () => Promise<void>

export interface Form {
  registerField: FieldRegistry
  unregisterField: FieldRegistry
}

export interface FormEmit {
  submit: []
  onValidationError: [Field]
}
