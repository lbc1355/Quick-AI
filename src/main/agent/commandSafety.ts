/**
 * Pure argument-safety primitives, ported from CodeWhale's command_safety / execpolicy ideas.
 *
 * Everything here is side-effect free (no fs, no electron) so it is trivially testable and can run
 * before a tool is dispatched. Two concerns:
 *   - pathEscapesWorkspace: lexical containment check that needs no filesystem access.
 *   - analyzeCommand: token-level danger classification for shell-style commands. The guiding
 *     principle (borrowed from Codex/CodeWhale) is restraint: only flag genuinely destructive
 *     actions as `dangerous`, so everyday commands don't drown the user in approval prompts.
 */

export type CommandSafetyLevel = 'safe' | 'requires_approval' | 'dangerous'

export interface CommandSafetyVerdict {
  level: CommandSafetyLevel
  reason?: string
}

/**
 * Does `inputPath`, interpreted relative to a workspace root, lexically escape that root —
 * without touching the filesystem? Absolute paths, home references, and `..` traversal that
 * climbs above the root all count as escapes. `foo..bar` (a literal name) does not.
 */
export function pathEscapesWorkspace(inputPath: string): boolean {
  if (typeof inputPath !== 'string' || inputPath.length === 0) return false

  const normalized = inputPath.replace(/\\/g, '/').trim()

  // Home-relative or environment-variable expansions resolve outside a fixed workspace root.
  if (normalized.startsWith('~')) return true
  if (/\$(HOME|USERPROFILE)\b/.test(normalized) || /%USERPROFILE%/i.test(normalized)) return true

  // Absolute paths bypass the root entirely: POSIX "/...", Windows drive "C:/..." or UNC "//host".
  if (normalized.startsWith('/')) return true
  if (/^[a-zA-Z]:\//.test(normalized)) return true

  // Walk the relative components, tracking depth below the root.
  let depth = 0
  for (const segment of normalized.split('/')) {
    if (segment === '' || segment === '.') continue
    if (segment === '..') {
      depth -= 1
      if (depth < 0) return true
    } else {
      depth += 1
    }
  }
  return false
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

/**
 * Classify a shell command. Conservative by design: clearly destructive forms are `dangerous`,
 * unknown-but-mutating forms are `requires_approval`, and obviously read-only forms are `safe`.
 */
export function analyzeCommand(command: string): CommandSafetyVerdict {
  if (typeof command !== 'string' || command.trim() === '') {
    return { level: 'requires_approval', reason: 'Empty command.' }
  }

  // Null bytes and multi-line commands are a strong smell of injection / obfuscation.
  if (command.includes('\0')) {
    return { level: 'dangerous', reason: 'Command contains a null byte.' }
  }
  if (/\r?\n/.test(command.trim())) {
    return { level: 'dangerous', reason: 'Multi-line command.' }
  }

  const lower = command.toLowerCase()

  // Piping remote content straight into a shell.
  if (/\b(curl|wget)\b[^|]*\|\s*(sudo\s+)?(sh|bash|zsh|fish|dash)\b/.test(lower)) {
    return { level: 'dangerous', reason: 'Pipes remote content into a shell.' }
  }

  // Fork bomb.
  if (/:\(\)\s*\{\s*:\s*\|\s*:\s*&\s*\}\s*;\s*:/.test(command.replace(/\s+/g, ' '))) {
    return { level: 'dangerous', reason: 'Fork bomb pattern.' }
  }

  const tokens = tokenizeCommand(command)
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
    'false'
  ])
  if (READ_ONLY.has(primary)) {
    return { level: 'safe' }
  }

  // Anything else that mutates is unknown — default to asking.
  return { level: 'requires_approval', reason: `Unrecognized command: ${primary || 'unknown'}.` }
}
