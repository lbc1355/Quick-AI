#!/usr/bin/env node
/**
 * Guard the design-token layer.
 *
 * The stylesheets grew through several redesign passes, and each pass added its own `:root`
 * palette. At one point three generations were stacked: 92 of themes.css's 98 token declarations
 * were silently dead because a later import redefined them. Editing them looked like it should
 * work and did nothing — which is how the light theme drifted away from the palette.
 *
 * This check keeps that from coming back:
 *   1. Only design-tokens.css may declare global `--color-*` / `--spacing-*` / `--rounded-*`.
 *      Component-scoped custom properties (on a class selector) are fine.
 *   2. Every token referenced with var() must be declared somewhere.
 *   3. Every declared token must be referenced (dead tokens are reported, not fatal).
 *
 * Run: npm run lint:css-tokens
 */
import { readFileSync, readdirSync, statSync } from 'fs'
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'

const RENDERER = join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'renderer', 'src')
const ASSETS = join(RENDERER, 'assets')

/** Components read tokens from inline styles too, so usage must be scanned beyond the CSS. */
const sourceFiles = []
const pending = [RENDERER]
while (pending.length > 0) {
  const dir = pending.pop()
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) pending.push(full)
    else if (/\.(tsx?|css)$/.test(entry)) sourceFiles.push(full)
  }
}
const TOKEN_SOURCE = 'design-tokens.css'
const GLOBAL_SCOPES = new Set([':root', '.app-container.theme-light'])
/** Scaffold tokens from the electron-vite template; they only feed base.css itself. */
const EXEMPT_FILES = new Set(['base.css'])

const files = readdirSync(ASSETS).filter((f) => f.endsWith('.css'))
const errors = []
const warnings = []
const declared = new Set()
const referenced = new Set()
/** Tokens only ever read as `var(--x, fallback)` — a deliberate hook, not a missing declaration. */
const optional = new Set()
const required = new Set()

// Usage is collected across the whole renderer; declarations only from the stylesheets.
for (const full of sourceFiles) {
  for (const m of readFileSync(full, 'utf8').matchAll(/var\(\s*(--[a-z0-9-]+)\s*(,?)/g)) {
    referenced.add(m[1])
    ;(m[2] === ',' ? optional : required).add(m[1])
  }
}

for (const file of files) {
  const src = readFileSync(join(ASSETS, file), 'utf8')

  for (const rule of src.matchAll(/(^|\n)([^\n{}]+)\{([^{}]*)\}/g)) {
    const selector = rule[2].trim()
    const tokens = [...rule[3].matchAll(/(--[a-z0-9-]+)\s*:/g)].map((d) => d[1])
    if (tokens.length === 0) continue

    const isGlobal = GLOBAL_SCOPES.has(selector)
    if (isGlobal) tokens.forEach((t) => declared.add(t))

    if (file === TOKEN_SOURCE || EXEMPT_FILES.has(file)) {
      if (!isGlobal && file === TOKEN_SOURCE) {
        errors.push(`${file}: 令牌应定义在全局作用域，而不是 "${selector}"`)
      }
      continue
    }
    if (isGlobal) {
      const line = src.slice(0, rule.index).split('\n').length + 1
      errors.push(
        `${file}:${line} 在 "${selector}" 中定义了 ${tokens.length} 个全局令牌` +
          ` (${tokens.slice(0, 3).join(', ')}${tokens.length > 3 ? ', …' : ''})。` +
          ` 全局令牌只能定义在 ${TOKEN_SOURCE}，否则会被导入顺序静默覆盖。`
      )
    }
  }
}

for (const token of required) {
  if (declared.has(token) || token.startsWith('--ev-')) continue
  // Component-scoped properties are declared on their own selector; only flag palette-looking ones.
  if (!/^--(color|spacing|rounded)-/.test(token)) continue
  errors.push(
    `引用了未定义的令牌 var(${token})，该声明会被浏览器丢弃。` +
      ` 若是有意的可选钩子，请写成 var(${token}, <兜底值>)。`
  )
}
for (const token of declared) {
  if (!referenced.has(token) && !token.startsWith('--ev-')) warnings.push(token)
}

if (warnings.length) {
  console.log(`⚠️  ${warnings.length} 个已定义但从未被引用的令牌（不影响构建，可择机清理）:`)
  console.log(`   ${warnings.join(', ')}\n`)
}
if (optional.size) {
  console.log(`ℹ️  ${optional.size} 个带兜底值的可选令牌: ${[...optional].join(', ')}\n`)
}
if (errors.length) {
  console.error(`❌ CSS 令牌层检查失败 (${errors.length} 项):`)
  errors.forEach((e) => console.error(`   ${e}`))
  process.exit(1)
}
console.log(`✅ CSS 令牌层正常：${declared.size} 个全局令牌，全部定义在 ${TOKEN_SOURCE}`)
