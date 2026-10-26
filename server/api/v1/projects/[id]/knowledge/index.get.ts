import type {
  ProjectKnowledgeSummary,
} from '#shared/types/project-knowledge.d'
import { createError, createRequestLogger } from 'evlog'
import { defineEventHandler } from 'nuxt/server'
import { applyResponseHeaders } from '~~/server/utils/http/apply-response-headers'
import { resolveKnowledgeProject } from '~~/server/utils/knowledge/access'
import {
  getKnowledgeProjectState,
  listKnowledgeItems,
} from '~~/server/utils/knowledge/items'
import { ensureKnowledgePackFresh } from '~~/server/utils/knowledge/pack'
import { useRequestLogger } from '~~/server/utils/logging/request-logger'

const BACKGROUND_LOG_PATH = '/api/v1/projects/[id]/knowledge'

type WaitUntilCtx = {
  cloudflare?: {
    context?: {
      waitUntil?: (promise: Promise<unknown>) => void
    }
  }
}

/**
 * Rebuilds the pack after the response. The request logger has already
 * emitted by then, so the task owns a logger and emits it itself.
 */
async function refreshPackInBackground(input: {
  userId: number
  projectId: number
  projectPublicId: string
  waitUntil: (promise: Promise<unknown>) => void
}): Promise<void> {
  const backgroundLogger = createRequestLogger({
    method: 'GET',
    path: BACKGROUND_LOG_PATH,
    waitUntil: input.waitUntil,
  })

  backgroundLogger.set({
    operation: 'knowledge-pack-refresh',
    userId: input.userId,
    projectId: input.projectPublicId,
  })

  try {
    await ensureKnowledgePackFresh({
      userId: input.userId,
      projectId: input.projectId,
      logger: backgroundLogger,
    })
  } finally {
    backgroundLogger.emit()
  }
}

export default defineEventHandler(
  async (event): Promise<ProjectKnowledgeSummary> => {
    const logger = useRequestLogger(event)
    const access = await resolveKnowledgeProject(event)
    const { userId, projectId, projectPublicId } = access
    const state = await getKnowledgeProjectState({ userId, projectId })

    if (!state) {
      throw createError({
        message: 'Project not found',
        status: 404,
        why: 'The project does not exist or belongs to another account',
        fix: 'Open a project from your project list',
      })
    }

    const items = await listKnowledgeItems({ userId, projectId })
    const totals = items.reduce((sums, item) => {
      return {
        latinChars: sums.latinChars + item.latinChars,
        cyrillicChars: sums.cyrillicChars + item.cyrillicChars,
        otherChars: sums.otherChars + item.otherChars,
        textBytes: sums.textBytes + item.textBytes,
        items: sums.items + 1,
      }
    }, {
      latinChars: 0,
      cyrillicChars: 0,
      otherChars: 0,
      textBytes: 0,
      items: 0,
    })
    const isPackStale = (state.packVersion ?? 0) < state.version
    const cfCtx = (event.context as WaitUntilCtx | undefined)
      ?.cloudflare?.context
    let packRefresh: 'none' | 'scheduled' | 'skipped' = 'none'

    applyResponseHeaders(event, { 'Cache-Control': 'no-store' })

    if (isPackStale && cfCtx?.waitUntil) {
      cfCtx.waitUntil(refreshPackInBackground({
        userId,
        projectId,
        projectPublicId,
        waitUntil: cfCtx.waitUntil.bind(cfCtx),
      }))
      packRefresh = 'scheduled'
    } else if (isPackStale) {
      packRefresh = 'skipped'
    }

    logger.set({
      userId,
      projectId: projectPublicId,
      attributes: {
        knowledge: {
          operation: 'summary',
          items: totals.items,
          textBytes: totals.textBytes,
          version: state.version,
          packVersion: state.packVersion,
          packRefresh,
        },
      },
    })

    return {
      projectId: projectPublicId,
      mode: state.mode ?? 'auto',
      version: state.version,
      packVersion: state.packVersion,
      items,
      totals,
    }
  },
)
