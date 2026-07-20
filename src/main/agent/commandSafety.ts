/**
 * Pure command-safety primitives, ported from CodeWhale's command_safety / execpolicy ideas.
 *
 * Everything here is side-effect free (no fs, no electron) so it is trivially testable and can run
 * before a tool is dispatched. The concern is `analyzeCommand`: token-level danger classification
 * for shell-style commands. The guiding principle (borrowed from Codex/CodeWhale) is restraint:
 * only flag genuinely destructive actions as `dangerous`, so everyday commands don't drown the
 * user in approval prompts. Lexical path-containment checks live in ./pathPolicy.
 */

import { pathEscapesWorkspace } from './pathPolicy'

export type CommandSafetyLevel = 'safe' | 'requires_approval' | 'dangerous'

export interface CommandSafetyVerdict {
  level: CommandSafetyLevel
  reason?: string
}

/** Minimal shell-ish tokenizer: splits on whitespace, respecting single and double quotes. */
export function tokenizeCommand(command: string): string[] {
  const tokens: string[] = []
  let current = ''
  let quote: '"' | "'" | null = null
  let started = false

  for (const ch of command) {
    if (quote) {
      if (ch === quote) {
        quote = null
      } else {
        current += ch
      }
      continue
    }
    if (ch === '"' || ch === "'") {
      quote = ch
      started = true
      continue
    }
    if (/\s/.test(ch)) {
      if (started) {
        tokens.push(current)
        current = ''
        started = false
      }
      continue
    }
    current += ch
    started = true
  }
  if (started) tokens.push(current)
  return tokens
}

/** Index of the primary command token, skipping leading `env` and `FOO=bar` assignments. */
function primaryTokenIndex(tokens: string[]): number {
  let i = 0
  while (i < tokens.length) {
    const tok = tokens[i]
    if (tok === 'env') {
      i += 1
      continue
    }
    if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(tok)) {
      i += 1
      continue
    }
    return i
  }
  return tokens.length
}

const DANGEROUS_RM_TARGETS = new Set(['/', '~', '$HOME', '$home'])

function isDangerousRmTarget(target: string): boolean {
  const t = target.replace(/\\/g, '/').trim()
  if (DANGEROUS_RM_TARGETS.has(t)) return true
  if (/^\/+$/.test(t)) return true // "/", "//"
  if (t.startsWith('~')) return true
  if (/\$(HOME|USERPROFILE)\b/.test(t) || /%USERPROFILE%/i.test(t)) return true
  if (pathEscapesWorkspace(t)) return true // climbs above the workspace
  return false
}

const SEVERITY: Record<CommandSafetyLevel, number> = {
  safe: 0,
  requires_approval: 1,
  dangerous: 2
}

/** Return the stricter of two verdicts (used to combine independent command segments). */
function stricterVerdict(a: CommandSafetyVerdict, b: CommandSafetyVerdict): CommandSafetyVerdict {
  return SEVERITY[b.level] > SEVERITY[a.level] ? b : a
}

/**
 * Split a command line into independently-executed segments on shell control operators
 * (`;` `&&` `||` `|` `&` and newlines), while respecting single/double quotes so separators
 * inside string literals do not split. Conservative: when in doubt it produces MORE segments,
 * which only ever increases scrutiny.
 */
export function splitCommandSegments(command: string): string[] {
  const segments: string[] = []
  let current = ''
  let quote: '"' | "'" | null = null

  for (let i = 0; i < command.length; i++) {
    const ch = command[i]
    const next = command[i + 1]

    if (quote) {
      current += ch
      if (ch === quote) quote = null
      continue
    }
    if (ch === '"' || ch === "'") {
      quote = ch
      current += ch
      continue
    }
    // Two-char operators.
    if ((ch === '&' && next === '&') || (ch === '|' && next === '|')) {
      segments.push(current)
      current = ''
      i++
      continue
    }
    // Single-char separators.
    if (ch === ';' || ch === '|' || ch === '&' || ch === '\n') {
      segments.push(current)
      current = ''
      continue
    }
    current += ch
  }
  segments.push(current)
  return segments.map((s) => s.trim()).filter((s) => s.length > 0)
}

/** Extract the bodies of command substitutions: `$(...)` and backtick spans. */
function extractSubstitutions(command: string): string[] {
  const found: string[] = []
  // $( ... ) with simple nesting support.
  const dollar = /\$\(([^)]*)\)/g
  let m: RegExpExecArray | null
  while ((m = dollar.exec(command)) !== null) {
    if (m[1].trim()) found.push(m[1])
  }
  const backtick = /`([^`]*)`/g
  while ((m = backtick.exec(command)) !== null) {
    if (m[1].trim()) found.push(m[1])
  }
  return found
}

/** Classify a SINGLE command segment by its primary token. No separator handling here. */
function analyzeSegment(segment: string): CommandSafetyVerdict {
  const lower = segment.toLowerCase()
  const tokens = tokenizeCommand(segment)
  const idx = primaryTokenIndex(tokens)
  const primary = (tokens[idx] || '').replace(/.*\//, '') // strip any path prefix
  const rest = tokens.slice(idx + 1)

  // Always-destructive primaries.
  const HARD_DANGEROUS = new Set(['mkfs', 'dd', 'shutdown', 'reboot', 'halt', 'poweroff'])
  if (HARD_DANGEROUS.has(primary)) {
    return { level: 'dangerous', reason: `Destructive command: ${primary}.` }
  }

  // rm: dangerous only when recursive+force AND aimed at a sensitive target; otherwise approval.
  if (primary === 'rm') {
    const flags = rest.filter((t) => t.startsWith('-')).join('')
    const recursive = /r/.test(flags)
    const force = /f/.test(flags)
    const targets = rest.filter((t) => !t.startsWith('-'))
    if (recursive && force && targets.some(isDangerousRmTarget)) {
      return {
        level: 'dangerous',
        reason: 'rm -rf targeting a sensitive or out-of-workspace path.'
      }
    }
    return { level: 'requires_approval', reason: 'File deletion.' }
  }

  // eval of arbitrary content.
  if (primary === 'eval') {
    return { level: 'dangerous', reason: 'eval of arbitrary input.' }
  }

  // find ... -delete / -exec rm.
  if (primary === 'find' && (/\b-delete\b/.test(lower) || /-exec\s+rm\b/.test(lower))) {
    return { level: 'requires_approval', reason: 'find with deletion side effects.' }
  }

  // Obviously read-only commands.
  const READ_ONLY = new Set([
    'ls',
    'cat',
    'echo',
    'pwd',
    'whoami',
    'head',
    'tail',
    'grep',
    'find',
    'wc',
    'stat',
    'date',
    'which',
    'env',
    'printenv',
    'true',
    'false',
    // Windows read-only equivalents
    'type',
    'findstr',
    'where',
    'dir',
    'ipconfig',
    'ping',
    'hostname',
    'systeminfo',
    'tasklist'
  ])
  if (READ_ONLY.has(primary)) {
    return { level: 'safe' }
  }

  // Anything else that mutates is unknown — default to asking.
  return { level: 'requires_approval', reason: `Unrecognized command: ${primary || 'unknown'}.` }
}

/**
 * Classify a shell command. Conservative by design: clearly destructive forms are `dangerous`,
 * unknown-but-mutating forms are `requires_approval`, and obviously read-only forms are `safe`.
 *
 * A command line may chain several commands with `;` `&&` `||` `|` or embed command
 * substitutions. Each independently-executed part is classified and the STRICTEST verdict wins,
 * so a benign-looking prefix (e.g. `git log`) cannot smuggle a destructive tail (`&& rm -rf ~`)
 * past the guard.
 */
export function analyzeCommand(command: string): CommandSafetyVerdict {
  if (typeof command !== 'string' || command.trim() === '') {
    return { level: 'requires_approval', reason: 'Empty command.' }
  }

  // Null bytes are never valid shell input here and commonly indicate injection / obfuscation.
  if (command.includes('\0')) {
    return { level: 'dangerous', reason: 'Command contains a null byte.' }
  }

  const lower = command.toLowerCase()

  // Piping remote content straight into a shell (spans a pipe, so check the whole line first).
  if (/\b(curl|wget)\b[^|]*\|\s*(sudo\s+)?(sh|bash|zsh|fish|dash)\b/.test(lower)) {
    return { level: 'dangerous', reason: 'Pipes remote content into a shell.' }
  }

  // Fork bomb.
  if (/:\(\)\s*\{\s*:\s*\|\s*:\s*&\s*\}\s*;\s*:/.test(command.replace(/\s+/g, ' '))) {
    return { level: 'dangerous', reason: 'Fork bomb pattern.' }
  }

  // Classify each chained segment and each command substitution; the strictest verdict wins.
  let verdict: CommandSafetyVerdict = { level: 'safe' }
  const segments = splitCommandSegments(command)
  for (const seg of segments) {
    verdict = stricterVerdict(verdict, analyzeSegment(seg))
  }
  for (const sub of extractSubstitutions(command)) {
    verdict = stricterVerdict(verdict, analyzeCommand(sub))
  }
  return verdict
}
