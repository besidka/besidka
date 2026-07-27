// The route slug IS the content filename, so deriving both the query path and
// the useAsyncData key from it keeps one source for what were three repeated
// strings per page. The key must stay `legal-<slug>` so the payload key does
// not change. Not awaited here on purpose -- awaiting a data composable inside
// a wrapper misbehaves; the page awaits the returned promise instead.
export function useLegalDocument() {
  const route = useRoute()
  const slug = route.path.replace(/^\/+|\/+$/g, '')

  return useAsyncData(`legal-${slug}`, () => {
    return queryCollection('legal').path(`/legal/${slug}`).first()
  })
}
