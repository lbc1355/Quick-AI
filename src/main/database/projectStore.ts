import { DeleteProjectResult, Project } from '../../shared/types'
import {
  fromPersistedProjectRow,
  getProjectKind,
  toPersistedProjectPath
} from '../../shared/projectHelpers'
import { getDb } from './connection'
import { deleteSessionScopedRows } from './sessionStore'

export function loadProjects(): Project[] {
  const database = getDb()
  const rows = database
    .prepare(
      'SELECT id, name, path, kind, createdAt, updatedAt FROM projects ORDER BY updatedAt DESC'
    )
    .all() as Array<{
    id: string
    name: string
    path: string
    kind?: string | null
    createdAt: number
    updatedAt: number
  }>
  return rows.map(fromPersistedProjectRow)
}

export function saveProjects(projects: Project[]): void {
  const database = getDb()
  const insertProject = database.prepare(
    `INSERT INTO projects (id, name, path, kind, createdAt, updatedAt)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       name = excluded.name,
       path = excluded.path,
       kind = excluded.kind,
       createdAt = excluded.createdAt,
       updatedAt = excluded.updatedAt`
  )
  const deleteProject = database.prepare('DELETE FROM projects WHERE id = ?')

  const persist = database.transaction((projectList: Project[]) => {
    const nextIds = new Set(projectList.map((project) => project.id))
    const existing = database.prepare('SELECT id FROM projects').all() as Array<{ id: string }>
    for (const project of projectList) {
      insertProject.run(
        project.id,
        project.name,
        toPersistedProjectPath(project),
        getProjectKind(project),
        project.createdAt,
        project.updatedAt
      )
    }
    for (const row of existing) {
      if (!nextIds.has(row.id)) {
        deleteProject.run(row.id)
      }
    }
  })
  persist(projects)
}

/**
 * Delete a project and optionally the persisted conversations inside a conversation folder.
 *
 * This is intentionally a targeted database operation rather than two renderer-owned snapshots:
 * deleting the sessions and project in one transaction prevents a restart from exposing a
 * half-applied destructive action. Filesystem projects never delete their conversations.
 */
export function deleteProject(
  projectId: string,
  deleteContainedSessions: boolean
): DeleteProjectResult {
  const database = getDb()
  const remove = database.transaction((id: string, deleteSessions: boolean) => {
    const project = database.prepare('SELECT kind FROM projects WHERE id = ?').get(id) as
      | { kind: string }
      | undefined
    if (!project) return { deletedSessionIds: [] }

    const shouldDeleteSessions = deleteSessions && project.kind === 'folder'
    const relatedRows = shouldDeleteSessions
      ? (database.prepare('SELECT id FROM sessions WHERE projectId = ?').all(id) as Array<{
          id: string
        }>)
      : []

    if (shouldDeleteSessions) {
      database.prepare('DELETE FROM sessions WHERE projectId = ?').run(id)
      // session_prompt_inbox / background_jobs have no FK cascade — clean them up explicitly.
      for (const row of relatedRows) {
        deleteSessionScopedRows(database, row.id)
      }
    }
    database.prepare('DELETE FROM projects WHERE id = ?').run(id)

    return { deletedSessionIds: relatedRows.map((row) => row.id) }
  })

  return remove(projectId, deleteContainedSessions)
}
