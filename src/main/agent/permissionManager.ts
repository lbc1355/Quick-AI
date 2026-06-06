interface PendingPermissionPromise {
  resolve: (approved: boolean) => void
  reject: (err: Error) => void
  timeoutId: NodeJS.Timeout
}

export class PermissionManager {
  private pending = new Map<string, PendingPermissionPromise>()

  async requestPermission(
    reqId: string,
    callId: string,
    timeoutMs = 10 * 60 * 1000
  ): Promise<boolean> {
    const key = `${reqId}:${callId}`
    return new Promise<boolean>((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        this.pending.delete(key)
        reject(new Error('Permission request timed out after 10 minutes.'))
      }, timeoutMs)

      this.pending.set(key, { resolve, reject, timeoutId })
    })
  }

  resolve(reqId: string, callId: string, approved: boolean): void {
    const key = `${reqId}:${callId}`
    const p = this.pending.get(key)
    if (p) {
      clearTimeout(p.timeoutId)
      this.pending.delete(key)
      p.resolve(approved)
    }
  }

  cleanupForRun(reqId: string): void {
    const prefix = `${reqId}:`
    for (const [key, p] of this.pending.entries()) {
      if (key.startsWith(prefix)) {
        clearTimeout(p.timeoutId)
        this.pending.delete(key)
        p.reject(new Error('Agent run terminated or aborted.'))
      }
    }
  }
}

export const globalPermissionManager = new PermissionManager()
