export function normalizeSkillResourcePath(value: string): string {
  return value.replace(/\\/g, '/').replace(/^\/+/, '').trim()
}
