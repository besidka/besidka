// eslint-disable-next-line @stylistic/max-len
/** @param {import('@actions/github-script').AsyncFunctionArguments} AsyncFunctionArguments */
export async function updatePR({ github, context }) {
  const { pull_request: pr } = context.payload

  if (!pr) {
    return
  }

  const scriptsPath = `${context.payload.workspace}/.github/scripts`
  const [
    labelsModule,
    assigneesModule,
    milestoneModule,
    projectModule,
  ] = await Promise.all([
    import(`${scriptsPath}/labels.js`),
    import(`${scriptsPath}/assignees.js`),
    import(`${scriptsPath}/milestone.js`),
    import(`${scriptsPath}/project.js`),
  ])

  await Promise.all([
    labelsModule.setLabels({ github, context }),
    assigneesModule.setAssignees({ github, context }),
    milestoneModule.setMilestone({ github, context }),
    projectModule.setProject({ github, context }),
  ])
}
