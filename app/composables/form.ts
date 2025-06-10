import type { Field, FieldExposed } from '~/types/field.d'
import type { Form, FormSubmit, FieldRegistry, FormEmit } from '~/types/form.d'

export const useForm = (
  emit: (event: keyof FormEmit, ...args: any[]) => void,
  componentName: string = 'UiForm',
) => {
  const fields = shallowReactive<Field[]>([])
  const allowSubmit = shallowRef<boolean>(false)

  const registerField: FieldRegistry = (field) => {
    if (!fields.some(child => child.uid === field.uid)) {
      fields.push(field)
    }

    return fields
  }

  const unregisterField: FieldRegistry = (field) => {
    const index = fields.findIndex(child => child.uid === field.uid)

    if (index !== -1) {
      fields.splice(index, 1)
    }

    return fields
  }

  const resetValidation = () => {
    for (const field of fields) {
      const { resetValidation } = field.exposed as FieldExposed

      resetValidation()
    }
  }

  const onSubmit: FormSubmit = async () => {
    allowSubmit.value = true

    const validateFields = fields.map(async (field) => {
      const {
        required,
        validate,
        error,
      } = field.exposed as FieldExposed

      if (!toValue(required)) {
        return
      }

      await validate()
      await nextTick()

      if (toValue(error)) {
        allowSubmit.value = false
      }
    })

    await Promise.all(validateFields)

    if (!toValue(allowSubmit)) {
      emit('onValidationError', fields.find((field) => {
        const { error } = field.exposed as FieldExposed

        return toValue(error) || null
      }))

      return useErrorMessage('Some required form fields are not valid!')
    }

    emit('submit', fields)
  }

  provide<Form>(componentName, {
    registerField,
    unregisterField,
  })

  return {
    emit,
    fields,
    allowSubmit,
    registerField,
    unregisterField,
    onSubmit,
    resetValidation,
  }
}
