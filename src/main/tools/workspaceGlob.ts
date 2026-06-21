export function globToRegex(globPattern: string): RegExp {
  const GLOBSTAR = '__GLOBSTAR__'
  let pattern = globPattern.replace(/\*\*/g, GLOBSTAR)
  pattern = pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&')
  pattern = pattern.replace(/\*/g, '[^/]*')
  pattern = pattern.replace(/\?/g, '[^/]')
  pattern = pattern.replace(new RegExp(GLOBSTAR + '/', 'g'), '(?:.*/)?')
  pattern = pattern.replace(new RegExp(GLOBSTAR, 'g'), '.*')
  return new RegExp(
    globPattern.includes('/') ? '^' + pattern + '$' : '/' + pattern + '$|' + '^' + pattern + '$',
    'i'
  )
}
