import { readFileSync } from 'node:fs'
import { parse } from 'yaml'
import { describe, expect, it } from 'vitest'

interface WorkflowStep {
  name?: string
  uses?: string
  run?: string
  env?: Record<string, string>
  with?: Record<string, unknown>
}

interface WorkflowJob {
  environment?: string
  permissions?: Record<string, string>
  steps: Array<WorkflowStep>
}

interface Workflow {
  jobs: Record<string, WorkflowJob>
}

const DEFAULT_BRANCH_REF = '${{ github.event.repository.default_branch }}'
const FULL_COMMIT_SHA = /@[0-9a-f]{40}$/
const INTEGRITY_STEP_NAME = 'Verify artifacts stayed inside .output and .drizzle'
const MIGRATIONS_STEP_NAME = 'Verify migrations match the PR commit'
const INSTALL_STEP_NAME = 'Install dependencies'

const SECRET_BEARING_WORKFLOWS = [
  'preview-deploy.yml',
  'preview-cleanup.yml',
  'production.yml',
  'claude.yml',
  'claude-code-review.yml',
  'update.yml',
  'linear-docs-sync.yml',
]

function readWorkflow(fileName: string): Workflow {
  const content = readFileSync(`.github/workflows/${fileName}`, 'utf8')

  return parse(content) as Workflow
}

function getAllSteps(workflow: Workflow): Array<WorkflowStep> {
  return Object.values(workflow.jobs).flatMap(job => job.steps)
}

function referencesSecrets(step: WorkflowStep): boolean {
  const withValues = Object.values(step.with ?? {})
  const envValues = Object.values(step.env ?? {})
  const searchableValues = [...withValues, ...envValues, step.run ?? '']

  return searchableValues.some((value) => {
    return String(value).includes('secrets.')
  })
}

const deployJob = readWorkflow('preview-deploy.yml').jobs.deploy
const deploySteps = deployJob.steps

function indexOfStep(name: string): number {
  return deploySteps.findIndex(step => step.name === name)
}

function indexOfDownload(artifactName: string): number {
  return deploySteps.findIndex((step) => {
    return step.uses?.startsWith('actions/download-artifact') === true
      && step.with?.name === artifactName
  })
}

describe('preview-deploy workflow', () => {
  it('checks out only the default branch without persisting credentials', () => {
    const checkoutSteps = deploySteps.filter((step) => {
      return step.uses?.startsWith('actions/checkout')
    })

    expect(checkoutSteps.length).toBeGreaterThan(0)

    for (const step of checkoutSteps) {
      expect(step.with?.ref).toBe(DEFAULT_BRANCH_REF)
      expect(step.with?.['persist-credentials']).toBe(false)
    }
  })

  it('never selects a checkout ref from the PR head sha', () => {
    for (const step of deploySteps) {
      expect(String(step.with?.ref ?? '')).not.toContain(
        'steps.pr.outputs.sha',
      )
    }
  })

  it('downloads the build artifact into .output/', () => {
    const step = deploySteps[indexOfDownload('preview-build')]

    expect(step?.with?.path).toBe('.output/')
  })

  it('downloads the drizzle artifact into .drizzle/', () => {
    const step = deploySteps[indexOfDownload('preview-drizzle')]

    expect(step?.with?.path).toBe('.drizzle/')
  })

  it('never downloads an artifact into the workspace root', () => {
    const downloadSteps = deploySteps.filter((step) => {
      return step.uses?.startsWith('actions/download-artifact')
    })

    expect(downloadSteps.length).toBeGreaterThan(0)

    for (const step of downloadSteps) {
      expect(['.', './']).not.toContain(step.with?.path)
    }
  })

  it('removes default-branch migrations before the drizzle download', () => {
    const removeIndex = deploySteps.findIndex((step) => {
      return step.run?.trim() === 'rm -rf .drizzle'
    })
    const downloadIndex = indexOfDownload('preview-drizzle')

    expect(removeIndex).toBeGreaterThanOrEqual(0)
    expect(downloadIndex).toBeGreaterThanOrEqual(0)
    expect(removeIndex).toBeLessThan(downloadIndex)
  })

  it('verifies artifact confinement after both downloads and before install', () => {
    const verifyIndex = indexOfStep(INTEGRITY_STEP_NAME)
    const buildDownloadIndex = indexOfDownload('preview-build')
    const drizzleDownloadIndex = indexOfDownload('preview-drizzle')
    const installIndex = indexOfStep(INSTALL_STEP_NAME)

    expect(verifyIndex).toBeGreaterThanOrEqual(0)
    expect(buildDownloadIndex).toBeGreaterThanOrEqual(0)
    expect(drizzleDownloadIndex).toBeGreaterThanOrEqual(0)
    expect(installIndex).toBeGreaterThanOrEqual(0)
    expect(verifyIndex).toBeGreaterThan(buildDownloadIndex)
    expect(verifyIndex).toBeGreaterThan(drizzleDownloadIndex)
    expect(verifyIndex).toBeLessThan(installIndex)
  })

  it('fails the integrity check on files outside the artifact folders', () => {
    const verifyStep = deploySteps[indexOfStep(INTEGRITY_STEP_NAME)]

    expect(verifyStep?.run).toContain('--ignored')
    expect(verifyStep?.run).toContain('--untracked-files=all')
    expect(verifyStep?.run).toContain(':(exclude).output')
    expect(verifyStep?.run).toContain(':(exclude).drizzle')
    expect(verifyStep?.run).toContain('exit 1')
  })

  it('verifies migrations against the PR commit before install', () => {
    const verifyIndex = indexOfStep(MIGRATIONS_STEP_NAME)
    const drizzleDownloadIndex = indexOfDownload('preview-drizzle')
    const integrityIndex = indexOfStep(INTEGRITY_STEP_NAME)
    const installIndex = indexOfStep(INSTALL_STEP_NAME)
    const verifyStep = deploySteps[verifyIndex]

    expect(verifyIndex).toBeGreaterThanOrEqual(0)
    expect(drizzleDownloadIndex).toBeGreaterThanOrEqual(0)
    expect(integrityIndex).toBeGreaterThanOrEqual(0)
    expect(installIndex).toBeGreaterThanOrEqual(0)
    expect(verifyIndex).toBeGreaterThan(drizzleDownloadIndex)
    expect(verifyIndex).toBeGreaterThan(integrityIndex)
    expect(verifyIndex).toBeLessThan(installIndex)
    expect(verifyStep?.run).toContain('git hash-object')
    expect(verifyStep?.run).toContain('git/trees')
  })

  it('lists PR files through the pull request files endpoint', () => {
    const driftStep = deploySteps.find((step) => {
      return step.name === 'Check whether the PR changes wrangler.jsonc'
    })

    expect(driftStep).toBeDefined()
    expect(driftStep?.run).toContain('pulls/')
    expect(driftStep?.run).toContain('/files')
    expect(driftStep?.run).not.toContain('/compare/')
  })

  it('does not use the cloudflare wrangler action', () => {
    for (const step of deploySteps) {
      expect(step.uses ?? '').not.toContain('cloudflare/wrangler-action')
    }
  })

  it('exposes secrets only after dependencies are installed', () => {
    const installIndex = indexOfStep(INSTALL_STEP_NAME)
    const secretStepIndexes = deploySteps.flatMap((step, index) => {
      return referencesSecrets(step) ? [index] : []
    })

    expect(installIndex).toBeGreaterThanOrEqual(0)
    expect(secretStepIndexes.length).toBeGreaterThan(0)

    for (const index of secretStepIndexes) {
      expect(index).toBeGreaterThan(installIndex)
    }
  })

  it('does not request an OIDC token', () => {
    expect(deployJob.permissions).not.toHaveProperty('id-token')
  })
})

describe('production workflow', () => {
  it.each(['build-production', 'deploy-preview'])(
    'runs the %s job in the production environment',
    (jobName) => {
      const job = readWorkflow('production.yml').jobs[jobName]

      expect(job).toBeDefined()
      expect(job?.environment).toBe('production')
    },
  )
})

describe('workflows that reference secrets', () => {
  it.each(SECRET_BEARING_WORKFLOWS)(
    'pins every non-actions step in %s to a full commit sha',
    (fileName) => {
      const steps = getAllSteps(readWorkflow(fileName))
      const thirdPartyUses = steps
        .map(step => step.uses)
        .filter((uses): uses is string => {
          return typeof uses === 'string' && !uses.startsWith('actions/')
        })

      for (const uses of thirdPartyUses) {
        expect(uses).toMatch(FULL_COMMIT_SHA)
      }
    },
  )
})
