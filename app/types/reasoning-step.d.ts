import type { ConnectorImagePartData } from '#shared/utils/connector-image-parts'
import type { ConnectorToolCallModel } from '#shared/utils/connectors-parts'
import type { GoogleStepData } from '~/types/google-step.d'
import type { MemoryStepData } from '~/types/memory-step.d'
import type { SearchStepData } from '~/types/search-step.d'
import type { SkillStepModel } from '~/utils/skill-step'
import type { ReasoningStepIcon } from '~/utils/reasoning-step-icons'
import type {
  ApprovalStepModel,
  ApprovalStepState,
} from '~/utils/tool-approval-step'

export interface ReasoningApprovalStep {
  model: ApprovalStepModel
  state: ApprovalStepState
  connectorName: string
  reasonText: string
  summaryLine: string
  progress: string
  outcome: string
  isInBubble: boolean
}

export interface ReasoningStep {
  id: string
  title: string
  body: string
  kind: 'reasoning' | 'tool'
  pending: boolean
  failed: boolean
  waiting?: boolean
  search: SearchStepData | null
  memory: MemoryStepData | null
  skill: SkillStepModel | null
  connector: ConnectorToolCallModel | null
  google?: GoogleStepData | null
  icon?: ReasoningStepIcon | null
  approval?: ReasoningApprovalStep | null
  approvalOutcome?: string
  grantMarker?: string
  connectorTitle?: string
  connectorImages?: ConnectorImagePartData[]
}
