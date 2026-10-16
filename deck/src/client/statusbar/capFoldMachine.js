// statusbar/capFoldMachine.js — 状态栏胶囊那条横条的阶梯机（#725，维护者 2026-09-24 定）
// 契约：模块真源（ESM 导出）；scripts/build.mjs 构建时剥行首 export，拼回 src/client/index.js
//   的 leaf 标记处（一源两物）。
//
// 这一台做什么：照 statusbar/capFold.js 那条纯判据把胶囊推到某一档（第几档每一段画什么都是判据算的）。
//   926 起四步分开：守卫（输入没变直接复用上次档位，零写零测）→ 单写（一次写完，不读布局）→
//   放下判断（capFoldFits 一次）→ 对不上再逐档纠偏。结论与原来逐档试出来的那一档完全一致。
//
// #74（形态档）：这一台同时是**形态结论的持有者** —— 「全展不滑 / 先收后滑 / 全滑不收」这三档由
//   statusbar/barForm.js 那条纯判据定，判据的两个数（这一格的可用宽、收光可收段之后的脚印）都在
//   这里当场量（capFoldMeasure 的同一次测量里带出载荷脚印，不额外写一次 flex）。
//   那个横滑开关类名 `.dsws-bar-scroll` **只有这一台写一处**（capFoldWriteForm）；barScroll.js 只读不写 ——
//   过去它按「当前有没有可滑量」也写一遍，两个写入者判据不同、还会互相覆盖（阶梯刚落的类会被它撤掉，
//   字就永远是被压扁的状态）。形态判据的边界与阶梯自己的「放得下」判据是**同一个测量**，所以两条结论
//   不会自相矛盾（见 barForm.js 里那段）。
//   收起来的形状 = 给那一段字的 span 加 .dsws-folded（display:none）—— 图标是它的兄弟节点，
//   不是这条阶梯里的东西，从头到尾不动它们（本文件只碰 [data-fold-priority] 的字段：
//   普通计数器在 .dsws-num 上、图标在 svg 上，两者都没有这个属性；进了阶梯表的字段
//   （在办编号、环境计数）收到底也会空掉 —— 它们是纯文本元素，机器只写字不碰结构）。
//
// 2026-09-24 真机回归（维护者截图：整条只剩品牌图标与绿点）之后补上的第一条规矩：
//   **量不到有效可用宽的那一趟，不许下任何结论。** 从前是「量到多少就照多少判放不放得下」，
//   于是首帧还没布局时（列宽 0）它照样算出「每一档都放不下」，一路走到最后一档 —— 九个字全被收掉，
//   只剩图标与数字。这里要特别记一笔：那种时刻 cap.clientWidth 并不是 0，而是 12（胶囊自己的
//   3px 6px 内边距 + 1px 边框），所以「clientWidth <= 0 才叫没量到」这条守卫根本挡不住它；
//   真正能分出来的是**内容盒**（孩子能用的那点宽）与矩形宽高一起看，见 capFoldRoom。
//   量不到时不写 DOM、不改档号（保持上一档；首次挂载就保持 React 原样），只安排一次重算。
//
// keep 是调用方跨调用带着走的两张表加一个标记（挂在组件的 ref 上，键都是 data-fold-priority 号码串）：
//   · keep.full —— 每一段**完整的那串字**。机器画上去的是收短后的样子，若下一趟照着 DOM 里那串收短的字
//     再收一次，就会越收越短、再也展不开；所以「完整的那串」必须记在机器外面。
//   · keep.written —— 机器上一次写进 DOM 的那一串。用来认出「这不是我写的」：React 重渲染时会把收短过的
//     那串换回完整的一串（时间串一直在变），那一次写入要当成新的事实，重新排一遍阶梯。
//   · keep.foldGuardKey / keep.foldGuardTier / keep.foldGuardEl —— 926 输入指纹守卫：上次定档时的
//     （内容盒宽 | 段数 | 完整字散列）拼成的键、上次档位、上次画过的那个元素。三样全对上才复用；
//     量不到的那趟键记空串（未知不记成结论），元素换了也重算（新元素还没画过这一档）。
//   · keep.guardLog —— 926 守卫复用记账（命中 / 未命中各几次，每 100 趟按需记一行 input.observe）。
//   · keep.started —— 这一台有没有量到过有效可用宽（也就是有没有从首帧的起始态里走出来）。
//     维护者 2026-09-24 晚说清的那一句「默认收成折叠是出来的一瞬间是折叠的，但是因为空间足够所以一定能
//     看到，除非宽度不够」：首帧（还没量到可用宽）品牌那一段是收起的（见 capFoldStartWordsOf），
//     量到之后就从第 0 档重走一遍 —— 够宽就把它显示出来。这个标记就是「走出首帧了没有」。
// 返回：最后定下来的档号（同时写进 cap.dataset.foldTier，供真机门禁等它稳定；cap.dataset.fold 记折叠段数）；
//   这一趟量不到可用宽时返回 null，且不写任何 dataset（门禁据此看得出「还没定档」）。
export const runCapFold = function (cap, keep) {
  // 2026-10-13（横滑实装）：胶囊里多了一枚隐形幻影行（.dsws-bar-phantom，只用来量尺子）。
  //   这条横条的「可见行」是 .dsws-barcell；放下判断/可用宽/矩形都按它量 —— 幻影行高 0、
  //   画面外，拿它当版面量出来的数全是错的（门禁 I1/I2 那 12 条就是这么红的）。
  const capRow = (cap && cap.querySelector) ? (cap.querySelector('.dsws-barcell') || cap) : cap
  const full = (keep && keep.full) || {}
  const written = (keep && keep.written) || {}
  const slots = Array.from(cap.querySelectorAll('[data-fold-priority]')).map(function (el) {
    return { el: el, p: String(el.getAttribute('data-fold-priority') || '') }
  })
  if (!slots.length) return 0
  slots.sort(function (a, b) { return a.p - b.p })
  const items = slots.map(function (s) {
    const now = String(s.el.textContent || '')
    const seen = written[s.p]
    if (seen === undefined || now !== seen) full[s.p] = now
    return { priority: Number(s.p), word: full[s.p] }
  })
  // 926 先量尺子：量不到有效可用宽，这一趟到此为止 —— 档号不写、阶梯一个字不画、守卫键记空。
  //   量不到不等于放不下，照「量到多少就判多少」写下去反而会把「未知」变成一条错结论（真机回归就是这么来的）。
  //   但首帧要落在**起始态**上：胶囊第一次画出来、还没有过任何一次有效测量时，品牌那一段是收起的
  //   （其余各段照原样）—— 这正是维护者要的「默认折叠」，见本文件上面 keep.started 那一段。
  const roomW = capFoldRoom(capRow)
  if (roomW === null) {
    keep.foldGuardKey = ''
    if (!keep.started) applyCapFoldStart(cap, slots, keep)
    capFoldRetryOnce(cap, keep)
    return null
  }
  keep.started = true
  // 926 输入指纹守卫：折叠结论只由可用宽与各段完整字决定（阶梯是纯函数），三样全对上就直接复用
  //   上次档位 —— 一个字不写，一次放下判断不跑。React 只在它自己的字变了时才写界面，而那次写入一定
  //   会进 keep.full 使指纹变化，所以「字被换回完整」那一种不会被跳过；元素换代也必重算。
  let guardHash = 5381
  for (let gi = 0; gi < items.length; gi++) {
    const gw = String(items[gi].word || '')
    for (let gj = 0; gj < gw.length; gj++) guardHash = ((guardHash * 33) ^ gw.charCodeAt(gj)) | 0
  }
  const guardKey = roomW + '|' + items.length + '|' + guardHash
  if (keep.foldGuardEl === cap && keep.foldGuardKey === guardKey && keep.foldGuardTier !== undefined) {
    capFoldGuardLog(keep, guardHash, true)
    return keep.foldGuardTier
  }
  capFoldGuardLog(keep, guardHash, false)
  const ladder = capFoldLadderOf({ items: items })
  const last = Math.max(0, capFoldStepCount(ladder) - 1)
  // 926 单写路径：把这一档每一段一次写完（收成空串的加 .dsws-folded，其余去掉），写完不读布局 ——
  //   读布局只发生在后面的 capFoldFits 里，写与读不再交替。
  const writeTier = function (tier) {
    const words = capFoldStateAt(ladder, tier).words || {}
    for (let i = 0; i < slots.length; i++) {
      const text = String(words[slots[i].p] || '')
      slots[i].el.textContent = text
      written[slots[i].p] = text
      if (text === '') slots[i].el.classList.add('dsws-folded')
      else slots[i].el.classList.remove('dsws-folded')
    }
  }
  // 926 从上一档起步（到这里输入一定变了；起步档夹紧到阶梯内）：放得下就往完整方向回弹，
  //   放不下就往下走 —— 变宽回弹的语义与原来「每趟从第 0 档重走」一致，只是起步省掉了中间档。
  let tier = 0
  if (typeof keep.foldGuardTier === 'number' && (keep.foldGuardEl === cap || keep.foldGuardKey === guardKey)) tier = Math.max(0, Math.min(keep.foldGuardTier, last))
  const start = tier
  writeTier(start)
  // 这一趟的读数一次交齐（wantPayload）：这一档的脚印（foot）＝阶梯的放下判断，收光可收段之后的脚印
  //   （payload）＝形态判据的第一问 —— 两者在**同一次**测量里出（同一个 flex 写窗口，不额外写一次 flex）。
  const startMeasure = capFoldMeasure(capRow, true)
  // #74 形态第一问：**把可收的段全收光之后放得下吗**（判据在 statusbar/barForm.js）。
  //   答「放不下」＝折叠救不了这一格 → **全滑不收**：一个档都不走，字全摊开，整条交给滑窗。
  //   2026-10-13 真机（票「真机竖屏验收」）后维护者定的那一条：窄条上「字该滑出去（拖回来还在），
  //   不该被收掉」—— 收到底只会把 12 段字换成图标与数字（那条判据过去是「可用宽 ≥ 468 或视口 ≤ 679」
  //   两条像素线 OR 出来的副作用，今天改成这个当场量出来的问题）。
  const foldsFit = barFormFoldsFit(roomW, startMeasure.payload)
  const preForm = barFormOf({ foldsFit: foldsFit })
  if (preForm.spread) {
    writeTier(0)
    tier = 0
    // 形态开关（横滑那一层）与档号一起落 —— 单一写入者见 capFoldWriteForm。
    capFoldWriteForm(capRow, preForm)
    cap.dataset.foldTier = '0'
    cap.dataset.fold = '0'
    keep.foldGuardEl = cap
    keep.foldGuardKey = guardKey
    keep.foldGuardTier = 0
    return 0
  }
  // 2026-10-16（#926 最后一跳）：这里收的是**同一次读数**—— capFoldFits(cap) 就是 capFoldMeasure(cap).fits，
  //   而上面第 100 行刚量过、中间没有任何写入，所以再量一遍是白花 24 次 flex 写。
  //   语义一字不变（同状态、同函数、同判据），只是不再重复测；横滑那条判据本来也是复用这次读数的。
  if (startMeasure.fits) {
    tier = start
    while (tier > 0) {
      writeTier(tier - 1)
      if (capFoldFits(capRow)) tier--
      else { writeTier(tier); break }
    }
  } else {
    tier = last
    for (let t = start + 1; t <= last; t++) {
      writeTier(t)
      if (capFoldFits(capRow)) { tier = t; break }
    }
  }
  cap.dataset.foldTier = String(tier)
  cap.dataset.fold = String(slots.filter(function (s) { return s.el.classList.contains('dsws-folded') }).length)
  // #74 形态结论（同一条判据、同一个写入者）：停在第 0 档 ＝ **全展不滑**（开关撤掉）；
  //   收过字 ＝ **先收后滑**（开关落上 —— 各段从此不被 flex 压扁，真收了还有余下溢出的话由滑窗接住）。
  capFoldWriteForm(capRow, barFormOf({ foldsFit: foldsFit, tier: tier }))
  // 926 落键：这一趟量到了有效宽度，结论可复用。
  keep.foldGuardEl = cap
  keep.foldGuardKey = guardKey
  keep.foldGuardTier = tier
  return tier
}

// 926 守卫复用记账：复用已计数事件 input.observe（六组嫌疑的统一观测口），采样每 100 趟一行。
//   新增的是内存缓存（命中 / 未命中），调用频繁所以记按需级：先判开关，关着不组装字段；
//   字段只用该事件白名单里的四个键（kind / count / latencyMs / keyHash），不记原文。
// 926 同帧合并的实现（接线在 StatusBar.js，那里只留一行转调，保持零增长基线）：
//   同一帧里的多次触发只真跑一次 —— 占位后把活排进帧回调，回调里清占位再跑，画出来是同一帧；
//   帧回调不可用（异常宿主）时同步兜底，行为退回原样。占位记在调用方跨调用带着走的 keep 上。
const capFoldScheduleFold = function (keep, applyFold) {
  if (!keep || keep.foldRaf) return
  keep.foldRaf = 1
  try { window.requestAnimationFrame(function () { keep.foldRaf = 0; applyFold() }) } catch (eRaf) { keep.foldRaf = 0; applyFold() }
}
const capFoldGuardLog = function (keep, guardHash, hit) {
  try {
    const st = keep ? (keep.guardLog || (keep.guardLog = { n: 0, hit: 0, miss: 0 })) : null
    if (!st) return
    st.n++; if (hit) st.hit++; else st.miss++
    if (typeof isEnabled === 'function' && isEnabled('debug') && st.n % 100 === 0) log('debug', 'input.observe', { kind: 'capfold-guard', count: st.hit, latencyMs: st.miss, keyHash: String(guardHash) })
  } catch (e) {}
}

/**
 * 把这一条摆成**还没量到可用宽的那一帧**的样子（维护者要的「默认折叠」，见文件头 keep.started 那段）：
 *   被 capFoldStartFoldedOf 点到的几段（今天只有品牌那一段）写成空串并加 .dsws-folded（display:none），
 *   其余各段照原样写着 —— 于是真机上看到的就是「只剩一枚罗盘图标，别的都在」。
 * 为什么要把「首帧长什么样」也交给机器来画、而不是只靠界面那边：胶囊是 React 画的，而「这一帧量到宽了没有」
 *   只有这里知道。机器每次进场都先照这一条把首帧摆对，界面那边不必自己判断，两边也不会各说各话。
 * keep 传进来的话，顺手把这几个空串记进 keep.written —— 不然下一趟会把「我自己写的空串」当成界面送来的
 *   新事实记进 keep.full，那一段字从此再也展不开。
 * 只在「还没有任何一次有效测量」时调用；量到之后一律走阶梯（第 0 档 = 九段全展开）。
 */
export const applyCapFoldStart = function (cap, slotsIn, keepIn) {
  const slots = Array.isArray(slotsIn) ? slotsIn : Array.from(cap.querySelectorAll('[data-fold-priority]')).map(function (el) {
    return { el: el, p: String(el.getAttribute('data-fold-priority') || '') }
  })
  const written = keepIn && keepIn.written
  const keepFolded = capFoldStartFoldedOf()
  for (let i = 0; i < slots.length; i++) {
    if (keepFolded.indexOf(slots[i].p) < 0) continue
    slots[i].el.textContent = ''
    slots[i].el.classList.add('dsws-folded')
    if (written) written[slots[i].p] = ''
  }
  void cap.offsetWidth
  return keepFolded
}
/**
 * #74 **这一条横条上那个形态开关唯一的写入点**（判据在 statusbar/barForm.js，结论由 runCapFold 持有）。
 *   form = barFormOf(...) 的返回值：{ form, barScroll, spread }。
 * 规矩（票面「单一写入者」那一条）：
 *   · 有结论（form 非空）才写，且只碰这一个类名；fold / scroll 落上，flat 撤掉 —— 撤也是写，
 *     所以宽窄两种方向都从这一处走；
 *   · 没有结论（量不到脚印：form 空串）时**一个字都不碰** —— 未知不是「不滑」（#725 那条老规矩）；
 *   · 无障碍环境（classList 不可用）里只影响「不缩」这一层，不影响档位，所以吞掉异常。
 * barScroll.js 从 #74 起只读不写（它过去那句 toggle 是第二个写入者，判据还不同：按「当前有没有可滑量」，
 *   而阶梯刚收完字时内容不溢出 → 它会把刚落的类撤掉 → 字被 flex 压扁，真机症状）。
 */
const capFoldWriteForm = function (capRow, form) {
  if (!form || !form.form) return false
  try { capRow.classList.toggle(BAR_FORM_CLASS, !!form.barScroll) } catch (e) { return false }
  return true
}
/**
 * 量不到时安排**一次**重算：下一帧再看一眼就够（首帧没上屏这一种，下一帧通常就定下来了）。
 *   同一张 keep 上只挂一个待办（单飞），跑过一次就摘掉；跑完还是量不到就等外面那几条路来叫它
 *   （ResizeObserver 的两条 / 每次提交后重算 / 字体就绪）—— 这里不排第二次、也不自续
 *   （#709 那条纪律：库里的活不许自己给自己续命）。
 */
const capFoldRetryOnce = function (cap, keep) {
  if (!keep || keep.retryPending) return
  try {
    const win = (cap && cap.ownerDocument && cap.ownerDocument.defaultView) || (typeof window !== 'undefined' ? window : null)
    if (!win || typeof win.requestAnimationFrame !== 'function') return
    keep.retryPending = true
    win.requestAnimationFrame(function () {
      keep.retryPending = false
      try { if (cap && cap.isConnected) runCapFold(cap, keep) } catch (e) {}
    })
  } catch (e) { keep.retryPending = false }
}
