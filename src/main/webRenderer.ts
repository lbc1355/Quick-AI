import { BrowserWindow } from 'electron'
import { HtmlRenderResult, setHtmlRenderer } from './webTools'

// ── Headless JS page renderer ────────────────────────────────────────────────
// Renders JavaScript-heavy / SPA pages that the raw-HTTP fetch path cannot read by loading them
// in an offscreen, sandboxed BrowserWindow and returning the post-render outerHTML. This is wired
// into webTools.ts via setHtmlRenderer so webTools itself stays electron-free and unit-testable.
//
// Safety notes:
//  - The window is offscreen (show:false), JS enabled but node integration OFF, context isolated.
//  - We block obvious credential leakage by using a throwaway in-memory-ish session partition.
//  - SSRF: the static path already validates public URLs; the renderer is only invoked for URLs
//    that have already passed validation in webTools (final/resolved URLs), and we additionally
//    reject non-http(s) here.

const RENDER_TIMEOUT_MS = 15000

const renderHtml = async (url: string, signal?: AbortSignal): Promise<HtmlRenderResult> => {
  const parsed = new URL(url)
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error('Only http/https URLs can be rendered')
  }

  if (signal?.aborted) throw new Error('Render aborted by user.')

  const win = new BrowserWindow({
    show: false,
    width: 1280,
    height: 900,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      javascript: true,
      images: false,
      webgl: false,
      partition: 'webrender-ephemeral'
    }
  })

  let finished = false
  const cleanup = (): void => {
    if (!win.isDestroyed()) win.destroy()
  }

  try {
    return await new Promise<HtmlRenderResult>((resolvePromise, reject) => {
      const onAbort = (): void => {
        if (finished) return
        finished = true
        reject(new Error('Render aborted by user.'))
      }
      if (signal) {
        if (signal.aborted) return onAbort()
        signal.addEventListener('abort', onAbort, { once: true })
      }

      const timer = setTimeout(() => {
        if (finished) return
        finished = true
        // Even on timeout, try to grab whatever rendered so far.
        win.webContents
          .executeJavaScript('document.documentElement.outerHTML', true)
          .then((html: string) =>
            resolvePromise({ finalUrl: win.webContents.getURL() || url, html: html || '' })
          )
          .catch(() => reject(new Error(`Render timed out after ${RENDER_TIMEOUT_MS}ms`)))
      }, RENDER_TIMEOUT_MS)

      const capture = (): void => {
        if (finished) return
        // Give late-arriving XHR/fetch-driven content a brief settle window.
        setTimeout(() => {
          if (finished) return
          win.webContents
            .executeJavaScript('document.documentElement.outerHTML', true)
            .then((html: string) => {
              if (finished) return
              finished = true
              clearTimeout(timer)
              resolvePromise({ finalUrl: win.webContents.getURL() || url, html: html || '' })
            })
            .catch((err) => {
              if (finished) return
              finished = true
              clearTimeout(timer)
              reject(err)
            })
        }, 600)
      }

      win.webContents.on('did-finish-load', capture)
      win.webContents.on('did-fail-load', (_e, errorCode, errorDescription) => {
        if (finished) return
        // did-fail-load also fires for sub-resource failures; ignore aborted (-3).
        if (errorCode === -3) return
        finished = true
        clearTimeout(timer)
        reject(new Error(`Failed to load page: ${errorDescription} (${errorCode})`))
      })

      win.loadURL(url).catch((err) => {
        if (finished) return
        finished = true
        clearTimeout(timer)
        reject(err)
      })
    })
  } finally {
    cleanup()
  }
}

/** Register the headless renderer with webTools. Call once during main-process startup. */
export const registerHtmlRenderer = (): void => {
  setHtmlRenderer(renderHtml)
}
