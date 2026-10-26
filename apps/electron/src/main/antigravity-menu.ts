import { dialog, shell, type MenuItemConstructorOptions } from 'electron'
import { i18n } from '@craft-agent/shared/i18n'
import { getDefaultLlmConnection, getWorkspaces } from '@craft-agent/shared/config'
import { loadWorkspaceConfig } from '@craft-agent/shared/workspaces'
import { ANTIGRAVITY_SLUG, initializeAntigravityService, getAntigravityStatus, startAntigravityLogin, cancelAntigravityLogin, refreshAntigravityModels, disconnectAntigravity } from '@craft-agent/server-core/services'
import { NativeAntigravityController, type NativeAntigravityStatus } from './antigravity-controller'

let controller: NativeAntigravityController | undefined

export function bindAntigravityMenuHost(host: {
  sessionManager: { getSessions(): Array<{ workspaceId?: string; llmConnection?: string; isProcessing?: boolean }>; refreshConnectionRuntime(slug: string): Promise<void> }
  onConnectionsChanged(): void
  onMenuChanged(): void
}): void {
  controller?.dispose()
  initializeAntigravityService()
  const t = (key: string, options?: Record<string, unknown>) => String(i18n.t(`settings.ai.antigravity.${key}`, options))
  const showStatus = async (status: NativeAntigravityStatus) => {
    const message = status.error === 'catalog_unavailable' ? t('catalogUnavailable')
      : status.state === 'connected' ? t('connected', { count: status.modelCount ?? 0 })
      : status.state === 'connecting' ? t('connecting')
      : status.state === 'error' ? t('operationFailed') : t('disconnected')
    await dialog.showMessageBox({ type: status.error || status.state === 'error' ? 'warning' : 'info', title: 'Antigravity', message,
      detail: `${t('note')}\n${i18n.t('menu.antigravity.selectModel')}` })
  }
  controller = new NativeAntigravityController({
    getStatus: getAntigravityStatus, startLogin: startAntigravityLogin, cancelLogin: cancelAntigravityLogin,
    refreshModels: refreshAntigravityModels, disconnect: disconnectAntigravity,
  }, {
    isConnectionInUse: () => {
      const defaultSlug = getDefaultLlmConnection()
      const workspaces = getWorkspaces()
      return host.sessionManager.getSessions().some(session => {
        if (!session.isProcessing) return false
        const workspace = workspaces.find(w => w.id === session.workspaceId)
        const inherited = workspace ? loadWorkspaceConfig(workspace.rootPath)?.defaults?.defaultLlmConnection : undefined
        return (session.llmConnection ?? inherited ?? defaultSlug) === ANTIGRAVITY_SLUG
      })
    },
    connectionChanged: async () => {
      await host.sessionManager.refreshConnectionRuntime(ANTIGRAVITY_SLUG)
      host.onConnectionsChanged()
    },
  }, {
    openExternal: async url => { await shell.openExternal(url) }, showStatus,
    showFailure: async code => {
      await dialog.showMessageBox({ type: 'warning', title: 'Antigravity', message: code === 'connection_in_use' ? t('connectionInUse') : code === 'catalog_unavailable' ? t('catalogUnavailable') : t('operationFailed'), detail: t('note') })
    },
    confirmDisconnect: async () => (await dialog.showMessageBox({ type: 'question', title: 'Antigravity', message: t('disconnectConfirm'), buttons: [t('disconnect'), String(i18n.t('menu.antigravity.cancel'))], defaultId: 1, cancelId: 1 })).response === 0,
    changed: host.onMenuChanged, wait: ms => new Promise(resolve => setTimeout(resolve, ms)),
  })
  void controller.readStatus()
  host.onMenuChanged()
}

/** Only adds native menu entries; the frozen renderer/preload remain untouched. */
export function getAntigravityMenuItems(): MenuItemConstructorOptions[] {
  const c = controller
  const t = (key: string) => String(i18n.t(`settings.ai.antigravity.${key}`))
  return [
    { label: String(i18n.t('menu.antigravity.status')), enabled: !!c, click: () => { void c?.readStatus(true) } },
    { type: 'separator' },
    { label: t(c?.status.state === 'connected' ? 'reconnect' : 'connect'), enabled: !!c && !c.busy, click: () => { void c?.connect() } },
    { label: String(i18n.t('menu.antigravity.cancel')), enabled: !!c && c.loginActive, click: () => { void c?.cancel() } },
    { label: t('refresh'), enabled: !!c && !c.busy && c.status.state === 'connected', click: () => { void c?.refreshModels() } },
    { type: 'separator' },
    { label: t('disconnect'), enabled: !!c && !c.busy && c.status.state === 'connected', click: () => { void c?.disconnect() } },
  ]
}
export function disposeAntigravityMenu(): void { controller?.dispose(); controller = undefined }
