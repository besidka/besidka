export interface ValidationRule {
  validate: (value: string | boolean) => boolean
  message: string
}

export type ValidationMethods
  = | 'required'
    | 'onlyDigits'
    | 'withoutDigits'
    | 'min'
    | 'max'
    | 'url'
    | 'email'
    | 'equal'
    | 'checked'
    | 'uppercase'
    | 'specialChar'
    | 'digit'

export type Validation = {
  [K in ValidationMethods]: (...props: any[]) => ValidationRule
}
