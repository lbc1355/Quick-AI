import type { PopupOption } from '../../utils/autocompleteHelpers'

export interface PendingPermission {
  msgId: string
  agentRunId: string
  callId: string
  toolName: string
  args: unknown
}

export type PermissionResponsePayload = PopupOption['payload']
