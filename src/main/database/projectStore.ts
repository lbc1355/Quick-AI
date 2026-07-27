import { Project } from '../../shared/types'
import { fromPersistedProjectRow, getProjectKind, toPersistedProjectPath } from '../../shared/projectHelpers'
import { getDb } from './connection'

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
