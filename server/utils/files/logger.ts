import { useLogger } from 'evlog'

export interface LoggerLike {
  set: (data: Record<string, unknown>) => void
}

const NOOP_LOGGER: LoggerLike = {
  set() {},
}

export function resolveServerLogger(logger?: LoggerLike): LoggerLike {
  if (logger) {
    return logger
  }

  try {
    return useLogger(useEvent())
  } catch (_exception) {
    return NOOP_LOGGER
  }
}
