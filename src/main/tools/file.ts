import { ToolDefinition } from './types'
import { fileDiffTool } from './fileDiff'
import { fileSearchTools } from './fileSearch'
import { codeSymbolTool } from './codeSymbolTool'
import { fileReadTool } from './fileReadTool'
import { imageReadTool } from './imageReadTool'
import { fileWriteTool } from './fileWriteTool'
import { fileEditTool } from './fileEditTool'
import { multiEditTool } from './multiEditTool'
import { directoryCreateTool } from './directoryCreateTool'
import { fileCopyTool } from './fileCopyTool'
import { fileMoveTool } from './fileMoveTool'
import { fileDeleteTool } from './fileDeleteTool'

export const fileTools: Record<string, ToolDefinition> = {
  file_read: fileReadTool,
  image_read: imageReadTool,
  code_symbol_read: codeSymbolTool,
  file_write: fileWriteTool,
  file_edit: fileEditTool,
  multi_edit: multiEditTool,
  directory_create: directoryCreateTool,
  file_copy: fileCopyTool,
  file_move: fileMoveTool,
  file_delete: fileDeleteTool,
  ...fileSearchTools,
  file_diff: fileDiffTool
}
