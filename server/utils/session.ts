export function useUnauthorizedError() {
  throw createError({
    statusCode: 401,
    statusMessage: `You don't have access to this resource. Try to sign out and sign in again.`,
  })
}

export async function useUserSession() {
  return await useServerAuth().api.getSession({
    // @ts-ignore
    headers: getHeaders(useEvent()),
  })
}
