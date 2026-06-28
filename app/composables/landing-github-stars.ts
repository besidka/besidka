export function useGithubStars() {
  return useFetch('/api/v1/github/stars', {
    key: 'landing-github-stars',
    getCachedData(key, nuxtApp) {
      if (nuxtApp.isHydrating) {
        return nuxtApp.payload.data[key]
      }

      return nuxtApp.static.data[key]
    },
  })
}
