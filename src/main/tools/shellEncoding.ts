import { execFileSync } from 'child_process'

const WINDOWS_CODE_PAGE_ENCODINGS: Record<string, string> = {
  '65001': 'utf-8',
  '936': 'gbk',
  '54936': 'gb18030',
  '950': 'big5',
  '932': 'shift_jis',
  '949': 'euc-kr',
  '874': 'windows-874',
  '1250': 'windows-1250',
  '1251': 'windows-1251',
  '1252': 'windows-1252',
  '1253': 'windows-1253',
  '1254': 'windows-1254',
  '1255': 'windows-1255',
  '1256': 'windows-1256',
  '1257': 'windows-1257',
  '1258': 'windows-1258'
}

let cachedShellFallbackEncoding: string | undefined

function decodeBuffer(buffer: Buffer, encoding: string): string {
  try {
    return new TextDecoder(encoding).decode(buffer)
  } catch {
    return buffer.toString('utf8')
  }
}

function countReplacementChars(value: string): number {
  return (value.match(/\uFFFD/g) || []).length
}

export function getShellFallbackEncoding(): string {
  if (process.platform !== 'win32') return 'utf-8'
  if (cachedShellFallbackEncoding) return cachedShellFallbackEncoding

  try {
    const output = execFileSync('cmd.exe', ['/d', '/c', 'chcp'], {
      encoding: 'utf8',
      windowsHide: true,
      timeout: 2000
    })
    const codePage = output.match(/(\d+)/)?.[1]
    cachedShellFallbackEncoding = codePage ? WINDOWS_CODE_PAGE_ENCODINGS[codePage] || 'gbk' : 'gbk'
  } catch {
    cachedShellFallbackEncoding = 'gbk'
  }

  return cachedShellFallbackEncoding
}

export function decodeShellOutputForDisplay(
  output: string | Buffer,
  fallbackEncoding = getShellFallbackEncoding()
): string {
  if (typeof output === 'string') return output
  if (output.length === 0) return ''

  const utf8Text = decodeBuffer(output, 'utf-8')
  const utf8ReplacementCount = countReplacementChars(utf8Text)
  if (utf8ReplacementCount === 0 || fallbackEncoding.toLowerCase() === 'utf-8') {
    return utf8Text
  }

  const fallbackText = decodeBuffer(output, fallbackEncoding)
  return countReplacementChars(fallbackText) <= utf8ReplacementCount ? fallbackText : utf8Text
}
