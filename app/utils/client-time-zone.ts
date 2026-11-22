/**
 * The browser's IANA time zone as an optional request body field. Every
 * request to the chat route that can start a model call carries it, so the
 * server states the same local day on every request of a chat.
 */
export function getClientTimeZoneField(): { timeZone?: string } {
  const { timeZone } = Intl.DateTimeFormat().resolvedOptions()

  if (!timeZone) {
    return {}
  }

  return { timeZone }
}
