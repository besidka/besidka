export enum TimeUnits {
  seconds = 'seconds',
  minutes = 'minutes',
  hours = 'hours',
  days = 'days',
  years = 'years',
}

export interface CharacterCounts {
  lowercase: number
  uppercase: number
  digits: number
  symbols: number
}

export interface EstimateCrack {
  unit:
    | TimeUnits.seconds
    | TimeUnits.minutes
    | TimeUnits.hours
    | TimeUnits.days
    | TimeUnits.years
  text: string
}
