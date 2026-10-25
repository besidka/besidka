const ABOUT_ME_HEADER = 'The user wrote the following about themselves as '
  + 'standing instructions. Follow them in every reply:'

export function buildAboutMeInstruction(
  aboutMe: string | null | undefined,
): string | null {
  const trimmedAboutMe = aboutMe?.trim() ?? ''

  if (trimmedAboutMe === '') {
    return null
  }

  return `${ABOUT_ME_HEADER}\n${trimmedAboutMe}`
}
