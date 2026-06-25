import { ToolDefinition } from './types'
import { fileDiffTool } from './fileDiff'
import { codeSymbolTool } from './codeSymbolTool'
import { fileReadTool } from './fileReadTool'
import { imageReadTool } from './imageReadTool'
import { pdfReadTool } from './pdfReadTool'
import { fileWriteTool } from './fileWriteTool'
import { fileEditTool } from './fileEditTool'
import { multiEditTool } from './multiEditTool'
import { directoryCreateTool } from './directoryCreateTool'
import { fileCopyTool } from './fileCopyTool'
import { fileMoveTool } from './fileMoveTool'
import { fileDeleteTool } from './fileDeleteTool'
import { workspaceSearchTool } from './workspaceSearchTool'
import { workspaceListFilesTool } from './workspaceListFilesTool'
import { workspaceAddRootTool } from './workspaceAddRootTool'

export const fileTools: Record<string, ToolDefinition> = {
  file_read: fileReadTool,
  image_read: imageReadTool,
  pdf_read: pdfReadTool,
  code_symbol_read: codeSymbolTool,
  file_write: fileWriteTool,
  file_edit: fileEditTool,
  multi_edit: multiEditTool,
  directory_create: directoryCreateTool,
  file_copy: fileCopyTool,
  file_move: fileMoveTool,
  file_delete: fileDeleteTool,
  workspace_search: workspaceSearchTool,
  workspace_list_files: workspaceListFilesTool,
  workspace_add_root: workspaceAddRootTool,
  file_diff: fileDiffTool
}
