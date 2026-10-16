// statusbar/capFoldMachine.js — 状态栏胶囊那条横条的阶梯机（#725，维护者 2026-09-24 定）
// 契约：模块真源（ESM 导出）；scripts/build.mjs 构建时剥行首 export，拼回 src/client/index.js
//   的 leaf 标记处（一源两物）。
//
// 这一台做什么：照 statusbar/capFold.js 那条纯判据把胶囊推到某一档（第几档每一段画什么都是判据算的）。
//   926 起四步分开：守卫（输入没变直接复用上次档位，零写零测）→ 单写（一次写完，不读布局）→
//   放下判断（capFoldFits 一次）→ 对不上再逐档纠偏。结论与原来逐档试出来的那一档完全一致。
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
  const startMeasure = capFoldMeasure(capRow)
  // 2026-10-13 真机（票「真机竖屏验收」）后的定案：**横滑形态下这一台不再收字**。
  //   真机上看到的症状：手机竖屏（412pt）这条条本来宽到一千多像素，可它量的是「可见行」，
  //   窄屏上可见宽不到 400px，于是阶梯照老规矩一路收到底 —— 12 段字全变成图标，只剩几颗图标与数字。
  //   而票面写的窄屏形态是「整条转横滑、字不丢」：字该滑出去（拖回来还在），不该被收掉。
  //   所以：可见行有 468px 以上可用宽、且**完整一行**都放不下时，这一趟直接把字全部摊开（第 0 档）
  //   并保持——让溢出发生在滑窗里（.dsws-barcell 的 overflow-x:auto），而不是发生在字上。
  //   桌面线（可见行 < 468px 那一头不存在）与旧宿主行为不变：宽度富余时仍旧第 0 档、不进这里。
  const rowScrolls = capFoldRowScrolls(capRow)
  if (rowScrolls && !startMeasure.fits && startMeasure.foot > 0) {
    writeTier(0)
    // 摊开之后立刻把「横滑形态」那一层开关落上：可见行里的各段从此不再被 flex 压扁
    //   （styles.js 的 .dsws-barcell.dsws-bar-scroll > *）。为什么必须在**这一帧**落、不能等观察器：
    //   不落的话各段还是 flex:0 1 auto，窄条上被压到 min-content，内容不再溢出 → 观察器算出的
    //   canLeft/canRight 全假 → barScroll 也就不会补这个 class，字就永远是被压扁的状态（真机症状）。
    try { capRow.classList.add('dsws-bar-scroll') } catch (e) { /* 无障碍环境：只影响不缩这一层 */ }
    tier = 0
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
 * 这一档放不放得下：把「这一条横条里的东西按其本来宽度摆开」，看装不装得下。装得下返回 true。
 *
 * 为什么不能直接比 cap.scrollWidth 与 cap.clientWidth：那枚「一串字」的元素（品牌那一段）住在一个
 *   会收缩的框（.dsws-capsule-word，flex:1 1 auto + min-width:0）里。宿主窄到这个框不够装那串字时，
 *   框先缩到接近零、字被挤在框的边缘；这一条横条自己的 scrollWidth 这时是「框的宽 + 框后面各段的宽」，
 *   于是它照样报「不溢出」。真机上的样子就是 2026-09-24 晚那次反馈：宽到 680 像素时左边那串
 *   MattSkills 早被挤得只剩一两个字宽（看起来就是「那串字还是看不见」），而机器还以为第 0 档放得下，
 *   一个台阶都不走 —— 「有位置就显示、宽度不够时它第一个让位」这句话就成了空话。
 *
 * 所以这里量的是一件与「谁被挤住」无关的事实：**把每一段孩子按 flex:0 0 auto 摆开（也就是不让谁
 *   为了塞进去而缩）之后，这一条横条的内容到底有多宽**。比 clientWidth 宽就是放不下 —— 接下来该由
 *   阶梯收字，而不是由那层框把字挤掉。量完立刻把每段原来的行内 flex 写回去（一个字、一个类都不动 DOM
 *   里别的东西；量不到就先撤掉再量，最坏情况也只是回到「按当前收敛的样子量」这一条老路）。
 *
 * 为什么用行内样式量、而不是读每段自己的 scrollWidth：品牌那一段是行内元素（<span> 里只有文字），
 *   行内元素的 clientWidth 恒为 0，拿它与 scrollWidth 比永远比不出东西（这条 2026-09-24 实测过，
 *   写成那样等于把这条守卫关掉）。
 */
const capFoldFits = function (cap) {
  return capFoldMeasure(cap).fits
}
/**
 * 同上的量法，但把两个数一起交出来（2026-10-13 真机后加）：
 *   · fits —— 摆开后装不装得下（阶梯的放下判断）；
 *   · foot —— 摆开后的真实脚印（各段矩形宽 + 同行间距），也就是「完整那把尺子有多长」。
 * 为什么要多交出 foot：横滑模式那条判据（见 runCapFold 里的 capFoldRowScrolls）要问的是
 *   「连不折叠的完整一行都放不下吗」——那正是 foot > room，与 fits 同一次测量，别量两遍。
 */
const capFoldMeasure = function (cap) {
  try {
    const kids = Array.from(cap.children)
    const saved = kids.map(function (el) { return el.style.flex })
    try {
      for (let i = 0; i < kids.length; i++) kids[i].style.flex = '0 0 auto'
      void cap.offsetWidth
      // 2026-10-13（横滑实装后重定口径）：这里量的是**可见行**的内容脚印。
      //   从前比 cap.scrollWidth 与 cap.clientWidth —— 现在 cap 是可滑容器（.dsws-barcell，
      //   overflow-x:auto），而可滑容器的 scrollWidth 只报自己的框宽（内容被它自己的滚动区吞了），
      //   于是「放不下」永远判成「放得下」，阶梯一格都不走（真机上就是品牌那串字硬撑到极窄）。
      //   所以改成把每个孩子按 flex:0 0 auto 摆开，逐个读它的矩形宽再加间距 —— 这就是真实脚印。
      let total = 0
      let gaps = 0
      let prev = null
      let sameLine = true
      for (let i = 0; i < kids.length; i++) {
        const r = kids[i].getBoundingClientRect()
        if (!(r.width > 0)) continue
        if (prev !== null) {
          if (Math.abs(r.top - prev.top) < 2) { gaps++; if (sameLine) total += r.left - prev.right }
          else sameLine = false
        }
        total += r.width
        prev = r
      }
      if (prev === null) return { fits: true, foot: 0 }
      const cs = (cap.ownerDocument && cap.ownerDocument.defaultView)
        ? cap.ownerDocument.defaultView.getComputedStyle(cap) : null
      const pad = cs ? ((parseFloat(cs.paddingLeft) || 0) + (parseFloat(cs.paddingRight) || 0)) : 0
      const room = cap.clientWidth - pad
      void gaps
      return { fits: total <= room + 1, foot: total }
    } finally {
      for (let i = 0; i < kids.length; i++) kids[i].style.flex = saved[i]
    }
  } catch (e) {
    // 量不出来时不改判据：回到「这一条横条自己不溢出」这一条老路（宁可少收一点，也不要因为一次异常一路收到最后）
    return { fits: cap.scrollWidth <= cap.clientWidth + 1, foot: 0 }
  }
}
/**
 * 这一条现在是不是「整条转横滑」的形态：可见行（.dsws-barcell）已经有 468px 以上的可用宽。
 *
 * 468px 是研究票实测的阈值（票「窄屏阈值取证：载荷最小宽、各宽度停档与截断点」：胶囊外框 468 / 容器 500 起
 *   才轮到收字）。判据挂在**可见行自己的宽**上，不挂视口宽与设备型号 —— 右侧栏把列挤窄之后视口没变，
 *   但这条横条确实变窄了，那时候同样该走滑。
 */
const CAP_BAR_SCROLL_MIN_W = 468
const capFoldRowScrolls = function (cap) {
  try {
    const doc = cap.ownerDocument
    const win = doc && doc.defaultView
    const cs = win ? win.getComputedStyle(cap) : null
    const pad = cs ? ((parseFloat(cs.paddingLeft) || 0) + (parseFloat(cs.paddingRight) || 0)) : 0
    if ((cap.clientWidth - pad) >= CAP_BAR_SCROLL_MIN_W) return true
    // 2026-10-13 真机补的一条：手机上这条条的可用宽只有 370–400px（列就是手机那点宽），
    //   按 468 那条判不到，而它恰恰是最该走横滑的形态。研究票里「胶囊 468 起才轮到收字」说的是
    //   **桌上那条宽条**；手机竖屏是「一条装不下、就整条滑」的那一档（原型那三条设备线里手机线本来就是
    //   按视口宽 ≤ 679 分的）。所以这里补一条与设备线同口径的判据：视口宽 ≤ 679 就算横滑形态。
    //   桌面窗口（≥1024）与平板线不动：那里窄条的可用宽天然在 468 以上，照旧按实测宽判。
    const vw = win && (win.innerWidth || (doc.documentElement && doc.documentElement.clientWidth))
    return (Number(vw) || 0) > 0 && vw <= 679
  } catch (e) { return false }
}
/**
 * 这一条现在有多少**可用宽**：返回内容盒宽（孩子真正能摆下的那点宽）；量不到时返回 null（未知）。
 *
 * 为什么要专门一个函数、为什么不拿 clientWidth 直接比阈值：真机上「还没上屏」的那一帧里
 *   cap.clientWidth 是 12（＝左右内边距 6+6，加上边框 1+1 之外的那一圈），不是 0；
 *   而 cap.scrollWidth 是 417（九段字全展开时内容真的有那么宽）。12 与 417 一比，
 *   阶梯上每一档都判「放不下」，于是走到底档 —— 这正是 2026-09-24 那张真机截图的成因。
 *   所以三种「量不到」都要在这里认出来（任一命中就是未知）：
 *   ① 没上屏：不是文档里的节点、矩形宽或高为 0、display:none / visibility:hidden；
 *   ② 内容盒宽 ≤ 0：列宽还没定下来时胶囊只剩内边距那一圈，孩子一个都摆不下；
 *   ③ 拿不到计算样式（元素已摘下来）。
 * 放不放得下仍然用 scrollWidth 与 clientWidth 比（两者都是内边距盒口径，见上面那一句），
 *   本函数的返回值只用来判「这一趟的尺子有没有效」。
 */
const capFoldRoom = function (cap) {
  try {
    if (!cap || !cap.isConnected) return null
    const doc = cap.ownerDocument
    const win = doc && doc.defaultView
    if (!win || typeof win.getComputedStyle !== 'function') return null
    const cs = win.getComputedStyle(cap)
    if (!cs || cs.display === 'none' || cs.visibility === 'hidden') return null
    const rect = cap.getBoundingClientRect()
    // 2026-10-13：可见行还没上屏（宽高为 0）就是「量不到」——首帧不许据此判「放得下」。
    if (!(rect.width > 0) || !(rect.height > 0)) return null
    const pad = (parseFloat(cs.paddingLeft) || 0) + (parseFloat(cs.paddingRight) || 0)
    // 2026-10-13：这里量的是**可见行**（.dsws-barcell）的内容盒。它外头那层胶囊被藏起来时
    //   （门禁 I2 的 display:none 那一趟），行内的 display 仍是 flex、clientWidth 也可能非 0，
    //   所以要顺着包含块往上确认「这一行真的在版面上」，不然会把「没上屏」当成「可用宽很富余」。
    if (cap.clientWidth - pad <= 0) return null
    let node = cap
    while (node && node.nodeType === 1) {
      const pcs = win.getComputedStyle(node)
      if (pcs && (pcs.display === 'none' || pcs.visibility === 'hidden')) return null
      node = node.parentElement
    }
    const room = cap.clientWidth - pad
    if (!(room > 0)) return null
    return room
  } catch (e) { return null }
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
