// Named as the category rather than a list of exceptions: a new app layout gets
// a sidebar by default, and only layouts that bring their own header/footer
// chrome opt out. app.vue mounts the Sidebar from this, and the cookie trigger
// derives its mobile offset from it, so the two can never disagree.
const CHROME_ONLY_LAYOUTS = ['landing', 'legal']

export function useHasSidebar() {
  const layout = useLayout()

  return computed<boolean>(() => {
    return typeof layout.value !== 'string'
      || !CHROME_ONLY_LAYOUTS.includes(layout.value)
  })
}
