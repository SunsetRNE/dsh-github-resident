// statusbar/capFoldRuler.js — 状态栏那条横条的尺子（#74 从 capFoldMachine.js 搬出：那份叶子贴着 350 行粒度红线）
// 契约：模块真源（ESM 导出）；scripts/build.mjs 构建时剥行首 export，拼回 src/client/index.js
//   的 leaf 标记处（一源两物）。
//
// 这一台只读版面，不下结论、不写界面：交给阶梯机（statusbar/capFoldMachine.js）三样东西 ——
//   · capFoldRoom    —— 这一格现在有多少可用宽（量不到返回 null = 未知）；
//   · capFoldMeasure —— 这一档的脚印 foot（摆开后多宽）、装不装得下 fits、收光可收段之后的载荷脚印 payload；
//   · capFoldFits    —— 只看 fits（阶梯的放下判断）。
// #74（形态档）把 payload 加进来：形态判据（statusbar/barForm.js）第一问「收光了放得下吗」用的就是它 ——
//   与阶梯的放下判断同一次测量、同一把尺子，所以两条结论不可能各说各话。
// 为什么搬出来（行数账）：capFoldMachine.js 原本 347 行、贴着 350 行粒度红线（#73 的裁定：越过自己冻结值
//   的文件必须拆），#74 要往机器里加形态那一档，所以先把「量」这一半搬出来 —— 以后改尺子只改这一份。

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
 * 同上的量法，但把几个数一起交出来（2026-10-13 真机后加；#74 起多带一个载荷脚印）：
 *   · fits    —— 摆开后装不装得下（阶梯的放下判断）；
 *   · foot    —— 摆开后的真实脚印（各段矩形宽 + 同行间距），也就是「完整那把尺子有多长」；
 *   · payload —— 把可收的段（[data-fold-priority]）全收光之后的脚印（＝阶梯最后一档那把尺子）。
 * 这三个数**同一把尺子、同一次测量**：foot 与 fits 是阶梯的放下判断，payload 是形态判据的第一问
 *   （收光了放得下吗 —— 见 statusbar/barForm.js）。两者必须同尺，否则会出现「形态说全滑、阶梯说这一档
 *   放得下」那种自相矛盾的两条结论。
 * 载荷脚印为什么要临时把那些段 display:none 再量一遍，而不是拿某个常量比：
 *   票 #74 点名的病根就是「两条写死的像素线」（468 / 679）—— 收光之后的脚印是**量出来的**，
 *   计数位数、字体、刷新态换一枚图标都会让它变，写死的数字跟不上。这一遍只多一次布局读，
 *   **不多写一次 flex**（孩子们已经在下面那个 flex 写窗口里摆开了），所以 926 门禁的 flex 写次数一字不变。
 *   wantPayload 由调用方点名（一趟只需一次：stepper 走档时重复量没有意义）。
 */
const capFoldMeasure = function (cap, wantPayload) {
  try {
    const kids = Array.from(cap.children)
    const saved = kids.map(function (el) { return el.style.flex })
    const foldables = wantPayload ? Array.from(cap.querySelectorAll('[data-fold-priority]')) : []
    const savedDisplay = foldables.map(function (el) { return el.style.display })
    try {
      for (let i = 0; i < kids.length; i++) kids[i].style.flex = '0 0 auto'
      void cap.offsetWidth
      // 2026-10-13（横滑实装后重定口径）：这里量的是**可见行**的内容脚印。
      //   从前比 cap.scrollWidth 与 cap.clientWidth —— 现在 cap 是可滑容器（.dsws-barcell，
      //   overflow-x:auto），而可滑容器的 scrollWidth 只报自己的框宽（内容被它自己的滚动区吞了），
      //   于是「放不下」永远判成「放得下」，阶梯一格都不走（真机上就是品牌那串字硬撑到极窄）。
      //   所以改成把每个孩子按 flex:0 0 auto 摆开，逐个读它的矩形宽再加间距 —— 这就是真实脚印。
      const total = capFoldKidSpan(kids)
      let payload = 0
      if (foldables.length) {
        for (let i = 0; i < foldables.length; i++) foldables[i].style.display = 'none'
        // 这里刻意不再多写一句「逼重排」的读：下面那次逐段读矩形本身就是一次布局读
        //   （读 rect 前浏览器会把挂起的样式改动刷下去），量到的就是「收光之后」的版面。
        //   顺带也是门禁的锚点：全产物里这种「逼重排」的点只许有两处（verify-capsule-narrow 那条
        //   「写读不再交替」断言按次数守 #926 的单写路径），多一处就会把它判红。
        payload = capFoldKidSpan(kids)
      }
      if (total <= 0) return { fits: true, foot: 0, payload: payload }
      const cs = (cap.ownerDocument && cap.ownerDocument.defaultView)
        ? cap.ownerDocument.defaultView.getComputedStyle(cap) : null
      const pad = cs ? ((parseFloat(cs.paddingLeft) || 0) + (parseFloat(cs.paddingRight) || 0)) : 0
      const room = cap.clientWidth - pad
      return { fits: total <= room + 1, foot: total, payload: payload }
    } finally {
      for (let i = 0; i < foldables.length; i++) foldables[i].style.display = savedDisplay[i]
      for (let i = 0; i < kids.length; i++) kids[i].style.flex = saved[i]
    }
  } catch (e) {
    // 量不出来时不改判据：回到「这一条横条自己不溢出」这一条老路（宁可少收一点，也不要因为一次异常一路收到最后）。
    //   foot / payload 一并记 0 = 「这一趟没量到脚印」，形态判据据此返回未知、一个字都不写（见 barForm.js）。
    return { fits: cap.scrollWidth <= cap.clientWidth + 1, foot: 0, payload: 0 }
  }
}
/**
 * 这些孩子按各自本来宽度摆开后的总脚印（各段矩形宽 + 同行相邻两段之间的间距）。
 *   量不到的孩子（矩形宽 0：display:none 或已摘下来）跳过；一个都没量到时返回 0。
 * 为什么逐段读矩形、而不是比 scrollWidth：见 capFoldMeasure 上面那段（可滑容器的 scrollWidth 会骗人）。
 */
const capFoldKidSpan = function (kids) {
  let total = 0
  let prev = null
  let sameLine = true
  for (let i = 0; i < kids.length; i++) {
    const r = kids[i].getBoundingClientRect()
    if (!(r.width > 0)) continue
    if (prev !== null) {
      if (Math.abs(r.top - prev.top) < 2) { if (sameLine) total += r.left - prev.right }
      else sameLine = false
    }
    total += r.width
    prev = r
  }
  return prev === null ? 0 : total
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
