import type { Project, ProjectKind } from './types'

export const CONVERSATION_FOLDER_PATH_PREFIX = 'quickai-folder://'

export function getProjectKind(project: Pick<Project, 'kind'>): ProjectKind {
  return project.kind === 'folder' ? 'folder' : 'filesystem'
}

export function isConversationFolder(project: Pick<Project, 'kind'>): boolean {
  return getProjectKind(project) === 'folder'
}

export function isFilesystemProject(project: Pick<Project, 'kind' | 'path'>): boolean {
  return getProjectKind(project) === 'filesystem' && Boolean(project.path?.trim())
}

export function getFilesystemProjectPath(
  project: Pick<Project, 'kind' | 'path'>
): string | undefined {
  return isFilesystemProject(project) ? project.path : undefined
}

/** Stable unique DB path for conversation folders (keeps the legacy UNIQUE NOT NULL column). */
export function toPersistedProjectPath(project: Project): string {
  if (isConversationFolder(project)) {
    return `${CONVERSATION_FOLDER_PATH_PREFIX}${project.id}`
  }
  const path = project.path?.trim()
  if (!path) {
    throw new Error(`Filesystem project ${project.id} is missing a path`)
  }
  return path
}

export function fromPersistedProjectRow(row: {
  id: string
  name: string
  path: string
  kind?: string | null
  createdAt: number
  updatedAt: number
}): Project {
  const kind: ProjectKind =
    row.kind === 'folder' || row.path.startsWith(CONVERSATION_FOLDER_PATH_PREFIX)
      ? 'folder'
      : 'filesystem'

  if (kind === 'folder') {
    return {
      id: row.id,
      name: row.name,
      kind: 'folder',
      createdAt: row.createdAt,
      updatedAt: row.updatedAt
    }
  }

  return {
    id: row.id,
    name: row.name,
    kind: 'filesystem',
    path: row.path,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt
  }
}
