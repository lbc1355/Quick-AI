import { app, shell, BrowserWindow, ipcMain, globalShortcut, Tray, Menu, screen } from 'electron'
import { join } from 'path'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import icon from '../../resources/icon.png?asset'
import { FileStore } from './store'
import { StorageSchema } from '../shared/types'
import { handleChatCompletion, fetchModels, abortChatCompletion } from './aiClient'
import { runAgentSkill, resolveToolPermission, abortAgentSkill } from './agentRunner'

let mainWindow: BrowserWindow | null = null
let tray: Tray | null = null
let store: FileStore | null = null
let isWindowVisible = false
let isFilePickerActive = false
const winWidth = 780
const winHeight = 520
const hiddenX = -9999
const hiddenY = -9999

function createWindow(): void {
  // Position initially off-screen to avoid any visual flicker or animation on start
  const x = hiddenX
  const y = hiddenY

  // Create the browser window.
  mainWindow = new BrowserWindow({
    width: winWidth,
    height: winHeight,
    x,
    y,
    show: false,
    frame: false, // Borderless
    thickFrame: false, // Disables standard window resizing, native window shadow and DWM animations on Windows
    transparent: true, // Transparent for glassmorphic borders
    resizable: false,
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
    if (isFilePickerActive) return
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
    event.preventDefault()
    hideWindow()
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
  })
}

function showWindow(): void {
  if (!mainWindow) return

  // Recenter horizontally to account for screen configuration changes
  const { width, height } = screen.getPrimaryDisplay().workAreaSize
  const x = Math.round((width - winWidth) / 2)
  const y = Math.round(height * 0.15) // Spotlight upper center placement

  isWindowVisible = true
  mainWindow.setOpacity(0)
  mainWindow.setBounds({ x, y, width: winWidth, height: winHeight })

  setTimeout(() => {
    if (!mainWindow || !isWindowVisible) return
    mainWindow.setOpacity(1)
    mainWindow.focus()

    // Notify frontend that the window has been summoned/shown
    mainWindow.webContents.send('window-shown')
  }, 16)
}

function hideWindow(): void {
  if (!mainWindow) return
  isWindowVisible = false
  mainWindow.setOpacity(0)
  mainWindow.setPosition(hiddenX, hiddenY)
  mainWindow.blur()
}

function toggleWindow(): void {
  if (!mainWindow) return
  if (isWindowVisible) {
    hideWindow()
  } else {
    showWindow()
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
    console.error('Failed to register global shortcut Alt+/')
  }
}

// This method will be called when Electron has finished
// initialization and is ready to create browser windows.
app.whenReady().then(() => {
  // Initialize storage
  store = new FileStore()

  // Set app user model id for windows
  electronApp.setAppUserModelId('com.quickai')

  // Register shortcut watches
  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  // IPC handlers for FileStore with security whitelist
  const ALLOWED_STORE_KEYS = ['sessions', 'settings', 'skills', 'memories']

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
    return true
  })

  ipcMain.handle('get-app-info', () => {
    return {
      storePath: store?.getStorePath() || '',
      version: '1.0.0'
    }
  })

  ipcMain.handle('fetch-models', (_event, fetchUrl, apiKey) => {
    return fetchModels(fetchUrl, apiKey)
  })

  // IPC handlers for window control
  ipcMain.on('hide-window', () => {
    hideWindow()
  })

  ipcMain.on('set-file-picker-active', (_event, active) => {
    isFilePickerActive = active
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

  ipcMain.on('start-chat-completion', (event, reqId, options) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    if (win) {
      handleChatCompletion(win, reqId, options)
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

// Clean up global shortcuts when app closes
app.on('will-quit', () => {
  globalShortcut.unregisterAll()
})

// Prevent app from quitting when window is closed unless explicit exit
// uTools keeps running in system tray.
app.on('window-all-closed', () => {
  // Do nothing. The app lives in the system tray.
})
