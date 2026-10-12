/**
 * client/panelAssembly.js —— 面板装配（从 index.js 拆出，#459，纯结构、行为零变化）
 * 契约：模块真源（ESM 导出）；scripts/build.mjs 构建时剥行首 export 拼回
 * src/client/index.js 的 leaf 标记处（一源两物，标记 id 与本文件名一致）。
 * 以后谁改它：改面板装配流程（Ctx 装配、插槽注册、启动收尾）的人改它。
 * 接线：本文件只用闭包已有名字（createCx/DswsCtx/RDOM/store/路由/叶子组件/slots），不引用其他新文件。
 */
    // ============================================================
    // 5.11 Ctx 接线（阶段 2 步骤 1 · #95）：建 cx 单例 + Provider 包住渲染树（行为零变化）
    // ============================================================
    // DswsCtx / createCx 由构建从 src/client/kernel/ctx.js 注入本闭包顶部（双产物同构 · seam 同模式）。
    // cx = { ctx, h, rdom, storeSvc, localeSvc, timer, api, router }（G3 冻结清单 8 字段 · #91 拍板）。
    // 宿主 slots 无全局 wrapper API（实查 dsh-client-ui-slots 0.1.0-rc.7 仅 register/inject），
    // 故 Provider 包在每个插槽组件注册处（渲染树顶层 = 组件根）；T4（#97）后叶子组件经
    // React.useContext(DswsCtx) 消费 cx（h/storeSvc 等），渲染输出与接线前一致（verify-* 全绿证明）。
    export const apiCall = function (endpoint, args) {
      if (typeof host === 'undefined' || typeof host.call !== 'function') {
        return Promise.reject(new Error('host.call 不可用（Host 半未加载）'))
      }
      return host.call(endpoint, args)
    }
    export const cx = createCx({
      ctx: ctx,
      h: h,
      rdom: RDOM,
      storeSvc: { shared: shared, stores: stores, makeStore: makeStore, storeOf: storeOf, emit: emit, sub: sub, useStore: useStore },
      localeSvc: localeSvc,
      timer: timer,
      api: { call: apiCall },
      router: { open: openPanel, toggle: togglePanel },
    })
    // Provider 包装器：任意深度组件都可 useContext(DswsCtx) 取 cx；props 原样透传
    export const withCx = function (Comp) {
      return function (props) {
        return h(DswsCtx.Provider, { value: cx }, h(Comp, props))
      }
    }

    // ============================================================
    // 6. 插槽注册（#298 幂等：每个槽位只注入一次，二次 apply/HMR 不增生）
    // ============================================================
    // 模块级闸门：每个槽位仅注入一次；卸载时经 ctx.effect 复位，允许重装后重注
    export const __slotOnce = {}
    export const __slotDisposers = {}
    export const __injectOnce = function (slotName, factory) {
      if (__slotOnce[slotName]) return
      __slotOnce[slotName] = true
      let disp = null
      try {
        slots.inject(slotName, function () {
          try {
            disp = factory()
          } catch (e) {
            __slotOnce[slotName] = false
            throw e
          }
          __slotDisposers[slotName] = disp
          return function () {
            try { if (disp) disp() } catch (e) { /* 忽略 */ }
            __slotDisposers[slotName] = null
          }
        })
      } catch (e) {
        __slotOnce[slotName] = false
        __slotDisposers[slotName] = null
        throw e
      }
      ctx.effect(function () {
        return function () {
          __slotOnce[slotName] = false
          try { const d = __slotDisposers[slotName]; if (d) d() } catch (e) { /* 忽略 */ }
          __slotDisposers[slotName] = null
        }
      }, 'dsws: slot ' + slotName)
    }
    // 页内浮窗已退役（维护者 2026-09-19 定）：面板只有右侧边栏一个落点，所以这里不再注册浮窗挂载点。
    //   原来挂在这个位置的是页内浮窗组件（shell.overlay 槽位），它已随这次退役整份删除；
    //   它当年负责的提示条与切换弹窗，Dock 那边本来就有。
    __injectOnce('conversation.input.dock', function () {
      return slots.register({ name: 'conversation.input.dock', id: DSW_IDENTITY, order: 40 }, withCx(StatusBar))
    })
    /**
     * 身份融合（2026-10-12）：向宿主要"现在装着的这一份"的 name / version / repository，并**就地更新**
     * 那两个构建期常量（`DSW_VERSION` / `DSW_REPO_URL` 都由本闭包持有，赋值后所有读它们的地方一起跟上）。
     *
     * 三条口径：
     *   - 只认宿主回的**已装目录 package.json**（`wf.pluginIdentity`），不认构建期字面量；
     *   - 宿主问不到（源码态、门禁、老宿主没有这条电话）就保持字面量，静默不阻断；
     *   - 版本号与仓库地址**一起换**：它们本来就是同一份身份的两个字段，分开换会让界面上出现
     *     "新版本号 + 旧仓库链接"这种半融状态（正是这次要收掉的东西）。
     */
    const probePluginIdentity = function () {
      try {
        if (typeof host === 'undefined' || !host || typeof host.call !== 'function') return
        Promise.resolve(host.call('wf.pluginIdentity', {})).then(function (res) {
          try {
            const v = res && res.ok !== false ? res : null
            if (!v) return
            const ver = v.version ? String(v.version) : ''
            // 设置页与右栏都按 `v` 前缀显示（locale 词条与 CSS 都按这个形态对齐），这里统一补上。
            if (ver && /^\d/.test(ver)) DSW_VERSION = 'v' + ver
            else if (ver) DSW_VERSION = ver
            const url = v.repoUrl ? String(v.repoUrl) : ''
            if (/^https?:\/\//.test(url)) DSW_REPO_URL = url
          } catch (eApply) {}
        }).catch(function () {})
      } catch (eProbe) {}
    }
    __injectOnce('tool.view.cordis', function () {
      return slots.register({ name: 'tool.view.cordis', key: 'self' }, withCx(RunPanel))
    })
    // v25-50：配置页（设置 → 插件 → GitHub 常驻；与 opencode 主题同模式）
    //   合并后这里仍是「插件管理」兼容入口：内容与「设置 → 仓库登记库」里嵌入的那份**同源同状态**
    //   （同一批分区组件、同一个 store），不是第二套私有设置。
    __injectOnce('settings.plugins.tab', function () {
      return slots.register({ name: 'settings.plugins.tab', id: 'dsws-settings', order: 40, label: function () { return tr('panel.title') } }, withCx(SettingsPage))
    })
    // settings.section#dsws-settings-section（order 18）在合并时删除：它的内容已并入
    // Resident 的 settings.section#github-repo-registry（order 61），保留两条会让左栏出现
    // 两个指向同一内容的入口。Deck 侧不再有独立设置页条目。
    // ============================================================
    // 面板的落点：DSH 原生右侧边栏（2026-09-21 起唯一落点）
    // ============================================================
    // 本插件自己在原生登记表里注册一个 tab 类型（builtin 档），右栏里那一格由我们自己渲染。
    //   等待方式是服务（ctx.inject(['sidebarRightTabs'])，不是在槽位声明上等）：原生右栏先声明槽位、
    //   后提供服务，按槽位声明触发会读到空服务、永久注册不上。
    //   2026-09-21：原来另有一条路 —— 把面板类型交给 dsh-better-sidebar，由它开、它管。那条已整段删除：
    //   那个插件把面板画进的是同一列，于是原生右栏的引导页里出现两枚同名入口（用户看到「两个 MattSkills」）。
    //   删掉之后本插件不再依赖任何第三方插件，面板只有这一条路。
    export let nativeTabDisposer = null
    export const registerNativeTabType = function () {
      if (nativeTabDisposer) return true
      const tabs = ctx.get('sidebarRightTabs')
      if (!(tabs && typeof tabs.register === 'function')) return false
      try {
        nativeTabDisposer = tabs.register({
          id: DECK_NATIVE_TYPE_ID,
          kind: DECK_NATIVE_TAB_KIND,
          title: function () { return tr('panel.title') },
          icon: function () { return Ic({ n: 'map', size: 14 }) },
          priority: 'builtin',
          // 右栏「+」引导页里的入口：用户在引导页也能自己把面板加出来。
          guide: [{ order: 60, title: function () { return tr('panel.title') }, icon: function () { return Ic({ n: 'map', size: 14 }) } }],
        })
      } catch (e) { nativeTabDisposer = null; return false }
      return true
    }
    export const registerNativeTabSlots = function () {
      if (!nativeTabDisposer) return false  // 类型没注册上就不注册内容体，避免留下半截注册
      __injectOnce('sidebar.right.pane.tab', function () {
        return slots.register({ name: 'sidebar.right.pane.tab', key: DECK_NATIVE_TYPE_ID, inject: function (sessionId) { return { sessionId: sessionId } } }, withCx(DeckSidebarTab))
      })
      __injectOnce('sidebar.right.pane.tab.title', function () {
        return slots.register({ name: 'sidebar.right.pane.tab.title', key: DECK_NATIVE_TYPE_ID }, withCx(DeckNativeTabTitle))
      })
      return true
    }
    if (typeof ctx.inject === 'function') {
      ctx.inject(['sidebarRightTabs'], function () {
        if (registerNativeTabType()) registerNativeTabSlots()
      })
    } else {
      // 老宿主没有 ctx.inject：退回每秒试一次（最多 10 次）。
      let nativeTries = 0
      const nativeTimer = setInterval(function () {
        nativeTries++
        if (registerNativeTabType()) { registerNativeTabSlots(); clearInterval(nativeTimer) } else if (nativeTries >= 10) clearInterval(nativeTimer)
      }, 1000)
    }
    ctx.effect(function () {
      return function () {
        try { if (nativeTabDisposer) nativeTabDisposer() } catch (e) { /* 忽略 */ }
        nativeTabDisposer = null
      }
    }, DSW_IDENTITY + ': native right sidebar tab')

    // #490 client 日志底座：开关启动对账（本地秒显已在 log.js 顶层同步完成；
    //   此处再向宿主读开关，以宿主为准；宿主不可用就保持本地值，不阻断启动）。
    try { if (typeof reconcileLogSwitch === 'function') reconcileLogSwitch() } catch (e) {}
    // 身份融合（2026-10-12）：版本号与仓库地址改为**问宿主要运行中那一份的真实值**。
    //   为什么：构建期字面量（DSW_VERSION / DSW_REPO_URL）说的是"构建那一刻的身份"，而界面上要显示的是
    //   "现在装着的这一份" —— 文件级安装只换代码不换身份证那类场景下两者会不一致（见宿主
    //   updateFromPackage.js 的 __syncInstalledManifest 注释）。宿主回**已装目录 package.json** 的
    //   name / version 与 repository；问不到（源码态 / 门禁 / 老宿主）就保留构建期字面量，不阻断启动。
    try { if (typeof probePluginIdentity === 'function') probePluginIdentity() } catch (eIdProbe) {}
    // #347：加载真数据快照（repo 链接 + 前置检测兜底），失败静默
    loadSnapshot(shared, false)
    // #265：命名守护常驻渲染钩子（面板未开也续跑；计划单经 wf.namingPlan 拉取后代执行改名）
    startNamingGuardianEvents()

    // ============================================================
    // 7. 合并装配：把可复用的设置区块与唯一更新入口交给 Resident 的「仓库登记库」页
    // ============================================================
    // 合并后的单客户端 factory（tools/merge/client-factory.ts）先跑本半边，取本 apply 的返回值，
    // 再把它作为第二参数交给 Resident 半边。所以这里返回的不是「页面」而是组件引用：
    //   SettingsSections —— 工作区总览 + 诊断日志开关与四键 + 作者链接（默认折叠）
    //   UpdateEntry      —— 唯一更新入口（组件本体仍是 views/UpdateEntryHost.js，不复制按钮状态机）
    // 两个组件都用 withCx 包过：Resident 页面直接挂载就能拿到本半边的 cx（store / locale / 宿主电话）。
    // 单独运行本半边（旧形态）时返回值无人消费，行为不变。
    const DeckSettingsSections = function () {
      const cx = React.useContext(DswsCtx)
      const hh = cx ? cx.h : React.createElement
      return hh('div', { className: 'dsws-embed' }, [
        hh(DeckWorkspacesSection, { key: 'ws' }),
        hh(DeckDiagnosticsSection, { key: 'dbg' }),
        hh(DeckAuthorPluginsSection, { key: 'more' }),
      ])
    }
    const DeckUpdateEntry = withCx(function () { return h(UpdateEntryHost, null) })
    return {
      mergeEmbed: {
        SettingsSections: withCx(DeckSettingsSections),
        UpdateEntry: DeckUpdateEntry,
        version: DSW_VERSION,
        repoUrl: DSW_REPO_URL,
      },
    }
