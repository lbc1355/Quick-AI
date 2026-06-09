/**
 * Constitution - a structured, machine-readable guardrail policy, inspired by CodeWhale's
 * `.codewhale/constitution.json` and execpolicy escalation. Instead of scattering safety rules
 * across prose in the system prompt, the agent loop consults this policy before dispatching a
 * tool call and may ESCALATE the static per-tool permission (allow -> ask -> deny) based on the
 * call's actual arguments. It never weakens a permission; it only tightens it.
 */

import { analyzeCommand, pathEscapesWorkspace } from './commandSafety'

export type GuardAction = 'allow' | 'ask' | 'deny'

export interface GuardVerdict {
  action: GuardAction
  /** Set only when the base permission was escalated; surfaced to the user and the model. */
  reason?: string
}

const SEVERITY: Record<GuardAction, number> = { allow: 0, ask: 1, deny: 2 }

/** Return the stricter of two actions (used to combine independent escalations). */
function stricter(a: GuardAction, b: GuardAction): GuardAction {
  return SEVERITY[b] > SEVERITY[a] ? b : a
}

export interface Constitution {
  /** Argument keys whose value is a filesystem path that must stay inside the workspace. */
  pathArgKeys: string[]
  /** Argument keys whose value is a shell command to be analyzed for danger. */
  commandArgKeys: string[]
  /** When true, any tool whose declared risk is 'high' requires confirmation even if allowed. */
  escalateHighRiskToAsk: boolean
}

export const DEFAULT_CONSTITUTION: Constitution = {
  pathArgKeys: ['path', 'filePath', 'file_path', 'dirPath', 'directory', 'dir'],
  commandArgKeys: ['command', 'cmd'],
  escalateHighRiskToAsk: true
}

/** Lexical sensitivity check on the final path component (keys, certs, dotenv files). */
function isSensitiveFileName(value: string): boolean {
  const base = value.replace(/\\/g, '/').split('/').filter(Boolean).pop()
  if (!base) return false
  const name = base.toLowerCase()
  if (name === '.env' || name.startsWith('.env.')) return true
  if (['id_rsa', 'id_dsa', 'id_ecdsa', 'id_ed25519'].includes(name)) return true
  return ['.pem', '.key', '.pfx', '.p12', '.cert', '.crt', '.der'].some((ext) => name.endsWith(ext))
}

/**
 * Evaluate a tool call against the constitution and return the (possibly escalated) action.
 *
 * @param basePermission the static per-tool permission from settings
 * @param risk           the tool's declared risk level
 */
export function evaluateToolGuard(
  toolName: string,
  args: Record<string, unknown>,
  basePermission: GuardAction,
  risk: 'low' | 'medium' | 'high',
  constitution: Constitution = DEFAULT_CONSTITUTION,
  /** When true the tool has been explicitly approved for this run — skip high-risk escalation. */
  isRunApproved = false
): GuardVerdict {
  let action: GuardAction = basePermission
  let reason: string | undefined

  const tighten = (next: GuardAction, why: string): void => {
    const combined = stricter(action, next)
    if (SEVERITY[combined] > SEVERITY[action]) {
      action = combined
      reason = why
    }
  }

  // Filesystem path arguments: deny on workspace escape, ask on sensitive targets.
  for (const key of constitution.pathArgKeys) {
    const value = args[key]
    if (typeof value !== 'string' || value === '') continue
    if (pathEscapesWorkspace(value)) {
      tighten(
        'ask',
        `Guardrail: "${key}" ("${value}") escapes the workspace / is outside the workspace; confirmation required.`
      )
    } else if (isSensitiveFileName(value)) {
      tighten(
        'ask',
        `Guardrail: "${key}" ("${value}") targets a sensitive file; confirmation required.`
      )
    }
  }

  // Shell command arguments: classify and escalate.
  for (const key of constitution.commandArgKeys) {
    const value = args[key]
    if (typeof value !== 'string' || value === '') continue
    const verdict = analyzeCommand(value)
    if (verdict.level === 'dangerous') {
      tighten('deny', `Blocked by guardrail: ${verdict.reason || 'dangerous command.'}`)
    } else if (verdict.level === 'requires_approval') {
      tighten('ask', `Guardrail: ${verdict.reason || 'command requires confirmation.'}`)
    }
  }

  // High-risk tools always require at least confirmation — unless the user has explicitly
  // approved the tool for this run (e.g. "allow all shell commands in this task").
  if (constitution.escalateHighRiskToAsk && risk === 'high' && !isRunApproved) {
    tighten('ask', `Guardrail: "${toolName}" is a high-risk tool; confirmation required.`)
  }

  return { action, reason }
}
