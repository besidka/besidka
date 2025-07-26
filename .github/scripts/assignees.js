// eslint-disable-next-line @stylistic/max-len
/** @param {import('@actions/github-script').AsyncFunctionArguments} AsyncFunctionArguments */
export async function setAssignees({ github, context }) {
  const { pull_request: pr } = context.payload

  if (!pr) {
    return
  }

  const assignees = []

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
