import type { Validation } from '~/types/validation.d'

export const useValidation = (): { Validation: Validation } => ({
  Validation: {
    required: () => ({
      validate(value) {
        switch (typeof value) {
          case 'boolean':
            return value
          default:
            return z.string().min(1).safeParse(value).success
        }
      },
      message: 'This field is required',
    }),
    onlyDigits: () => ({
      validate: value => z.string().regex(/^\d+$/).safeParse(value).success,
      message: 'Should contain only digits',
    }),
    withoutDigits: () => ({
      validate: value => z.string().regex(/^\D+$/).safeParse(value).success,
      message: 'Should not contain any digits',
    }),
    min: (length: number = 2) => ({
      validate: value => z.string().min(length).safeParse(value).success,
      message: `Should contain at least ${length} characters`,
    }),
    max: (length: number = 255) => ({
      validate: value => z.string().max(length).safeParse(value).success,
      message: `Should contain at most ${length} characters`,
    }),
    url: () => ({
      validate: value => z.url().safeParse(value).success,
      message: 'Should be a valid URL',
    }),
    email: () => ({
      validate: value => z.email().safeParse(value).success,
      message: 'Should be a valid email',
    }),
    equal: (valueToCompare: string) => ({
      validate: value => value === valueToCompare,
      message: 'Should match the password',
    }),
    checked: () => ({
      validate: value => value === 'true',
      message: 'This field must be checked',
    }),
    uppercase: (amount: number = 1) => ({
      validate: value => z.string().regex(/[A-Z]/).safeParse(value).success,
      message: `Should contain at least ${amount} uppercase letter${amount > 1 ? 's' : ''}`,
    }),
    specialChar: (amount: number = 1) => ({
      validate: value => z.string().regex(/[\W_]/).safeParse(value).success,
      message: `Should contain at least ${amount} special character${amount > 1 ? 's' : ''}`,
    }),
    digit: (amount: number = 1) => ({
      validate: value => z.string().regex(/\d/).safeParse(value).success,
      message: `Should contain at least ${amount} digit${amount > 1 ? 's' : ''}`,
    }),
  },
})
