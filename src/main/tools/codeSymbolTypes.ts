import type { FileRootKind } from './filePathSafety'

export interface SymbolMatch {
  realPath: string
  relPath: string
  root: string
  rootKind: FileRootKind
  lineIndex: number
  lineNumber: number
  lineText: string
  kind: string
}
