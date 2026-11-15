import { z } from 'zod'
import type { McpPrivateToolName } from '~~/server/utils/mcp/tool-scopes'
import type {
  BesidkaTool,
  BesidkaToolChatExposure,
  BesidkaToolTier,
} from '~~/server/utils/besidka-tools/types'
import { addConnectorBesidkaTool } from '~~/server/utils/besidka-tools/tools/add-connector'
import { addMemoryBesidkaTool } from '~~/server/utils/besidka-tools/tools/add-memory'
import { addProjectNoteBesidkaTool } from '~~/server/utils/besidka-tools/tools/add-project-note'
import { addProjectTextBesidkaTool } from '~~/server/utils/besidka-tools/tools/add-project-text'
import { branchChatBesidkaTool } from '~~/server/utils/besidka-tools/tools/branch-chat'
import { createArtifactBesidkaTool } from '~~/server/utils/besidka-tools/tools/create-artifact'
import { createDocumentBesidkaTool } from '~~/server/utils/besidka-tools/tools/create-document'
import { createFileBesidkaTool } from '~~/server/utils/besidka-tools/tools/create-file'
import { createProjectBesidkaTool } from '~~/server/utils/besidka-tools/tools/create-project'
import { deleteArtifactsBesidkaTool } from '~~/server/utils/besidka-tools/tools/delete-artifacts'
import { deleteChatMessageBesidkaTool } from '~~/server/utils/besidka-tools/tools/delete-chat-message'
import { deleteChatsBesidkaTool } from '~~/server/utils/besidka-tools/tools/delete-chats'
import { deleteConnectorsBesidkaTool } from '~~/server/utils/besidka-tools/tools/delete-connectors'
import { deleteFilesBesidkaTool } from '~~/server/utils/besidka-tools/tools/delete-files'
import { deleteMemoryBesidkaTool } from '~~/server/utils/besidka-tools/tools/delete-memory'
import { deleteProjectBesidkaTool } from '~~/server/utils/besidka-tools/tools/delete-project'
import { deleteProjectKnowledgeItemsBesidkaTool } from '~~/server/utils/besidka-tools/tools/delete-project-knowledge-items'
import { getArtifactBesidkaTool } from '~~/server/utils/besidka-tools/tools/get-artifact'
import { getChatBesidkaTool } from '~~/server/utils/besidka-tools/tools/get-chat'
import { getConnectorBesidkaTool } from '~~/server/utils/besidka-tools/tools/get-connector'
import { getProjectBesidkaTool } from '~~/server/utils/besidka-tools/tools/get-project'
import { getSettingsBesidkaTool } from '~~/server/utils/besidka-tools/tools/get-settings'
import { listArtifactSharesBesidkaTool } from '~~/server/utils/besidka-tools/tools/list-artifact-shares'
import { listArtifactsBesidkaTool } from '~~/server/utils/besidka-tools/tools/list-artifacts'
import { listChatsBesidkaTool } from '~~/server/utils/besidka-tools/tools/list-chats'
import { listConnectorsBesidkaTool } from '~~/server/utils/besidka-tools/tools/list-connectors'
import { listFeatureAccessBesidkaTool } from '~~/server/utils/besidka-tools/tools/list-feature-access'
import { listFeatureFlagsBesidkaTool } from '~~/server/utils/besidka-tools/tools/list-feature-flags'
import { listFilesBesidkaTool } from '~~/server/utils/besidka-tools/tools/list-files'
import { listMemoryBesidkaTool } from '~~/server/utils/besidka-tools/tools/list-memory'
import { listMyFeaturesBesidkaTool } from '~~/server/utils/besidka-tools/tools/list-my-features'
import { listProjectsBesidkaTool } from '~~/server/utils/besidka-tools/tools/list-projects'
import { listSharedChatsBesidkaTool } from '~~/server/utils/besidka-tools/tools/list-shared-chats'
import { moveChatsToProjectBesidkaTool } from '~~/server/utils/besidka-tools/tools/move-chats-to-project'
import { readFileBesidkaTool } from '~~/server/utils/besidka-tools/tools/read-file'
import { readProjectKnowledgeItemBesidkaTool } from '~~/server/utils/besidka-tools/tools/read-project-knowledge-item'
import { renameFileBesidkaTool } from '~~/server/utils/besidka-tools/tools/rename-file'
import { resetMemoryBesidkaTool } from '~~/server/utils/besidka-tools/tools/reset-memory'
import { revokeArtifactSharesBesidkaTool } from '~~/server/utils/besidka-tools/tools/revoke-artifact-shares'
import { revokeChatSharesBesidkaTool } from '~~/server/utils/besidka-tools/tools/revoke-chat-shares'
import { setFeatureAccessBesidkaTool } from '~~/server/utils/besidka-tools/tools/set-feature-access'
import { shareArtifactBesidkaTool } from '~~/server/utils/besidka-tools/tools/share-artifact'
import { updateArtifactBesidkaTool } from '~~/server/utils/besidka-tools/tools/update-artifact'
import { updateChatBesidkaTool } from '~~/server/utils/besidka-tools/tools/update-chat'
import { updateConnectorToolsBesidkaTool } from '~~/server/utils/besidka-tools/tools/update-connector-tools'
import { updateMemoryBesidkaTool } from '~~/server/utils/besidka-tools/tools/update-memory'
import { updateProjectBesidkaTool } from '~~/server/utils/besidka-tools/tools/update-project'
import { updateProjectInstructionsBesidkaTool } from '~~/server/utils/besidka-tools/tools/update-project-instructions'
import { updateProjectKnowledgeItemBesidkaTool } from '~~/server/utils/besidka-tools/tools/update-project-knowledge-item'
import { updateSettingsBesidkaTool } from '~~/server/utils/besidka-tools/tools/update-settings'

export const BESIDKA_TOOLS = {
  add_connector: addConnectorBesidkaTool,
  add_memory: addMemoryBesidkaTool,
  add_project_note: addProjectNoteBesidkaTool,
  add_project_text: addProjectTextBesidkaTool,
  branch_chat: branchChatBesidkaTool,
  create_artifact: createArtifactBesidkaTool,
  create_document: createDocumentBesidkaTool,
  create_file: createFileBesidkaTool,
  create_project: createProjectBesidkaTool,
  delete_artifacts: deleteArtifactsBesidkaTool,
  delete_chat_message: deleteChatMessageBesidkaTool,
  delete_chats: deleteChatsBesidkaTool,
  delete_connectors: deleteConnectorsBesidkaTool,
  delete_files: deleteFilesBesidkaTool,
  delete_memory: deleteMemoryBesidkaTool,
  delete_project: deleteProjectBesidkaTool,
  delete_project_knowledge_items: deleteProjectKnowledgeItemsBesidkaTool,
  get_artifact: getArtifactBesidkaTool,
  get_chat: getChatBesidkaTool,
  get_connector: getConnectorBesidkaTool,
  get_project: getProjectBesidkaTool,
  get_settings: getSettingsBesidkaTool,
  list_artifact_shares: listArtifactSharesBesidkaTool,
  list_artifacts: listArtifactsBesidkaTool,
  list_chats: listChatsBesidkaTool,
  list_connectors: listConnectorsBesidkaTool,
  list_feature_access: listFeatureAccessBesidkaTool,
  list_feature_flags: listFeatureFlagsBesidkaTool,
  list_files: listFilesBesidkaTool,
  list_memory: listMemoryBesidkaTool,
  list_my_features: listMyFeaturesBesidkaTool,
  list_projects: listProjectsBesidkaTool,
  list_shared_chats: listSharedChatsBesidkaTool,
  move_chats_to_project: moveChatsToProjectBesidkaTool,
  read_file: readFileBesidkaTool,
  read_project_knowledge_item: readProjectKnowledgeItemBesidkaTool,
  rename_file: renameFileBesidkaTool,
  reset_memory: resetMemoryBesidkaTool,
  revoke_artifact_shares: revokeArtifactSharesBesidkaTool,
  revoke_chat_shares: revokeChatSharesBesidkaTool,
  set_feature_access: setFeatureAccessBesidkaTool,
  share_artifact: shareArtifactBesidkaTool,
  update_artifact: updateArtifactBesidkaTool,
  update_chat: updateChatBesidkaTool,
  update_connector_tools: updateConnectorToolsBesidkaTool,
  update_memory: updateMemoryBesidkaTool,
  update_project: updateProjectBesidkaTool,
  update_project_instructions: updateProjectInstructionsBesidkaTool,
  update_project_knowledge_item: updateProjectKnowledgeItemBesidkaTool,
  update_settings: updateSettingsBesidkaTool,
} as const satisfies Record<McpPrivateToolName, BesidkaTool>

type ExposedChatExposure = Extract<BesidkaToolChatExposure, { expose: true }>

export type ChatExposedBesidkaTool = BesidkaTool & {
  chat: ExposedChatExposure
}

export function listBesidkaTools(): BesidkaTool[] {
  return Object.values(BESIDKA_TOOLS)
}

export function getBesidkaTool(name: McpPrivateToolName): BesidkaTool {
  return BESIDKA_TOOLS[name]
}

export function isChatExposed(
  tool: BesidkaTool,
): tool is ChatExposedBesidkaTool {
  return 'expose' in tool.chat
}

export function listChatExposedBesidkaTools(
  tier?: BesidkaToolTier,
): ChatExposedBesidkaTool[] {
  return listBesidkaTools()
    .filter(isChatExposed)
    .filter((tool) => {
      return tier === undefined || tool.chat.tier === tier
    })
}

/**
 * The sentence an approval prompt shows for a call, written by the server.
 * The input is parsed with the tool's own schema first, so a summarizer only
 * sees declared, validated fields and never an extra key a model invented.
 * A tool without a summarizer, or an input that does not parse, falls back
 * to the tool title.
 */
export function summarizeBesidkaToolCall(
  tool: BesidkaTool,
  input: unknown,
): string {
  if (!tool.summarize) {
    return tool.title
  }

  const parsed = z.object(tool.inputSchema ?? {}).safeParse(input)

  if (!parsed.success) {
    return tool.title
  }

  try {
    return tool.summarize(parsed.data as never)
  } catch {
    return tool.title
  }
}
