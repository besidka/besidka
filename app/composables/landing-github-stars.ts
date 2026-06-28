export function useGithubStars() {
  return useLazyFetch('/api/v1/github/stars', {
    key: 'landing-github-stars',
  })
}
