import { app, shell, BrowserWindow, globalShortcut, Tray, Menu, screen } from 'electron'
import { join } from 'path'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import icon from '../../resources/icon.png?asset'
import { FileStore } from './store'
import type { StorageSchema, WindowMode, WindowState } from '../shared/types'
import { ensureMemoryLibrary } from './memory/memoryStore'
import { logger } from './logger'
import { McpManager } from './mcpManager'
import { registerHtmlRenderer } from './webRenderer'
import { ensureSystemSkills, watchSkillFolders } from './skillManager'
import { runAgentFileSnapshotMaintenance } from './agent/agentFileSnapshot'
import { configureBackgroundJobPersistence } from './agent/backgroundJobManager'
import {
  getBackgroundJobRecord,
  listBackgroundJobRecords,
  pruneBackgroundJobRecords,
  saveBackgroundJob
} from './database'

// IPC handlers
import { registerStoreIpc } from './ipc/storeIpc'
import { registerMcpIpc } from './ipc/mcpIpc'
import { registerMemoryIpc } from './ipc/memoryIpc'
import { registerCacheIpc } from './ipc/cacheIpc'
import { registerGenerationIpc } from './ipc/generationIpc'
import { registerWindowIpc } from './ipc/windowIpc'
import { registerProjectIpc } from './ipc/projectIpc'
import { registerBackgroundJobIpc } from './ipc/backgroundJobIpc'

let mainWindow: BrowserWindow | null = null
let tray: Tray | null = null
let store: FileStore | null = null
let stopSkillWatcher: (() => void) | null = null
let snapshotMaintenanceTimeout: NodeJS.Timeout | null = null
let snapshotMaintenanceInterval: NodeJS.Timeout | null = null
let isWindowVisible = false
let isFilePickerActive = false
let isQuitting = false
let isWindowPinned = false
let windowMode: WindowMode = 'window'
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
  // Floating mode starts off-screen so shortcut summon can position it without flicker.
  // Window mode should behave like a regular app window from startup.
  const initialBounds =
    windowMode === 'window'
      ? getCenteredBounds(windowModeDefaultWidth, windowModeDefaultHeight)
      : { x: hiddenX, y: hiddenY, width: floatingWinWidth, height: floatingWinHeight }

  // Create the browser window.
  mainWindow = new BrowserWindow({
    width: initialBounds.width,
    height: initialBounds.height,
    x: initialBounds.x,
    y: initialBounds.y,
    show: false,
    frame: false, // Borderless
    thickFrame: true,
    transparent: true, // Transparent for glassmorphic borders
    resizable: windowMode === 'window',
    minimizable: true,
    maximizable: true,
    alwaysOnTop: windowMode !== 'window', // Floating mode stays above other apps.
    skipTaskbar: windowMode !== 'window',
    hasShadow: false,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false
    }
  })
  mainWindow.setOpacity(windowMode === 'window' ? 1 : 0)
  if (windowMode === 'window') {
    mainWindow.setMinimumSize(floatingWinWidth, floatingWinHeight)
    windowModeBounds = initialBounds
  }

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
    if (windowMode === 'window') {
      isWindowVisible = true
      mainWindow?.show()
      mainWindow?.focus()
      mainWindow?.webContents.send('window-shown')
      emitWindowState()
      return
    }

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

function maintainAgentFileSnapshots(): void {
  void runAgentFileSnapshotMaintenance()
    .then((result) => {
      logger.info(
        'Snapshots',
        `Maintenance completed: ${result.repositories} repositories, ${result.protectedRefs} protected refs, ${result.deletedRefs} stale refs removed, ${result.errors} errors.`
      )
    })
    .catch((error) => {
      logger.warn('Snapshots', 'Maintenance failed:', (error as Error).message)
    })
}

// This method will be called when Electron has finished
// initialization and is ready to create browser windows.
app.whenReady().then(() => {
  logger.info('System', 'QuickAI App initializing...')
  // Initialize storage
  store = new FileStore()
  configureBackgroundJobPersistence({
    get: getBackgroundJobRecord,
    list: listBackgroundJobRecords,
    save: saveBackgroundJob,
    prune: pruneBackgroundJobRecords
  })

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

  if (store) {
    registerStoreIpc(store, (skills) => {
      broadcastSkillsUpdated(skills)
    })
    registerGenerationIpc(store)
  }

  registerMcpIpc()
  registerMemoryIpc()
  registerCacheIpc()

  const windowController = {
    hideWindow,
    showWindow,
    minimizeWindow,
    toggleWindowMaximized,
    getCurrentWindowState,
    setWindowMode,
    setFilePickerActive: (active: boolean) => {
      isFilePickerActive = active
    },
    setWindowPinned: (pinned: boolean) => {
      isWindowPinned = pinned
    },
    toggleDevTools: () => {
      if (mainWindow) {
        if (mainWindow.webContents.isDevToolsOpened()) {
          mainWindow.webContents.closeDevTools()
        } else {
          mainWindow.webContents.openDevTools({ mode: 'detach' })
        }
      }
    },
    reSummonWindow: () => {
      if (mainWindow) {
        showWindow()
      }
    },
    getMainWindow: () => mainWindow
  }

  registerWindowIpc(windowController)
  registerProjectIpc(windowController)
  registerBackgroundJobIpc()

  snapshotMaintenanceTimeout = setTimeout(maintainAgentFileSnapshots, 30_000)
  snapshotMaintenanceTimeout.unref()
  snapshotMaintenanceInterval = setInterval(maintainAgentFileSnapshots, 24 * 60 * 60 * 1000)
  snapshotMaintenanceInterval.unref()

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
  if (snapshotMaintenanceTimeout) clearTimeout(snapshotMaintenanceTimeout)
  if (snapshotMaintenanceInterval) clearInterval(snapshotMaintenanceInterval)
  snapshotMaintenanceTimeout = null
  snapshotMaintenanceInterval = null
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
