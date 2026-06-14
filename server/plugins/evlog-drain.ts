export default defineNitroPlugin((nitroApp) => {
  const { main, audit, consent } = getAxiomDrains()

  if (main) {
    nitroApp.hooks.hook('evlog:drain', main)
  }

  if (audit) {
    nitroApp.hooks.hook('evlog:drain', audit)
  }

  if (consent) {
    nitroApp.hooks.hook('evlog:drain', consent)
  }
})
