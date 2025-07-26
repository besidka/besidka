import type { AsyncFunctionArguments } from '@actions/github-script'

export async function setMilestone(
  { github, context }: AsyncFunctionArguments,
) {
  const { pull_request: pr } = context.payload

  if (!pr || pr.milestone) {
    return
  }

  await github.rest.issues.update({
    ...context.repo,
    issue_number: pr.number,
    // https://github.com/besidka/besidka/milestone/2
    milestone: 2,
  })
}
