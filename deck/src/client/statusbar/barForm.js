// statusbar/barForm.js — 状态栏那条横条的「形态档」判据（#74；纯函数，这一条横条只许有一个形态结论）
// 契约：模块真源（ESM 导出）；scripts/build.mjs 构建时剥行首 export，拼回 src/client/index.js
//   的 leaf 标记处（一源两物）。
//
// 为什么要有这一台（#74 的现状）：形态过去是**两条写死的像素线 OR 出来的** ——
//   「那一格可用宽 ≥ 468」或「视口宽 ≤ 679」就判成横滑形态，落在一个类名 `.dsws-bar-scroll` 上；
//   而这个类名还有**第二个写入者**（statusbar/barScroll.js 按「当前有没有可滑量」写它）。
//   两条判据不同尺（一条量那一格、一条量视口），还会互相覆盖，于是：
//     · 手机上「一个档都不走、全靠滑」是 679 那条 OR 的副作用，不是写出来的一档；
//     · 视口 1440 而那一格 420 时，判据读的是视口 —— 两把尺，量出来的不是同一件事；
//     · 阶梯一收字，内容不再溢出 → 另一个写入者把类撤掉 → 字被压扁（真机症状，见 capFoldMachine 里那条注释）。
//
// 这一台只回答一个问题：**这一格现在该是哪一档形态**。判据全部来自同一把尺子（那一格自己），
//   三个数都在 capFoldMachine 里量：
//   · room    —— 那一格的内容盒宽（孩子真正能摆下的那点宽；capFoldRoom 的返回值）
//   · payload —— 把可收的段（[data-fold-priority]）**全收光**之后的脚印（＝阶梯最后一档的脚印）
//   · tier    —— 阶梯走完停在的档号（第 0 档 = 一段字都没收；还没走完就是未知）
//
// 三档（票面点名的那三态）：
//   · flat   全展不滑：完整一行放得下 → 第 0 档、不加滑窗开关；
//   · fold   先收后滑：放不下、但**收光了放得下** → 交给阶梯收字；开关落上（各段从此不被 flex 压扁），
//             真收了还有余下溢出的话由滑窗接住；
//   · scroll 全滑不收：**收光了也放不下** → 一个档都不走（字全摊开），整条交给滑窗。
//   第四态（票面允许留白的那一个：「只滑不收但保留图标与数字」）**不写** —— 它就是「收到底仍放不下」
//   的现状，正是维护者 2026-10-13 真机后否掉的那一态（字被图标替代、字该滑出去不该被收掉）。
//
// 阈值不写死（票面要求）：这里没有像素常量、没有设备型号、没有 matchMedia、不读视口 ——
//   三档的边界全部是上面两个测量值之比（「收光了放不下吗」这一问，以及「是不是停在第 0 档」）。
//   研究与真机实测出来的那条「硬地板：胶囊外框 437px / 容器 469px」
//   （deck/docs/research/2026-10-12-toolbar-narrow-threshold.md 第三、六、八节：载荷档尺子 436px）
//   于是成为这台机器**量出来的**结果，而不是一个抄进代码的数字。
//
// 三档的期望形态（照上面的判据按真机几何算出来的；列宽 → 胶囊外框 → 那一格 room：
//   胶囊 = min(列宽 − 2×16, 卡宽上限 712)，room = 胶囊 − 2 边框 − 12 内边距）：
//   · 手机竖屏（列宽 393 → room 347）：**scroll** —— 载荷 436 都放不下，收字只会把字换成图标；
//   · 平板分屏（列宽 512 → room 466）：**fold** —— 载荷放得下、完整一行（≈822）放不下，收字有得收；
//   · 平板竖屏 / 横屏（列宽 768 / 1024 → 胶囊封顶 712 → room 698）：**fold**（同上）；
//   · 桌面宽列（列宽 ≥ 1240 → 胶囊 > 823 → room > 821）：**flat** —— 完整一行放得下，一段都不收；
//   · 窄列（视口 1440、那一格 420 → room 406）：**scroll** —— 按那一格判，不按视口判。
//   （上面的 room 换算里「载荷 436 / 完整一行 822」两个数是研究票实测值，只作旁证：线上判据用的是
//     capFoldMeasure 当场量出来的两个脚印，不含任何写死的数。）
export const BAR_FORM_FLAT = 'flat'
export const BAR_FORM_FOLD = 'fold'
export const BAR_FORM_SCROLL = 'scroll'
// 这一条横条上那个「横滑形态」开关的类名。**只有形态结论的持有者（capFoldMachine）写它**；
//   barScroll.js 只读不写（它过去那句 toggle 是第二个写入者，见本文件上面那段）。
export const BAR_FORM_CLASS = 'dsws-bar-scroll'
// 容差与 capFoldFits 同一个（那边也是 +1）：形态的边界必须与阶梯自己的「放得下」判据一字不差，
//   否则会出现「形态说全滑、阶梯说这一档放得下」这种自相矛盾的两条结论。
const BAR_FORM_TOL_PX = 1
/**
 * 形态第一问：**把可收的段全收光之后，放得下吗**（＝折叠救不救得了这一格）。
 *   room    —— 那一格的内容盒宽；payload —— 收光后的脚印（两者都来自 capFoldMachine 的同一把尺子）。
 * 返回 true（收光了放得下 → 折叠有得收）/ false（收光了也放不下 → 折叠救不了）/ null（这一趟没量到 → 未知）。
 * 为什么未知要单独return：量不到有效脚印的那一趟不许下任何结论（#725 那条老规矩，见 capFoldMachine 文件头）。
 */
export const barFormFoldsFit = function (room, payload) {
  const r = Number(room) || 0
  const p = Number(payload) || 0
  if (!(r > 0) || !(p > 0)) return null
  return p <= r + BAR_FORM_TOL_PX
}
/**
 * 形态档：由上面那一问加阶梯的落点定。data = { foldsFit, tier }：
 *   foldsFit —— barFormFoldsFit 的返回值（true / false / null）
 *   tier     —— 阶梯走完停在的档号；还没走完传 null / undefined（那时只可能给出「全滑不收」这一支）
 * 返回 { form, barScroll, spread }：
 *   form     三档之一，或空串（还没有结论 —— 调用方一个字都不许写）；
 *   barScroll 那个横滑开关该不该落（fold / scroll 都为真：形态允许溢出到滑窗里，各段不许被 flex 压扁）；
 *   spread   要不要走「一个字都不收」这一支（全滑不收：把字全摊开、跳过整条阶梯）。
 */
export const barFormOf = function (data) {
  const d = data || {}
  if (d.foldsFit === false) return { form: BAR_FORM_SCROLL, barScroll: true, spread: true }
  const tier = Number(d.tier)
  if (!(tier >= 0)) return { form: '', barScroll: false, spread: false }
  if (tier === 0) return { form: BAR_FORM_FLAT, barScroll: false, spread: false }
  return { form: BAR_FORM_FOLD, barScroll: true, spread: false }
}
