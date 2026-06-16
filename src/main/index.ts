import {
  app,
  shell,
  BrowserWindow,
  ipcMain,
  globalShortcut,
  Tray,
  Menu,
  screen,
  dialog
} from 'electron'
import { basename, join } from 'path'
import { realpathSync } from 'fs'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import icon from '../../resources/icon.png?asset'
import { FileStore } from './store'
import type { StorageSchema, WindowMode, WindowState } from '../shared/types'
import { handleChatCompletion, fetchModels, abortChatCompletion } from './aiClient'
import { runAgentSkill, runGeneralAgent, resolveToolPermission, abortAgentSkill } from './agent'
import { deleteActionLog, ActionLog, getActionLogPath } from './agent/actionLog'
import {
  copyRunCheckpointsForRuns,
  deleteRunCheckpoint,
  deleteRunCheckpoints
} from './agent/runCheckpoint'
import { copyRunManifestsForRuns, deleteRunManifest, deleteRunManifests } from './agent/runManifest'
import { deleteResourceFile } from './resourceCache'
import { showDesktopNotification } from './tools/helpers'
import { clearSessionApprovals } from './agent/AgentRunContext'
import {
  ensureMemoryLibrary,
  listMemoryEntries,
  readMemoryEntry,
  writeMemoryEntry
} from './memory/memoryStore'
import { logger } from './logger'
import { McpManager } from './mcpManager'
import { registerHtmlRenderer } from './webRenderer'
import { ensureSystemSkills, watchSkillFolders } from './skillManager'

let mainWindow: BrowserWindow | null = null
let tray: Tray | null = null
let store: FileStore | null = null
let stopSkillWatcher: (() => void) | null = null
let isWindowVisible = false
let isFilePickerActive = false
let isQuitting = false
let isWindowPinned = false
let windowMode: WindowMode = 'floating'
const floatingWinWidth = 780
const floatingWinHeight = 520
const windowModeDefaultWidth = 1080
const windowModeDefaultHeight = 720
const hiddenX = -9999
const hiddenY = -9999
let windowModeBounds: { x: number; y: number; width: number; height: number } | null = null

function getCenteredBounds(
  width: number,
  height: number
): {
  x: number
  y: number
  width: number
  height: number
} {
  const { workArea } = screen.getPrimaryDisplay()
  const boundedWidth = Math.min(width, workArea.width)
  const boundedHeight = Math.min(height, workArea.height)
  return {
    x: workArea.x + Math.round((workArea.width - boundedWidth) / 2),
    y: workArea.y + Math.round((workArea.height - boundedHeight) / 2),
    width: boundedWidth,
    height: boundedHeight
  }
}

function getCurrentWindowState(): WindowState {
  return {
    mode: windowMode,
    isMaximized: Boolean(mainWindow?.isMaximized())
  }
}

function emitWindowState(): void {
  if (!mainWindow || mainWindow.isDestroyed()) return
  mainWindow.webContents.send('window-state-changed', getCurrentWindowState())
}

function createWindow(): void {
  // Position initially off-screen to avoid any visual flicker or animation on start
  const x = hiddenX
  const y = hiddenY

  // Create the browser window.
  mainWindow = new BrowserWindow({
    width: floatingWinWidth,
    height: floatingWinHeight,
    x,
    y,
    show: false,
    frame: false, // Borderless
    thickFrame: true,
    transparent: true, // Transparent for glassmorphic borders
    resizable: false,
    minimizable: true,
    maximizable: true,
    alwaysOnTop: true, // Always float on top
    skipTaskbar: true, // Do not display in taskbar
    hasShadow: false,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false
    }
  })
  mainWindow.setOpacity(0)

  // Disable default native menu bar
  mainWindow.setMenuBarVisibility(false)

  // Focus-loss auto-hide behavior
  mainWindow.on('blur', () => {
    if (windowMode === 'window') return
    if (isFilePickerActive || isWindowPinned) return
    if (store) {
      const autoHide = store.get('settings').autoHideOnBlur
      if (autoHide && mainWindow && isWindowVisible) {
        hideWindow()
      }
    }
  })

  // Reset file picker active state when focus returns to the window
  mainWindow.on('focus', () => {
    // Reset file picker active state after a short delay to ignore trailing blur events from the OS dialog closing transition
    setTimeout(() => {
      isFilePickerActive = false
    }, 300)
  })

  // Prevent window from being destroyed on close (e.g. Alt+F4) and hide instead
  mainWindow.on('close', (event) => {
    if (isQuitting) return
    event.preventDefault()
    hideWindow()
  })

  mainWindow.on('maximize', emitWindowState)
  mainWindow.on('unmaximize', emitWindowState)
  mainWindow.on('restore', () => {
    isWindowVisible = true
    emitWindowState()
  })
  mainWindow.on('minimize', () => {
    if (windowMode === 'window') {
      isWindowVisible = false
    }
    emitWindowState()
  })

  mainWindow.on('closed', () => {
    mainWindow = null
  })

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  // HMR for renderer base on electron-vite cli.
  // Load the remote URL for development or the local html file for production.
  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }

  // Pre-paint the window off-screen so shortcut summon only repositions it.
  // Calling show()/hide() on every toggle triggers the native Windows easing animation.
  mainWindow.once('ready-to-show', () => {
    mainWindow?.setPosition(hiddenX, hiddenY)
    mainWindow?.showInactive()
    emitWindowState()
  })
}

function showWindow(): void {
  if (!mainWindow) return

  if (windowMode === 'window') {
    isWindowVisible = true
    mainWindow.setOpacity(1)
    if (!mainWindow.isVisible()) {
      mainWindow.show()
    }
    if (mainWindow.isMinimized()) {
      mainWindow.restore()
    }
    mainWindow.focus()
    mainWindow.webContents.send('window-shown')
    emitWindowState()
    return
  }

  // Recenter horizontally to account for screen configuration changes
  const { width, height } = screen.getPrimaryDisplay().workAreaSize
  const x = Math.round((width - floatingWinWidth) / 2)
  const y = Math.round(height * 0.15) // Spotlight upper center placement

  isWindowVisible = true
  mainWindow.setOpacity(0)
  mainWindow.setBounds({ x, y, width: floatingWinWidth, height: floatingWinHeight })

  setTimeout(() => {
    if (!mainWindow || !isWindowVisible) return
    mainWindow.setOpacity(1)
    mainWindow.focus()

    // Notify frontend that the window has been summoned/shown
    mainWindow.webContents.send('window-shown')
    emitWindowState()
  }, 16)
}

function hideWindow(): void {
  if (!mainWindow) return
  isWindowVisible = false

  if (windowMode === 'window') {
    if (!mainWindow.isMinimized() && !mainWindow.isMaximized()) {
      windowModeBounds = mainWindow.getBounds()
    }
    mainWindow.hide()
    emitWindowState()
    return
  }

  mainWindow.setOpacity(0)
  mainWindow.setPosition(hiddenX, hiddenY)
  mainWindow.blur()
  emitWindowState()
}

function toggleWindow(): void {
  if (!mainWindow) return
  if (isWindowVisible) {
    hideWindow()
  } else {
    showWindow()
  }
}

function setWindowMode(mode: WindowMode): WindowState {
  if (!mainWindow) return getCurrentWindowState()
  if (windowMode === mode) return getCurrentWindowState()

  if (windowMode === 'window' && !mainWindow.isMinimized() && !mainWindow.isMaximized()) {
    windowModeBounds = mainWindow.getBounds()
  }

  windowMode = mode
  isWindowPinned = false

  if (mode === 'window') {
    const bounds =
      windowModeBounds || getCenteredBounds(windowModeDefaultWidth, windowModeDefaultHeight)
    mainWindow.setAlwaysOnTop(false)
    mainWindow.setSkipTaskbar(false)
    mainWindow.setMinimumSize(floatingWinWidth, floatingWinHeight)
    mainWindow.setResizable(true)
    mainWindow.setMaximizable(true)
    mainWindow.setMinimizable(true)
    mainWindow.setOpacity(1)
    if (mainWindow.isMaximized()) {
      mainWindow.unmaximize()
    }
    mainWindow.setBounds(bounds)
    isWindowVisible = true
    mainWindow.show()
    mainWindow.focus()
    mainWindow.webContents.send('window-shown')
  } else {
    if (mainWindow.isMaximized()) {
      mainWindow.unmaximize()
    }
    if (mainWindow.isMinimized()) {
      mainWindow.restore()
    }
    mainWindow.setResizable(false)
    mainWindow.setAlwaysOnTop(true)
    mainWindow.setSkipTaskbar(true)
    showWindow()
  }

  emitWindowState()
  return getCurrentWindowState()
}

function minimizeWindow(): void {
  if (!mainWindow) return
  if (windowMode === 'window') {
    mainWindow.minimize()
  } else {
    hideWindow()
  }
}

function toggleWindowMaximized(): void {
  if (!mainWindow || windowMode !== 'window') return
  if (mainWindow.isMaximized()) {
    mainWindow.unmaximize()
  } else {
    if (!mainWindow.isMinimized()) {
      windowModeBounds = mainWindow.getBounds()
    }
    mainWindow.maximize()
  }
  emitWindowState()
}

function broadcastSkillsUpdated(skills?: StorageSchema['skills']): void {
  const nextSkills = skills || (store?.get('skills') as StorageSchema['skills']) || []
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) {
      win.webContents.send('skills-updated', nextSkills)
    }
  }
}

function createTray(): void {
  // Use the asset icon
  tray = new Tray(icon)
  const contextMenu = Menu.buildFromTemplate([
    {
      label: '显示 / 隐藏 (Alt+/)',
      click: () => toggleWindow()
    },
    { type: 'separator' },
    {
      label: '关于 QuickAI',
      click: () => {
        shell.openExternal('https://github.com')
      }
    },
    {
      label: '退出 QuickAI',
      click: () => {
        isQuitting = true
        app.quit()
      }
    }
  ])
  tray.setToolTip('QuickAI - 快捷AI沟通工具')
  tray.setContextMenu(contextMenu)

  // Single click on tray toggles the window
  tray.on('click', () => {
    toggleWindow()
  })
}

function registerGlobalShortcut(): void {
  // Register Alt+/ shortcut
  const registered = globalShortcut.register('Alt+/', () => {
    toggleWindow()
  })

  if (!registered) {
    logger.error('Shortcut', 'Failed to register global shortcut Alt+/')
  } else {
    logger.info('Shortcut', 'Successfully registered global shortcut Alt+/')
  }
}

// This method will be called when Electron has finished
// initialization and is ready to create browser windows.
app.whenReady().then(() => {
  logger.info('System', 'QuickAI App initializing...')
  // Initialize storage
  store = new FileStore()

  // Wire the headless JS-page renderer into the web tools (enables fetch_url JS rendering).
  registerHtmlRenderer()

  ensureSystemSkills()

  stopSkillWatcher = watchSkillFolders((skills) => {
    broadcastSkillsUpdated(skills)
  })

  // Initialize MCP Manager
  McpManager.init()

  // Seed the on-disk Markdown memory library (~/.quickai/memories) and its git repo.
  ensureMemoryLibrary().catch((err) =>
    logger.warn('Memory', 'Failed to initialize memory library:', (err as Error).message)
  )

  // Set app user model id for windows
  electronApp.setAppUserModelId('com.quickai')

  // Register shortcut watches
  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  // IPC handlers for FileStore with security whitelist
  const ALLOWED_STORE_KEYS = ['sessions', 'settings', 'skills', 'projects']

  // MCP IPC handlers
  ipcMain.handle('mcp-get-config', () => {
    return McpManager.readConfigRaw()
  })

  ipcMain.handle('mcp-set-config', (_event, content) => {
    const merged = McpManager.writeConfigRaw(content)
    McpManager.reload().catch((err) => {
      logger.error('MCP', `Error reloading after config write: ${err.message}`)
    })
    return merged
  })

  ipcMain.handle('mcp-get-status', () => {
    return McpManager.getStatuses()
  })

  ipcMain.handle('mcp-open-config', () => {
    McpManager.openConfigFolder()
  })

  ipcMain.handle('store-get', (_event, key) => {
    if (typeof key !== 'string' || !ALLOWED_STORE_KEYS.includes(key)) {
      throw new Error(`Forbidden store-get key: ${key}`)
    }
    const storeKey = key as keyof StorageSchema
    return store?.get(storeKey)
  })

  ipcMain.handle('store-set', (_event, key, value) => {
    if (typeof key !== 'string' || !ALLOWED_STORE_KEYS.includes(key)) {
      throw new Error(`Forbidden store-set key: ${key}`)
    }
    const storeKey = key as keyof StorageSchema
    store?.set(storeKey, value as StorageSchema[typeof storeKey])
    if (storeKey === 'skills') {
      broadcastSkillsUpdated(store?.get('skills') as StorageSchema['skills'])
    }
    return true
  })

  ipcMain.handle('get-app-info', () => {
    return {
      storePath: store?.getStorePath() || '',
      version: '1.0.0'
    }
  })

  ipcMain.handle('select-project-directory', async () => {
    if (!mainWindow) return null
    isFilePickerActive = true
    try {
      const result = await dialog.showOpenDialog(mainWindow, {
        title: '选择项目文件夹',
        properties: ['openDirectory']
      })
      if (result.canceled || result.filePaths.length === 0) return null
      const selectedPath = realpathSync.native(result.filePaths[0])
      return {
        path: selectedPath,
        name: basename(selectedPath)
      }
    } finally {
      setTimeout(() => {
        isFilePickerActive = false
      }, 300)
    }
  })

  // Delete a session's on-disk caches (action log + orphaned resource files). Best-effort:
  // the renderer decides which resource ids are safe to remove (no surviving session references
  // them); this handler just deletes what it's told and never throws.
  ipcMain.handle('clear-session-caches', async (_event, payload) => {
    const sessionIds: string[] = Array.isArray(payload?.sessionIds)
      ? payload.sessionIds.filter((id: unknown): id is string => typeof id === 'string')
      : []
    const resourceIds: string[] = Array.isArray(payload?.resourceIds)
      ? payload.resourceIds.filter((id: unknown): id is string => typeof id === 'string')
      : []

    // Partial action-log cleanup for surviving sessions (edit/regenerate): delete only the records
    // of the removed runs, not the whole file. Done synchronously before the async deletes below.
    const partialActions: Array<{ sessionId: string; runIds: string[] }> = Array.isArray(
      payload?.partialActions
    )
      ? payload.partialActions.filter(
          (e: unknown): e is { sessionId: string; runIds: string[] } =>
            !!e &&
            typeof (e as { sessionId?: unknown }).sessionId === 'string' &&
            Array.isArray((e as { runIds?: unknown }).runIds)
        )
      : []
    for (const entry of partialActions) {
      const runIds = entry.runIds.filter((id): id is string => typeof id === 'string')
      if (runIds.length === 0) continue
      try {
        new ActionLog(getActionLogPath(entry.sessionId)).deleteByRunIds(runIds)
        await Promise.all(runIds.map((runId) => deleteRunCheckpoint(entry.sessionId, runId)))
        await Promise.all(runIds.map((runId) => deleteRunManifest(entry.sessionId, runId)))
      } catch (err) {
        console.warn('clear-session-caches: partial action delete failed:', (err as Error).message)
      }
    }

    for (const id of sessionIds) {
      // Drop any "allow for this task" approvals so a reused session id never inherits stale grants.
      clearSessionApprovals(id)
    }

    const results = await Promise.allSettled([
      ...sessionIds.map((id) => deleteActionLog(id)),
      ...sessionIds.map((id) => deleteRunCheckpoints(id)),
      ...sessionIds.map((id) => deleteRunManifests(id)),
      ...resourceIds.map((id) => deleteResourceFile(id))
    ])
    for (const r of results) {
      if (r.status === 'rejected') {
        console.warn('clear-session-caches: a cache delete failed:', r.reason)
      }
    }
    return { ok: true }
  })

  ipcMain.handle('fork-session-caches', async (_event, payload) => {
    const sourceSessionId =
      typeof payload?.sourceSessionId === 'string' ? payload.sourceSessionId : ''
    const targetSessionId =
      typeof payload?.targetSessionId === 'string' ? payload.targetSessionId : ''
    const runIds: string[] = Array.isArray(payload?.runIds)
      ? payload.runIds.filter((id: unknown): id is string => typeof id === 'string')
      : []

    if (!sourceSessionId || !targetSessionId || sourceSessionId === targetSessionId) {
      return { ok: true, actions: 0, checkpoints: 0, manifests: 0 }
    }

    try {
      const sourceLog = new ActionLog(getActionLogPath(sourceSessionId))
      const targetLog = new ActionLog(getActionLogPath(targetSessionId))
      const actions = sourceLog.copyByRunIdsTo(targetLog, runIds)
      const checkpoints = copyRunCheckpointsForRuns(sourceSessionId, targetSessionId, runIds)
      const manifests = copyRunManifestsForRuns(sourceSessionId, targetSessionId, runIds)
      return { ok: true, actions, checkpoints, manifests }
    } catch (err) {
      console.warn('fork-session-caches failed:', (err as Error).message)
      return { ok: false, actions: 0, checkpoints: 0, manifests: 0 }
    }
  })

  ipcMain.handle('fetch-models', (_event, fetchUrl, apiKey) => {
    return fetchModels(fetchUrl, apiKey)
  })

  ipcMain.handle('memory-entries', () => {
    return listMemoryEntries()
  })

  ipcMain.handle('memory-entry-read', (_event, id) => {
    return typeof id === 'string' ? readMemoryEntry(id) : ''
  })

  ipcMain.handle('memory-entry-write', async (_event, id, content) => {
    if (typeof id !== 'string' || typeof content !== 'string') {
      throw new Error('memory-entry-write requires string id and content')
    }
    await writeMemoryEntry(id, content)
    return { ok: true }
  })

  // IPC handlers for window control
  ipcMain.on('hide-window', () => {
    hideWindow()
  })

  ipcMain.handle('get-window-state', () => getCurrentWindowState())

  ipcMain.handle('set-window-mode', (_event, mode: WindowMode) => {
    if (mode !== 'floating' && mode !== 'window') {
      throw new Error(`Invalid window mode: ${String(mode)}`)
    }
    return setWindowMode(mode)
  })

  ipcMain.on('minimize-window', () => {
    minimizeWindow()
  })

  ipcMain.on('toggle-window-maximized', () => {
    toggleWindowMaximized()
  })

  ipcMain.on('set-file-picker-active', (_event, active) => {
    isFilePickerActive = active
  })

  ipcMain.on('set-window-pinned', (_event, pinned) => {
    isWindowPinned = pinned === true
  })

  ipcMain.on('re-summon-window', () => {
    if (mainWindow) {
      showWindow()
    }
  })

  ipcMain.on('toggle-devtools', () => {
    if (mainWindow) {
      if (mainWindow.webContents.isDevToolsOpened()) {
        mainWindow.webContents.closeDevTools()
      } else {
        mainWindow.webContents.openDevTools({ mode: 'detach' })
      }
    }
  })

  ipcMain.on('show-notification', (_event, title: string, body: string) => {
    showDesktopNotification(String(title || 'QuickAI'), String(body || ''), () => {
      if (mainWindow && !mainWindow.isDestroyed()) showWindow()
    })
  })

  ipcMain.on('start-chat-completion', (event, reqId, options) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    if (win && store) {
      const permissions = store.get('settings').permissions
      if (options.runMode === 'agent') {
        const systemPrompt = store.get('settings').systemPrompt
        runGeneralAgent(win, reqId, { ...options, systemPrompt }, permissions)
      } else {
        handleChatCompletion(win, reqId, options)
      }
    }
  })

  ipcMain.on('start-agent-skill', (event, reqId, options) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    if (win && store) {
      const permissions = store.get('settings').permissions
      runAgentSkill(win, reqId, options, permissions)
    }
  })

  ipcMain.on('respond-tool-permission', (_event, reqId, callId, approved) => {
    resolveToolPermission(reqId, callId, approved)
  })

  ipcMain.on('abort-generation', (_event, reqId) => {
    abortChatCompletion(reqId)
    abortAgentSkill(reqId)
  })

  createWindow()
  createTray()
  registerGlobalShortcut()

  app.on('activate', function () {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow()
    }
  })
})

app.on('before-quit', () => {
  isQuitting = true
})

// Clean up global shortcuts and MCP processes when app closes
app.on('will-quit', () => {
  stopSkillWatcher?.()
  stopSkillWatcher = null
  globalShortcut.unregisterAll()
  McpManager.shutdown().catch((err) => {
    logger.error('MCP', `Error shutting down MCP: ${err.message}`)
  })
})

// Prevent app from quitting when window is closed unless explicit exit
// uTools keeps running in system tray.
app.on('window-all-closed', () => {
  // Do nothing. The app lives in the system tray.
})
