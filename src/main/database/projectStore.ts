import { Project } from '../../shared/types'
import { getDb } from './connection'

export function loadProjects(): Project[] {
  const database = getDb()
  const rows = database
    .prepare('SELECT id, name, path, createdAt, updatedAt FROM projects ORDER BY updatedAt DESC')
    .all() as Project[]
  return rows
}

export function saveProjects(projects: Project[]): void {
  const database = getDb()
  const insertProject = database.prepare(
    `INSERT INTO projects (id, name, path, createdAt, updatedAt)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       name = excluded.name,
       path = excluded.path,
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
        project.path,
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
