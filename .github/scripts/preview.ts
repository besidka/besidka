import type { AsyncFunctionArguments } from '@actions/github-script'

export async function displayPreviewUrl(
  { github, context }: AsyncFunctionArguments,
) {
  const { pull_request: pr } = context.payload
  const url = process.env.DEPLOYMENT_URL || 'URL not found'

  if (!pr) return

  await github.rest.issues.createComment({
    ...context.repo,
    issue_number: pr.number,
    body: `🚀 Preview deployed: ${url}`,
  })
}
