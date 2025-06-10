import type { Form } from '~/types/form.d'
import type { Field, FieldData, FieldProps, FieldFileProps } from '~/types/field.d'
import type { ValidationRule } from '~/types/validation.d'

const defaultParentComponentName = 'UiForm'

const checkParent = (
  instance: Field | null,
  parentComponentName: string,
): boolean => {
  if (!instance) {
    return false
  } else if (instance.type.__name === parentComponentName) {
    return true
  } else {
    return checkParent(instance.parent, parentComponentName)
  }
}

export const useField = (
  props: FieldProps,
  emit: (event: 'change' | 'input' | 'focus' | 'blur', ...args: any[]) => void,
  value: Ref<string | number>,
  parentComponentName: MaybeRefOrGetter<string> = defaultParentComponentName,
): FieldData => {
  const Form = inject<Form>(toValue(parentComponentName), {
    registerField: () => [],
    unregisterField: () => [],
  })
  const error = shallowRef<string>('')
  const success = shallowRef<boolean>(false)
  const validated = shallowRef<boolean>(false)
  const placeholder = computed<string>(() => toValue(props.placeholder) ?? '')
  const rules = computed<ValidationRule[]>(() => toValue(props.rules) ?? [])
  const required = computed<boolean>(() => !!toValue(props.rules)?.length)
  const disabled = computed<boolean>(() => {
    const value = toValue(props.disabled)

    // @ts-expect-error
    return value === '' || !!value
  })
  const isValid = computed<boolean | undefined>(() => {
    return (validated.value && success.value) || undefined
  })
  const isInvalid = computed<boolean | undefined>(() => {
    return (validated.value && !!error.value) || undefined
  })

  onBeforeMount(() => {
    if (!checkParent(getCurrentInstance(), toValue(parentComponentName))) {
      throw new Error(
        `The current field component has to be used only inside slots of the '${toValue(parentComponentName)}' component or related components!`,
      )
    }
  })

  onMounted(() => {
    Form.registerField(getCurrentInstance() as Field)
  })

  onBeforeUnmount(() => {
    Form.unregisterField(getCurrentInstance() as Field)
  })

  const allowError = computed<boolean>(() => {
    return !!toValue(props.showError) && !!error.value
  })

  const validate = async () => {
    await nextTick()

    success.value = false
    error.value = ''

    if (!required.value) {
      success.value = true

      return
    }

    success.value = rules.value.every((rule: ValidationRule) => {
      const isValid = rule.validate(toValue(value)?.toString() ?? '')

      if (!isValid) {
        error.value = rule.message
      }

      return isValid
    })

    validated.value = true
    await nextTick()
    emit('change')
  }

  const resetValidation = async () => {
    success.value = false
    error.value = ''
    validated.value = false

    await nextTick()
  }

  const nativeListeners = {
    focus: () => emit('focus'),
    blur: () => emit('blur'),
  }

  const listeners = computed<
    Record<'change' | 'input' | 'focus' | 'blur', Function>
  >(() => {
    return required.value
      ? {
        ...nativeListeners,
        change: validate,
        input: validated.value || props.emitOnInput
          ? validate
          : () => emit('change'),
      }
      : {
        ...nativeListeners,
        change: () => emit('change'),
        input: () => props.emitOnInput
          ? emit('change')
          : () => {},
      }
  })

  return {
    value,
    placeholder,
    required,
    disabled,
    rules,
    error,
    success,
    allowError,
    listeners,
    validate,
    validated,
    isValid,
    isInvalid,
    resetValidation,
  }
}

export const useFieldCheckbox = (
  props: FieldProps,
  emit: (event: 'change', value: boolean) => void,
  value: Ref<boolean>,
  parentComponentName: MaybeRefOrGetter<string> = defaultParentComponentName,
): FieldData => {
  const Form = inject<Form>(toValue(parentComponentName), {
    registerField: () => [],
    unregisterField: () => [],
  })
  const error = shallowRef<string>('')
  const success = shallowRef<boolean>(false)
  const validated = shallowRef<boolean>(false)
  const placeholder = computed<string>(() => toValue(props.placeholder) ?? '')
  const rules = computed<ValidationRule[]>(() => toValue(props.rules) ?? [])
  const required = computed<boolean>(() => !!toValue(props.rules)?.length)
  const disabled = computed<boolean>(() => {
    const value = toValue(props.disabled)

    // @ts-expect-error
    return value === '' || !!value
  })
  const isValid = computed<boolean | undefined>(() => {
    return (validated.value && success.value) || undefined
  })
  const isInvalid = computed<boolean | undefined>(() => {
    return (validated.value && !!error.value) || undefined
  })

  onBeforeMount(() => {
    if (!checkParent(getCurrentInstance(), toValue(parentComponentName))) {
      throw new Error(
        `The current field component has to be used only inside slots of the '${toValue(parentComponentName)}' component or related components!`,
      )
    }
  })

  onMounted(() => {
    Form.registerField(getCurrentInstance() as Field)
  })

  onBeforeUnmount(() => {
    Form.unregisterField(getCurrentInstance() as Field)
  })

  const allowError = computed<boolean>(() => {
    return !!toValue(props.showError) && !!error.value
  })

  const validate = async () => {
    await nextTick()

    success.value = false
    error.value = ''

    if (!required.value) {
      success.value = true

      return
    }

    success.value = rules.value.every((rule: ValidationRule) => {
      const isValid = rule.validate(!!value.value)

      if (!isValid) {
        error.value = rule.message
      }

      return isValid
    })

    validated.value = true
    await nextTick()
    emit('change', value.value)
  }

  const resetValidation = async () => {
    success.value = false
    error.value = ''
    validated.value = false

    await nextTick()
  }

  watch(value, () => validate(), {
    immediate: false,
    flush: 'post',
  })

  const listeners = computed<
    Record<'change', Function>
  >(() => ({
    change: () => {},
  }))

  return {
    value,
    placeholder,
    required,
    disabled,
    rules,
    error,
    success,
    allowError,
    listeners,
    validate,
    validated,
    isValid,
    isInvalid,
    resetValidation,
  }
}

export const useFieldFile = (
  field: Ref<HTMLInputElement | null>,
  props: FieldFileProps,
  emit: (event: 'change', files: FileList) => void,
  parentComponentName: MaybeRefOrGetter<string> = defaultParentComponentName,
): Omit<FieldData, 'value' | 'placeholder' | 'rules' | 'listeners'> &
  {
    multiple: ComputedRef<boolean>
    accept: ComputedRef<string>
  } => {
  const Form = inject<Form>(toValue(parentComponentName), {
    registerField: () => [],
    unregisterField: () => [],
  })
  const error = shallowRef<string>('')
  const success = shallowRef<boolean>(false)
  const validated = shallowRef<boolean>(false)
  const required = computed<boolean>(() => {
    const value = toValue(props.required)

    return value === '' || !!value
  })
  const maxFiles = computed<number>(() => {
    return Number(toValue(props.maxFiles)) || 1
  })
  const multiple = computed<boolean>(() => maxFiles.value > 1)
  const disabled = computed<boolean>(() => !!toValue(props.disabled))
  const accept = computed<string[]>(() => {
    return toValue(props.accept) ?? []
  })
  const acceptAttr = computed<string>(() => accept.value.join(','))
  const maxSize = computed<number>(() => {
    return Number(toValue(props.maxSize)) || 5 * 1024 * 1024
  })
  const isValid = computed<boolean | undefined>(() => {
    return (validated.value && success.value) || undefined
  })
  const isInvalid = computed<boolean | undefined>(() => {
    return (validated.value && !!error.value) || undefined
  })

  onBeforeMount(() => {
    if (!checkParent(getCurrentInstance(), toValue(parentComponentName))) {
      throw new Error(
        `The current field component has to be used only inside slots of the '${toValue(parentComponentName)}' component or related components!`,
      )
    }
  })

  onMounted(() => {
    Form.registerField(getCurrentInstance() as Field)
  })

  onBeforeUnmount(() => {
    Form.unregisterField(getCurrentInstance() as Field)
  })

  const allowError = computed<boolean>(() => {
    return !!toValue(props.showError) && !!error.value
  })

  const validate = async () => {
    await nextTick()

    success.value = false
    error.value = ''

    if (!field.value) {
      return
    }

    const files = field.value.files

    if (!required.value) {
      success.value = true
      await nextTick()
      emit('change', (files?.length ? files : []) as FileList)

      return
    }

    validated.value = true

    if (!files || !files.length) {
      error.value = 'File is required'

      return
    } else if (files.length > maxFiles.value) {
      error.value = `You can upload a maximum of ${maxFiles.value} file${maxFiles.value > 1 ? 's' : ''}`

      return
    }

    for (const file of files) {
      if (accept.value.length && !accept.value.includes(file.type)) {
        field.value && (field.value.value = '')
        error.value = `The only allowed file types are: ${acceptAttr.value}`

        return
      } else if (file.size > maxSize.value) {
        field.value && (field.value.value = '')
        error.value = `File size should not exceed ${(maxSize.value / (1024 ** 2)).toFixed(0)}MB for development purposes`

        return
      }
    }

    success.value = true
    await nextTick()
    emit('change', files)
  }

  const resetValidation = async () => {
    success.value = false
    error.value = ''
    validated.value = false

    await nextTick()
  }

  return {
    multiple,
    required,
    accept: acceptAttr,
    disabled,
    error,
    success,
    allowError,
    validate,
    validated,
    isValid,
    isInvalid,
    resetValidation,
  }
}
