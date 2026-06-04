import { app, shell, BrowserWindow, ipcMain, globalShortcut, Tray, Menu, screen } from 'electron'
import { join } from 'path'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import icon from '../../resources/icon.png?asset'
import { FileStore } from './store'

let mainWindow: BrowserWindow | null = null
let tray: Tray | null = null
let store: FileStore | null = null
let isWindowVisible = false
let isFilePickerActive = false

function createWindow(): void {
  const winWidth = 780
  const winHeight = 520
  // Position initially off-screen to avoid any visual flicker or animation on start
  const x = -9999
  const y = -9999

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
    hasShadow: true,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false
    }
  })

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

  // Once window is ready, show it off-screen inactive so that it paints, but does not grab focus or show to user
  mainWindow.once('ready-to-show', () => {
    if (mainWindow) {
      mainWindow.showInactive()
    }
  })
}

function showWindow(): void {
  if (!mainWindow) return

  // Recenter horizontally to account for screen configuration changes
  const { width, height } = screen.getPrimaryDisplay().workAreaSize
  const winWidth = 780
  const x = Math.round((width - winWidth) / 2)
  const y = Math.round(height * 0.15) // Spotlight upper center placement

  mainWindow.setPosition(x, y)
  mainWindow.focus()
  isWindowVisible = true
  
  // Notify frontend that the window has been summoned/shown
  mainWindow.webContents.send('window-shown')
}

function hideWindow(): void {
  if (!mainWindow) return
  mainWindow.setPosition(-9999, -9999)
  mainWindow.blur()
  isWindowVisible = false
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

  // IPC handlers for FileStore
  ipcMain.handle('store-get', (_event, key) => {
    return store?.get(key)
  })

  ipcMain.handle('store-set', (_event, key, value) => {
    store?.set(key, value)
    return true
  })

  ipcMain.handle('get-app-info', () => {
    return {
      storePath: store?.getStorePath() || '',
      version: '1.0.0'
    }
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

