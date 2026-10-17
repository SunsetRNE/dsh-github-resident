/**
 * views/SettingsPage.js — 配置页（TPL 表 + 设置，5.9）真源 ESM，build 拼回 src/client/index.js leaf
 *
 * 合并改造（2026-10-11）：页面拆成「头 + 两个可复用分区」。
 *   - 两个分区（工作区总览 / 诊断日志）与「设置 → 仓库登记库」页里嵌入的是**同一份组件**，
 *     由 panelAssembly.js 的 mergeEmbed 交出去；两处入口共用同一个 store 与同一批宿主电话，
 *     不新增第二套设置状态，也不复制持久化逻辑。
 *     （1.8.2 删掉第三个分区「作者其他插件」：那是 Deck 上游作者的插件清单，与「常驻 GitHub 身份」
 *      这件事无关；一并删掉 4 条写死外链、5 个语言键（中英各 5）与两处挂载点。）
 *   - 更新入口只有一份（Deck 半边的 views/UpdateEntryHost.js），落点在「仓库登记库」页的状态区；
 *     本页不再挂第二个按钮，只留一句去向说明（cfg.updateInRegistry）。
 */
// #155 Q1 改：只读全局总览（wf.bindings + workspaces.list + wf.registry 色值，不可改；不调 wf.bind）
// 数据装载与跳转收进 views/SettingsWorkspaces.js 的 useWsOverview（纯结构搬移，行为零变化）。
export const DeckWorkspacesSection = function () {
  const cx = React.useContext(DswsCtx)
  const h = cx ? cx.h : React.createElement
  const sharedSt = cx ? cx.storeSvc.useStore() : useStore()
  const [foldVer, setFoldVer] = React.useState(0)
  const overview = useWsOverview(cx, sharedSt)
  return renderWsOverview(h, sharedSt, overview.wsOverview, overview.loadRef, foldVer, setFoldVer)
}

// #492 调试分组（布局文案沿 #334 原型：主开关默认关，写经 wf.logSetSwitch，对账以宿主为准，保存即广播；
//   四键调宿主三电话加复用目录电话）。合并后与登记库页共存：本组是一个 dbgBusy 禁全组，
//   与 Resident 页「每个动作一个 tag、只禁自己」的 busy 各管各的，互不禁用。
export const DeckDiagnosticsSection = function () {
  const cx = React.useContext(DswsCtx)
  const h = cx ? cx.h : React.createElement
  // T5 修订：订阅 store（设置页独立于面板 dock，需自己订阅 shared 才能渲染 flash toast）
  const sharedSt = cx ? cx.storeSvc.useStore() : useStore()
  // #492调试分组：开关秒显宿主值，经 wf.logSetSwitch 写宿主，底座广播刷新；四键走宿主电话
  const [dbgPending, setDbgPending] = React.useState(false)
  const [dbgBusy, setDbgBusy] = React.useState(null)
  const [clearAsked, setClearAsked] = React.useState(false)
  // #951：开关落定后行内闪光（成功绿跟提示 ok 同色，失败琥珀跟提示 warn 同色，半秒自退）
  const [dbgFlash, setDbgFlash] = React.useState('')
  const [lastExport, setLastExport] = React.useState(null)
  const dbgChecked = (function () {
    try { if (typeof logSwitch !== 'undefined' && logSwitch) return logSwitch.enabled === true } catch (eDbg) {}
    try { return !!readLocalDebugSwitch().enabled } catch (eDbg2) { return false }
  })()
  const hostReady = function () { try { return !!(typeof host !== 'undefined' && host && host.call) } catch (eDbg) { return false } }
  const todayName = function () { try { const d = new Date(); const p = function (n) { return String(n).padStart(2, '0') }; return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) } catch (eDbg) { return '' } }
  const dirOfExport = function (res) { try { const d = res && res.summary && res.summary.header && res.summary.header.dir ? String(res.summary.header.dir) : ''; return d ? (d.replace(/\/+$/, '') + '/logs') : '' } catch (eDbg) { return '' } }
  const rememberExport = function (res) { try { setLastExport({ dir: dirOfExport(res), fileName: res.fileName || '', fallback: res.fallback === true }) } catch (eDbg) {} }
  const guardOp = function () {
    if (dbgBusy) return false
    if (!hostReady()) { flash(sharedSt, tr('err.hostUnavailable'), 'warn'); return false }
    return true
  }
  const toggleDbg = function (e) {
    if (dbgPending || !guardOp()) return
    const next = !!(e && e.target && e.target.checked)
    setDbgPending(true)
    try {
      if (typeof setLogSwitch !== 'function') throw new Error('no-switch')
      setLogSwitch(next, 1).then(function (res) {
        setDbgPending(false)
        const okSw = !!(res && res.ok)
        setDbgFlash(okSw ? 'ok' : 'warn')
        try { setTimeout(function () { setDbgFlash('') }, 600) } catch (eT) {}
        flash(sharedSt, tr(!okSw ? dbgSwitchFailKey(res) : ((res.enabled === true) ? 'cfg.dbgSwitchOnToast' : 'cfg.dbgSwitchOffToast')), okSw ? 'ok' : 'warn')
      }).catch(function () { setDbgPending(false); setDbgFlash('warn'); try { setTimeout(function () { setDbgFlash('') }, 600) } catch (eT2) {}; flash(sharedSt, tr('cfg.dbgSwitchFail'), 'warn') })
    } catch (errDbg) { setDbgPending(false); flash(sharedSt, tr('cfg.dbgSwitchFail'), 'warn') }
  }
  // 静默取导出结果解析目录位置并缓存，不刷提示，供打开与复制复用
  const resolveLogDir = function () {
    if (lastExport && lastExport.dir) { try { log('info', 'host.call', { method: 'wf.logExport', latencyMs: 0, ok: true, kind: 'log-resolve-cache' }) } catch (eL) {} return Promise.resolve(lastExport.dir) }
    const t0 = Date.now()
    if (!hostReady()) { try { log('warn', 'host.call.fail', { method: 'wf.logExport', kind: 'log-resolve', errorHash: dswsLogHash(dswsLogTrunc('host-unavailable', 120, 'error')) }) } catch (eL) {}; return Promise.resolve('') }
    try {
      return host.call('wf.logExport', { format: 'zip' }).then(function (res) {
        if (!res || res.ok !== true) { try { log('warn', 'host.call.fail', { method: 'wf.logExport', kind: 'log-resolve', errorHash: dswsLogHash(dswsLogTrunc('export-not-ok', 120, 'error')) }) } catch (eL) {}; try { if (typeof logExportFail === 'function') logExportFail('resolve', 'export-not-ok', (res && res.error) || 'not-ok') } catch (eDbg2) {} return '' }
        rememberExport(res)
        const _dir = dirOfExport(res)
        try { log('info', 'host.call', { method: 'wf.logExport', latencyMs: Date.now() - t0, ok: !!_dir, kind: 'log-resolve' }) } catch (eL) {}
        if (!_dir) { try { log('warn', 'host.call.fail', { method: 'wf.logExport', kind: 'log-resolve', errorHash: dswsLogHash(dswsLogTrunc('path-missing', 120, 'error')) }) } catch (eL) {}; try { if (typeof logExportFail === 'function') logExportFail('resolve', 'path-missing', 'path-missing') } catch (eDbg2) {} }
        return _dir
      }).catch(function (e) { try { log('warn', 'host.call.fail', { method: 'wf.logExport', kind: 'log-resolve', errorHash: dswsLogHash(dswsLogTrunc(String((e && e.message) || e), 120, 'error')) }) } catch (eL) {}; try { if (typeof logExportFail === 'function') logExportFail('resolve', 'export-not-ok', e) } catch (eDbg2) {}; return '' })
    } catch (eDbg) { try { log('warn', 'host.call.fail', { method: 'wf.logExport', kind: 'log-resolve', errorHash: dswsLogHash(dswsLogTrunc(String((eDbg && eDbg.message) || eDbg), 120, 'error')) }) } catch (eL) {}; return Promise.resolve('') }
  }
  const doExport = function () {
    if (!guardOp()) return
    setDbgBusy('export')
    try {
      host.call('wf.logExport', { format: 'zip' }).then(function (res) {
        setDbgBusy(null)
        if (!res || res.ok !== true) { try { log('warn', 'host.call.fail', { method: 'wf.logExport', kind: 'export', errorHash: dswsLogHash(dswsLogTrunc('export-not-ok', 120, 'error')) }) } catch (eL) {}; try { if (typeof logExportFail === 'function') logExportFail('export', 'export-not-ok', (res && res.error) || 'not-ok') } catch (eDbg2) {} flash(sharedSt, tr('cfg.dbgExportFail'), 'warn'); return }
        rememberExport(res)
        let msg = tr('cfg.dbgExportOk', { file: String(res.fileName || '') })
        if (res.fallback === true) msg = msg + ' ' + tr('cfg.dbgExportFallback')
        flash(sharedSt, msg, 'ok')
      }).catch(function (e) { try { log('warn', 'host.call.fail', { method: 'wf.logExport', kind: 'export', errorHash: dswsLogHash(dswsLogTrunc(String((e && e.message) || e), 120, 'error')) }) } catch (eL) {}; setDbgBusy(null); try { if (typeof logExportFail === 'function') logExportFail('export', 'export-not-ok', e) } catch (eDbg2) {} flash(sharedSt, tr('cfg.dbgExportFail'), 'warn') })
    } catch (eDbg) { setDbgBusy(null); flash(sharedSt, tr('cfg.dbgExportFail'), 'warn') }
  }
  const doOpen = function () {
    if (!guardOp()) return
    setDbgBusy('open')
    resolveLogDir().then(function (dir) {
      if (!dir) { setDbgBusy(null); try { if (typeof logExportFail === 'function') logExportFail('openDir', 'path-missing', 'path-missing') } catch (eDbg2) {} flash(sharedSt, tr('cfg.dbgExportFail'), 'warn'); return }
      try {
        host.call('wf.openFolder', { cwd: dir }).then(function (res) {
          setDbgBusy(null)
          const okOpen = !!(res && res.ok === true)
          if (!okOpen) { try { log('warn', 'host.call.fail', { method: 'wf.openFolder', kind: 'open-path', errorHash: dswsLogHash(dswsLogTrunc('open-not-ok', 120, 'error')) }) } catch (eL) {}; try { if (typeof logExportFail === 'function') logExportFail('openDir', 'open-fail', (res && res.error) || 'not-ok') } catch (eDbg2) {} }; flash(sharedSt, tr(okOpen ? 'cfg.dbgOpenedDir' : 'cfg.dbgOpenDirFail'), okOpen ? 'ok' : 'warn')
        }).catch(function (e) { try { log('warn', 'host.call.fail', { method: 'wf.openFolder', kind: 'open-path', errorHash: dswsLogHash(dswsLogTrunc(String((e && e.message) || e), 120, 'error')) }) } catch (eL) {}; setDbgBusy(null); try { if (typeof logExportFail === 'function') logExportFail('openDir', 'open-fail', e) } catch (eDbg2) {} flash(sharedSt, tr('cfg.dbgOpenDirFail'), 'warn') })
      } catch (eDbg) { setDbgBusy(null); try { if (typeof logExportFail === 'function') logExportFail('openDir', 'open-fail', eDbg) } catch (eDbg2) {} flash(sharedSt, tr('cfg.dbgOpenDirFail'), 'warn') }
    })
  }
  const doCopy = function () {
    if (!guardOp()) return
    setDbgBusy('copy')
    resolveLogDir().then(function (dir) {
      setDbgBusy(null)
      if (!dir) { try { if (typeof logExportFail === 'function') logExportFail('copyPath', 'path-missing', 'path-missing') } catch (eDbg2) {} flash(sharedSt, tr('cfg.dbgExportFail'), 'warn'); return }
      try { copyText(sharedSt, dir, tr('cfg.dbgCopied')) } catch (eDbg) { try { if (typeof logExportFail === 'function') logExportFail('copyPath', 'copy-fail', eDbg) } catch (eDbg2) {} flash(sharedSt, tr('toast.copyFailed'), 'warn') }
    })
  }
  const doClearAsk = function () { if (!dbgBusy) setClearAsked(true) }
  const doClearCancel = function () { setClearAsked(false) }
  const doClearConfirm = function () {
    if (dbgBusy) return
    if (!hostReady()) { setClearAsked(false); flash(sharedSt, tr('err.hostUnavailable'), 'warn'); return }
    const name = todayName()
    if (!/^\d{4}-\d{2}-\d{2}$/.test(name)) { setClearAsked(false); flash(sharedSt, tr('cfg.dbgClearFail'), 'warn'); return }
    setDbgBusy('clear')
    try {
      host.call('wf.logClear', { date: name }).then(function (res) {
        setDbgBusy(null); setClearAsked(false)
        if (!res || res.ok !== true) { try { log('warn', 'host.call.fail', { method: 'wf.logClear', kind: 'clear', errorHash: dswsLogHash(dswsLogTrunc('clear-not-ok', 120, 'error')) }) } catch (eL) {}; flash(sharedSt, tr('cfg.dbgClearFail'), 'warn'); return }
        flash(sharedSt, tr((res.removed || 0) > 0 ? 'cfg.dbgClearOk' : 'cfg.dbgClearEmpty'), 'ok')
      }).catch(function (e) { try { log('warn', 'host.call.fail', { method: 'wf.logClear', kind: 'clear', errorHash: dswsLogHash(dswsLogTrunc(String((e && e.message) || e), 120, 'error')) }) } catch (eL) {}; setDbgBusy(null); setClearAsked(false); flash(sharedSt, tr('cfg.dbgClearFail'), 'warn') })
    } catch (eDbg) { setDbgBusy(null); setClearAsked(false); flash(sharedSt, tr('cfg.dbgClearFail'), 'warn') }
  }
  return h('div', { className: 'dsws-cfg-group' }, [
    h('div', { className: 'dsws-cfg-gtitle' }, [Ic({ n: 'gear', size: 13 }), h('span', null, tr('cfg.dbgTitle'))]),
    h('div', { className: 'dsws-cfg-gdesc' }, tr('cfg.dbgDesc')),
    h('div', { className: 'dsws-cfg-row' + (dbgFlash === 'ok' ? ' dsws-fb-okflash' : '') + (dbgFlash === 'warn' ? ' dsws-fb-warnflash' : '') }, [
      h('label', { className: 'dsws-cfg-sw' }, [
        h('input', { type: 'checkbox', checked: dbgChecked, disabled: !!(dbgPending || dbgBusy), onChange: toggleDbg }),
        h('span', { className: 'tr' }), h('span', null, tr(dbgChecked ? 'cfg.dbgSwitchOn' : 'cfg.dbgSwitchOff')),
      ]),
    ]),
    h('div', { className: 'dsws-cfg-row', style: { flexWrap: 'wrap', gap: 6, marginTop: 8 } }, [
      h('button', { className: 'dsws-cfg-btn', disabled: !!dbgBusy, onClick: doExport }, tr('cfg.dbgExport')),
      h('button', { className: 'dsws-cfg-btn', disabled: !!dbgBusy, onClick: doOpen }, tr('cfg.dbgOpen')),
      h('button', { className: 'dsws-cfg-btn', disabled: !!dbgBusy, onClick: doCopy }, tr('cfg.dbgCopy')),
      h('button', { className: 'dsws-cfg-btn', disabled: !!dbgBusy, onClick: doClearAsk }, tr('cfg.dbgClear')),
    ]),
    h('div', { className: 'dsws-cfg-gdesc', style: { marginTop: 6 } }, tr('cfg.dbgPackageHint')),
    clearAsked ? h('div', { className: 'dsws-cfg-err', style: { marginTop: 8 } }, [
      h('div', { className: 't' }, [Ic({ n: 'alert', size: 13 }), h('span', null, tr('cfg.dbgClearTitle'))]),
      h('div', null, tr('cfg.dbgClearDesc')),
      h('div', { style: { display: 'flex', gap: 8, marginTop: 8 } }, [
        h('button', { className: 'dsws-cfg-btn', onClick: doClearCancel }, tr('switch.cancel')),
        h('button', { className: 'dsws-cfg-btn', disabled: !!dbgBusy, onClick: doClearConfirm }, tr('cfg.dbgConfirmClear')),
      ]),
    ]) : null,
  ])
}

export     const SettingsPage = (props) => {
      const cx = React.useContext(DswsCtx)
      const h = cx ? cx.h : React.createElement
      // T5 修订：订阅 store（设置页独立于面板 dock，需自己订阅 shared 才能渲染 flash toast）
      const sharedSt = cx ? cx.storeSvc.useStore(props && props.sessionId) : useStore(props && props.sessionId)
      // T5 修订：设置页内 toast（独立于面板 dock 的 notice 渲染）
      const cfgNotice = sharedSt.notice
      // #876 更新入口全权委托：更新按钮与更新面板 dialog 由更新包的入口件挂上（views/UpdateEntryHost.js）。
      //   合并后**唯一**挂载点在「设置 → 仓库登记库」页的状态区（见根 client.js 的 RegistryPanel）；
      //   本页不再挂第二个，只留一句去向说明，避免同一动作出现两个入口。
      return h('div', { className: 'dsws-cfg', style: { position: 'relative' } }, [
        cfgNotice ? h('div', { className: 'dsws-note', role: 'status', 'aria-live': 'polite', style: { display: 'flex', alignItems: 'center', gap: 6, top: 10, bottom: 'auto', right: 'auto', left: 14 } }, [
          Ic({ n: noticeIcon(cfgNotice.kind), size: 13, color: NOTICE_COLOR[cfgNotice.kind] || '#4ade80' }),
          h('span', null, cfgNotice.text),
        ]) : null,
        // 增-1（#520）改-2（#521）：标题同一行右侧两个表情按钮（星星只留 🌟、反馈只留 💬，一家一颗常显；悬停介绍、跳转网址、键盘聚焦不动；窄窗口换行到标题下方；状态小字旁显示构建注入的版本号去 v 前缀数字，点跳仓库首页）
        h('div', { className: 'dsws-cfg-head', style: { flexWrap: 'wrap' } }, [
          Icon({ scheme: 'compass', size: 20 }),
          h('span', { className: 't' }, tr('panel.title')),
          h('span', { className: 's', style: { color: 'var(--dsws-alias-label-caption,#8b8b95)' } }, [
            Ic({ n: 'dot', size: 12 }),
            h('span', null, tr('cfg.status')),
            h('a', { href: DSW_REPO_URL, target: '_blank', rel: 'noreferrer', style: { fontSize: 11, color: 'var(--dsws-alias-label-caption,#8b8b95)', textDecoration: 'none' } }, (typeof DSW_VERSION === 'string' ? DSW_VERSION.replace(/^v/, '') : '')),
          ]),
          h('span', { style: { display: 'inline-flex', alignItems: 'center', gap: 4 } }, [
            h(HoverTip, { key: 'star', content: tr('cfg.starTip'), mode: 'mouse', maxWidth: 220 },
              h('a', { href: DSW_REPO_URL, target: '_blank', rel: 'noreferrer', style: { display: 'inline-flex', alignItems: 'center', padding: 4, borderRadius: 6, color: 'inherit', textDecoration: 'none' } }, [h('span', { 'aria-hidden': 'true', style: { fontSize: 14, lineHeight: 1 } }, '🌟')])),
            h(HoverTip, { key: 'feedback', content: tr('cfg.feedbackTip'), mode: 'mouse', maxWidth: 220 },
              h('a', { href: DSW_REPO_URL + '/issues/new', target: '_blank', rel: 'noreferrer', style: { display: 'inline-flex', alignItems: 'center', padding: 4, borderRadius: 6, color: 'inherit', textDecoration: 'none' } }, [h('span', { 'aria-hidden': 'true', style: { fontSize: 14, lineHeight: 1 } }, '💬')])),
          ]),
        ]),
        h('div', { className: 'dsws-cfg-sub' }, tr('cfg.sub')),
        h('div', { className: 'dsws-cfg-gdesc', style: { marginTop: 4 } }, tr('cfg.updateInRegistry')),
        // 以下两个分区与「设置 → 仓库登记库」页里嵌入的是同一份组件（同 store、同宿主电话）。
        h(DeckWorkspacesSection, { key: 'ws' }),
        h(DeckDiagnosticsSection, { key: 'dbg' }),
        // T2 HoverTip 迁移：移除 sharedSt.cfgTip 全局 portal，改由 HoverTip 统一（行为零变化，翻转/样式走契约）
        null,
      ])
    }
