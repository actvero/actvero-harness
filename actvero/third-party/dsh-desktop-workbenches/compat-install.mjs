import { MarketInstallError } from './market-install.mjs'

/** Keep package mutation within the baseline Plugin Manager's supported options. */
export async function installCompatibleBundle(manager, spec, name, options = {}) {
  const existing = (await manager.listBundles()).some(bundle => bundle.name === name && bundle.installed)
  if (existing) {
    throw new MarketInstallError(
      options.replace
        ? '当前客户端暂不支持直接覆盖更新工作台。请先在插件管理中卸载原插件，再安装；已有会话和业务文件会保留。'
        : '这个工作台已安装。请先使用已有工作台，或明确选择更新。',
      409,
    )
  }
  const { replace: _replace, ...supported } = options
  return manager.installBundle(spec, supported)
}
