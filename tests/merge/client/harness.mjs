/**
 * tests/merge/client/harness.mjs —— 客户端合并装配的受控夹具
 *
 * 只用一个**桩 React**（createElement 返回普通对象、hooks 返回定值），不装 jsdom、不装真 React：
 * 本目录的测试断言的是「合并 factory 真的运行 apply 之后注册了什么、把什么交给了谁」，
 * 不是真机渲染效果。所以这里只能叫单元/集成测试，**不能**当成视觉验证。
 *
 * Deck 半边用夹具而不是真产物：真产物要 deck 构建（2MB，且运行时需要 window/document/宿主服务），
 * 属于集成人「最终公共构建 + 全量测试」那一步；夹具按 build.mjs 的 pkg 壳逐字同形，
 * 并故意与 Resident 半边**重名**声明 `React` / `h` / `API`，用来证明两半确实在独立词法作用域里。
 */

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const HERE = dirname(fileURLToPath(import.meta.url))
export const REPO_ROOT = resolve(HERE, '..', '..', '..')

export function readResidentSource() {
  return readFileSync(resolve(REPO_ROOT, 'client.js'), 'utf8')
}

export function readRepoFile(rel) {
  return readFileSync(resolve(REPO_ROOT, rel), 'utf8')
}

/** 与 deck/scripts/build.mjs 的 client-pkg 壳同形；options 只用于负例。 */
export function makeDeckSource(options = {}) {
  const id = options.id || 'dsh-mattpocock-skills-deck'
  const withDock = options.dock !== false
  const withEmbed = options.embed !== false
  const extraLoad = options.extraLoad
    ? "window.__ModuleLoader__.load({ id: 'second-load', factory: () => ({ inject: [], apply: function () {} }) })\n"
    : ''
  const dockBlock = withDock
    ? `
      slots.inject('conversation.input.dock', function () {
        return slots.register({ name: 'conversation.input.dock', id: 'dsh-mattpocock-skills-deck', order: 40 }, function StatusBar() { return h('div', { className: 'dsws-capsule' }, API) })
      })`
    : '\n      // 负例夹具：故意不注册 dock'
  const embedReturn = withEmbed
    ? `
      return { mergeEmbed: { SettingsSections: FIX_SECTIONS, UpdateEntry: FIX_UPDATE, version: 'v-fixture' } }`
    : '\n      return undefined'
  return `// fixture: 形状对照 deck/scripts/build.mjs 的 client-pkg 产物（头注释 + 单条 load）
window.__ModuleLoader__.load({
  id: '${id}',
  factory: (require) => {
    var module = { exports: {} }
    var exports = module.exports
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' })
    // 与 Resident 半边同名的顶层声明：两半必须各自独立作用域，否则加载期就是 SyntaxError
    const React = require('react')
    const h = React.createElement
    // deck/scripts/build.mjs 的 pkg 壳会把 __DSW_VERSION__ 注入成按 deck/package/package.json 算出的
    // 'v<上游版本>'；合并装配必须把它改写成根 package.json 的版本（client-factory.rewriteVersionLiteral）。
    // 夹具少了这一行，装配层就会按设计拒绝产出——那是夹具过期，不是装配坏了。
    const DSW_VERSION = 'v1.8.0-rc.7'
    const API = 'deck-fixture-api'
    const FIX_SECTIONS = function DeckFixtureSections() { return h('div', { className: 'deck-fixture-sections' }) }
    const FIX_UPDATE = function DeckFixtureUpdate() { return h('span', { className: 'deck-fixture-update' }) }
    globalThis.__DECK_FIXTURE__ = { sections: FIX_SECTIONS, update: FIX_UPDATE, applied: false, embed: false }
    exports.inject = ['connection', 'slots', 'locale', 'workspaces', 'sessions']
    exports.apply = function (ctx) {
      const slots = ctx.slots
      globalThis.__DECK_FIXTURE__.applied = true
      globalThis.__DECK_FIXTURE__.embed = true${dockBlock}
      slots.inject('sidebar.right.pane.tab', function () {
        return slots.register({ name: 'sidebar.right.pane.tab', key: 'dsh-mattpocock-skills-deck/deck:map' }, function DeckSidebarTab() { return h('div') })
      })
      slots.inject('settings.plugins.tab', function () {
        return slots.register({ name: 'settings.plugins.tab', id: 'dsws-settings', order: 40 }, function SettingsTab() { return h('div') })
      })${embedReturn}
    }
    return module.exports
  }
})
${extraLoad}`
}

/** 最小 Resident 半边夹具；options 只用于负例（id / inject 数组）。 */
export function makeResidentSource(options = {}) {
  const id = options.id || '@local/dsh-github-resident-v2'
  const inject = options.inject || ['slots']
  const injectLiteral = '[' + inject.map((s) => `'${s}'`).join(', ') + ']'
  return `window.__ModuleLoader__.load({
  id: '${id}',
  factory(require) {
    const React = require('react');
    const h = React.createElement;
    return {
      inject: ${injectLiteral},
      apply(ctx) {
        ctx.slots.inject('settings.section', () => ctx.slots.register({
          name: 'settings.section', id: 'github-resident', order: 60, label: 'GitHub',
        }, function Panel() { return h('div', { className: 'res-fixture' }) }));
      },
    };
  },
});
`
}

/** 桩 React：够跑两半的 apply 与设置页组件体，不做真渲染。 */
export const ReactStub = {
  createElement(type, props, ...children) {
    return { type, props: props || {}, children: children.length === 1 ? children[0] : children }
  },
  useState(initial) {
    return [typeof initial === 'function' ? initial() : initial, () => {}]
  },
  useRef(initial) {
    return { current: initial }
  },
  useCallback(fn) {
    return fn
  },
  useEffect() {},
  useContext() {
    return null
  },
}

export function makeRequire() {
  return (name) => {
    if (name === 'react') return ReactStub
    throw new Error('夹具 require 收到未预期的模块：' + name)
  }
}

/** 在受控 window 上求值合并产物，取回 load 声明。 */
export function loadMergedModule(text) {
  const box = { spec: null }
  const win = {
    __ModuleLoader__: {
      load(spec) {
        box.spec = spec
      },
    },
  }
  new Function('window', text)(win)
  return box.spec
}

/** 宿主槽位服务的记录桩：inject 立即调用 factory（与宿主一进一出的语义等价到「注册集合」粒度）。 */
export function makeFakeCtx() {
  const registrations = []
  const injects = []
  const slots = {
    inject(name, factory) {
      injects.push(name)
      const disp = factory()
      return typeof disp === 'function' ? disp : () => {}
    },
    register(spec, component) {
      registrations.push({ spec, component })
      return () => {}
    },
  }
  const services = { slots }
  const ctx = {
    slots,
    get(key) {
      return services[key]
    },
    inject(keys, callback) {
      if (typeof callback === 'function') callback()
      return () => {}
    },
    effect() {
      return () => {}
    },
  }
  return { ctx, registrations, injects }
}

/** 在桩 React 的元素树上查找节点（数组会摊平）。 */
export function findInTree(node, predicate) {
  if (node === null || node === undefined || node === false || node === true) return null
  if (Array.isArray(node)) {
    for (const child of node) {
      const hit = findInTree(child, predicate)
      if (hit) return hit
    }
    return null
  }
  if (typeof node !== 'object') return null
  if (predicate(node)) return node
  return findInTree(node.children, predicate)
}

/** 取某条已注册组件的渲染树（受控：只用桩 React 调一次组件函数）。 */
export function renderRegistration(registration, props = {}) {
  return registration.component(props)
}
