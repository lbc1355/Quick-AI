import { statSync } from 'node:fs'
import { join, resolve } from 'node:path'
import asar from '@electron/asar'

const archive = resolve(process.argv[2] || 'dist/win-unpacked/resources/app.asar')
const files = asar.listPackage(archive).map((file) => file.replaceAll('\\', '/').replace(/^\//, ''))
const allowedRoots = new Set(['out', 'resources', 'node_modules', 'package.json'])
const unexpected = files.filter((file) => !allowedRoots.has(file.split('/')[0]))
if (unexpected.length > 0) {
  throw new Error(`应用包包含非运行时文件：${unexpected.slice(0, 12).join(', ')}`)
}

const metadata = JSON.parse(asar.extractFile(archive, 'package.json').toString('utf8'))
const main = metadata.main.replace(/^\.\//, '').replaceAll('\\', '/')
for (const required of [main, 'out/preload/index.js', 'out/renderer/index.html']) {
  if (!files.includes(required)) throw new Error(`应用包缺少运行入口：${required}`)
}
const sqlite = files.find((file) => file.endsWith('/better_sqlite3.node'))
if (!sqlite) throw new Error('应用包缺少 SQLite 原生模块')
const nativePath = join(...sqlite.split('/'))
if (asar.statFile(archive, nativePath).unpacked) {
  statSync(join(`${archive}.unpacked`, nativePath))
}
console.log(
  `应用包检查通过：${files.length} 个条目，仅包含运行时文件，入口和 SQLite 原生模块完整。`
)
