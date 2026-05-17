export default defineNitroPlugin((nitroApp) => {
  const { main, audit } = getAxiomDrains()

  if (main) {
    nitroApp.hooks.hook('evlog:drain', main)
  }

  if (audit) {
    nitroApp.hooks.hook('evlog:drain', audit)
  }
})
