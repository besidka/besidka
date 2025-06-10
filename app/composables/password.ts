import type { CharacterCounts, EstimateCrack } from '~/types/password.d'
import { TimeUnits } from '~/types/password.d'

const chars: CharacterCounts = {
  lowercase: 26,
  uppercase: 26,
  digits: 10,
  symbols: 33,
}

const attemptsPerSecond = 1e10

function formatNumber(value: number) {
  return parseFloat(value.toFixed(0))
}

function formatTime(seconds: number): EstimateCrack {
  const minute = 60
  const hour = minute * 60
  const day = hour * 24
  const year = day * 365

  if (seconds < minute) {
    return {
      unit: TimeUnits.seconds,
      text: 'A few seconds',
    }
  } else if (seconds < hour) {
    return {
      unit: TimeUnits.minutes,
      text: `Minutes: ${formatNumber(seconds / minute)}`,
    }
  } else if (seconds < day) {
    return {
      unit: TimeUnits.hours,
      text: `Hours: ${formatNumber(seconds / hour)}`,
    }
  } else if (seconds < year) {
    return {
      unit: TimeUnits.days,
      text: `Days: ${formatNumber(seconds / day)}`,
    }
  } else {
    return {
      unit: TimeUnits.years,
      text: 'More than a year',
    }
  }
}

function estimateTimeToCrack(password: string): EstimateCrack {
  let poolSize = 0

  const hasLowercase = z.string().regex(/[a-z]/).safeParse(password).success
  const hasUppercase = z.string().regex(/[A-Z]/).safeParse(password).success
  const hasDigits = z.string().regex(/\d/).safeParse(password).success
  const hasSymbols = z.string().regex(/[!@#$%^&*(),.?":{}|<>]/).safeParse(password).success

  if (hasLowercase) poolSize += chars.lowercase
  if (hasUppercase) poolSize += chars.uppercase
  if (hasDigits) poolSize += chars.digits
  if (hasSymbols) poolSize += chars.symbols

  const totalCombinations = Math.pow(poolSize, password.length)
  const secondsToCrack = totalCombinations / attemptsPerSecond

  return formatTime(secondsToCrack)
}

export function usePassword() {
  return {
    estimateTimeToCrack,
  }
}
