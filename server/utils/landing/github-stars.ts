import { createError } from 'evlog'

export interface GithubStars {
  repo: string
  stars: number
  forks: number
  watchers: number
  htmlUrl: string
  updatedAt: string
}

const REPO_PATTERN = /^[\w.-]+\/[\w.-]+$/

export async function fetchGithubStars(
  repo: string = 'besidka/besidka',
): Promise<GithubStars> {
  if (!repo || !REPO_PATTERN.test(repo)) {
    throw createError({
      message: 'Invalid repository name',
      status: 400,
      why: `Repo "${repo}" does not match expected format owner/name`,
      fix: 'Pass a valid GitHub repository slug, e.g. "besidka/besidka"',
    })
  }

  const response = await fetch(
    `https://api.github.com/repos/${repo}`,
    {
      headers: {
        'Accept': 'application/vnd.github+json',
        'User-Agent': 'besidka-landing-cache',
      },
    },
  )

  if (!response.ok) {
    const bodyExcerpt = await response.text().then(text => text.slice(0, 200))

    throw createError({
      message: 'GitHub stars fetch failed',
      status: 502,
      why: `GitHub API returned ${response.status}: ${bodyExcerpt}`,
      fix: 'Check repo name and GitHub API status',
    })
  }

  const data = await response.json() as {
    stargazers_count: number
    forks_count: number
    subscribers_count: number
    html_url: string
  }

  return {
    repo,
    stars: data.stargazers_count,
    forks: data.forks_count,
    watchers: data.subscribers_count,
    htmlUrl: data.html_url,
    updatedAt: new Date().toISOString(),
  }
}

export const cachedGithubStars = defineCachedFunction(
  async (repo: string = 'besidka/besidka') => {
    return fetchGithubStars(repo)
  },
  {
    name: 'landing-github-stars',
    maxAge: 60 * 60,
    swr: true,
    staleMaxAge: 24 * 60 * 60,
    getKey: (repo = 'besidka/besidka') => repo,
    group: 'landing',
  },
)
