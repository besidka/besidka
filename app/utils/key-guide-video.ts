interface NetworkInformationLike {
  saveData?: boolean
}

export function canAutoplayGuideVideo(): boolean {
  if (typeof window === 'undefined') {
    return false
  }

  const prefersReducedMotion = window
    .matchMedia('(prefers-reduced-motion: reduce)')
    .matches

  if (prefersReducedMotion) {
    return false
  }

  const connection = (navigator as Navigator & {
    connection?: NetworkInformationLike
  }).connection

  return !connection?.saveData
}
