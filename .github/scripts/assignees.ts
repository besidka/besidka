import type { AsyncFunctionArguments } from '@actions/github-script'

export async function setAssignees(
  { github, context }: AsyncFunctionArguments,
) {
  const { pull_request: pr, action } = context.payload

  if (!pr || action !== 'opened') {
    return
  }

  const assignees: string[] = []

  if (pr.user.login === context.repo.owner) {
    assignees.push(context.repo.owner)
  } else {
    assignees.push(pr.user.login)
  }

  await github.rest.issues.addAssignees({
    issue_number: pr.number,
    owner: context.repo.owner,
    repo: context.repo.repo,
    assignees,
  })
}
