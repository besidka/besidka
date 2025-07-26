// eslint-disable-next-line @stylistic/max-len
/** @param {import('@actions/github-script').AsyncFunctionArguments} AsyncFunctionArguments */
export async function setMilestone({ github, context }) {
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
