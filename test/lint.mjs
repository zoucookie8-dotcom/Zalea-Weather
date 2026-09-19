// Vela .ux 静态检查：CSS 选择器合法性 / 类名对照 / 颜色 / 布局高度
import fs from 'fs'

const ROOT = '../'
const TMP = '.'
let fail = 0
const ok = (n, c, x) => { c ? console.log('  OK  ' + n) : (fail++, console.log('  FAIL ' + n + (x !== undefined ? ' -> ' + x : ''))) }

// 去掉 CSS 注释（之前的检查器忘做这步，导致带注释的规则被整条丢弃）
const stripComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '')

function rulesOf(sty) {
  const out = []
  const re = /([^{}]+)\{([^{}]*)\}/g
  let m
  while ((m = re.exec(stripComments(sty)))) out.push({ sel: m[1].trim(), body: m[2] })
  return out
}

// 声明查找：前面必须是行首或分号，否则找 height 会命中 line-height、找 width 会命中 min-width
function decl(rules, name, prop) {
  const r = rules.find(x => x.sel === '.' + name)
  if (!r) return null
  const m = r.body.match(new RegExp('(?:^|;)\\s*' + prop + '\\s*:\\s*([^;]+)'))
  return m ? m[1].trim() : null
}
const px = (v) => { const m = v && v.match(/^(\d+)px$/); return m ? +m[1] : null }
const pct = (v) => { const m = v && v.match(/^(\d+)%$/); return m ? +m[1] : null }

const PAGES = ['src/pages/index/index.ux', 'src/pages/city/city.ux', 'src/pages/forecast/forecast.ux']

for (const f of PAGES) {
  const src = fs.readFileSync(ROOT + f, 'utf8')
  console.log('\n=== ' + f + ' ===')

  const tpl = (src.match(/<template>([\s\S]*?)<\/template>/) || [])[1] || ''
  const scr = (src.match(/<script>([\s\S]*?)<\/script>/) || [])[1] || ''
  const sty = (src.match(/<style>([\s\S]*?)<\/style>/) || [])[1] || ''
  ok('三段式齐全', !!(tpl && scr && sty))

  const rules = rulesOf(sty)
  const sels = []
  for (const r of rules) for (const p of r.sel.split(',')) sels.push(p.trim())

  const badSel = sels.filter(s => {
    if (/::/.test(s)) return true
    if (/:(hover|active|focus|first-child|nth-child|last-child|checked|disabled)/.test(s)) return true
    if (/\[.*\]/.test(s)) return true
    if (/\*/.test(s)) return true
    if (/\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/.test(s)) return true
    if (/[>+~]/.test(s)) return true
    if (/[a-zA-Z0-9_\])\-]\s+[.#a-zA-Z]/.test(s)) return true
    return false
  })
  ok('无非法的 CSS 选择器', badSel.length === 0, badSel.join(' | '))
  const nonClass = sels.filter(s => !/^\.[A-Za-z0-9_-]+$/.test(s))
  ok('选择器全是单类名', nonClass.length === 0, nonClass.join(' | '))

  const cols = [...sty.matchAll(/(?:^|[\s;{])(?:color|background-color|border-bottom-color|border-color)\s*:\s*([^;}\n]+)/g)].map(m => m[1].trim())
  const badCol = cols.filter(c => !/^#[0-9a-fA-F]{6}$/.test(c))
  ok('颜色值全是合法 6 位十六进制', badCol.length === 0, badCol.join(' | '))

  const poss = [...sty.matchAll(/position\s*:\s*([^;}\n]+)/g)].map(m => m[1].trim())
  ok('position 只用 relative/absolute', poss.every(p => p === 'relative' || p === 'absolute'), poss.join(','))

  // Vela 的 width:100% 是 content-box：padding 不算在宽度里，会把元素撑出屏幕。
  // 实测 width:100%(432) + padding 0 24px 的元素占 480px，右侧 48px 被裁掉。
  // 所以：宽度写 100% 的元素不许有左右 padding；要留白就用 margin-left + 显式宽度。
  const boxBad = []
  for (const r of rules) {
    if (pct(decl([r], r.sel.slice(1), 'width')) !== 100) continue
    for (const p of ['padding-left', 'padding-right', 'padding']) {
      const v = decl([r], r.sel.slice(1), p)
      if (v && px(v) !== 0) boxBad.push(r.sel + ' 有 ' + p + ':' + v)
    }
  }
  ok('width:100% 的元素没有左右 padding（content-box 会撑出屏幕）', boxBad.length === 0, boxBad.join(' | '))

  const used = [...tpl.matchAll(/class="([^"]+)"/g)].map(m => m[1].trim())
  const multi = used.filter(v => v.includes(' '))
  ok('元素上没有多类名（Vela 不支持 .a.b）', multi.length === 0, multi.join(' | '))

  const defined = new Set(sels.filter(s => /^\.[A-Za-z0-9_-]+$/.test(s)).map(s => s.slice(1)))
  const undef = [...new Set(used)].filter(c => !defined.has(c))
  ok('模板里用到的类都有样式', undef.length === 0, undef.join(', '))
  const unused = [...defined].filter(c => !used.includes(c))
  if (unused.length) console.log('  note 定义了但没用到的类: ' + unused.join(', '))

  // 图标部件：每个图标块里都得把整套部件写全。
  // 漏一个不会报错，只会让某种天气的图标缺一块 —— 预报行的图标就漏过雾，
  // 雾天那一格是个空框，静态检查和编译都不会吭声。
  //
  // 两套配方，按图标块大小分：
  //   .ic-lg (108px) 用 .p-*，几何是百分比；
  //   .ic-sm ( 40px) 用 .s-*，几何是整数像素。
  // 40px 上百分比会散架（Vela 在 40px 的框里算百分比几何会错位+裁剪，实测
  // 20 个部件只剩 2 个画出来，还都被右边缘切掉），所以小图标单独一套。
  // 因此这里按前缀分别查：一个 .ic-lg 块里不该出现 s-*，反之亦然。
  const PREFIX = { 'ic-lg': 'p-', 'ic-sm': 's-' }
  const marks = [...tpl.matchAll(/class="(ic-(?:lg|sm))"/g)]
  if (marks.length > 0) {
    const bad = []
    const suffixSets = {}
    for (let i = 0; i < marks.length; i++) {
      const cls = marks[i][1], pre = PREFIX[cls]
      const from = marks[i].index
      const to = i + 1 < marks.length ? marks[i + 1].index : tpl.length
      const piece = tpl.slice(from, to)
      const seen = {}
      for (const m of piece.matchAll(/class="([ps]-[A-Za-z0-9_-]+)"/g)) seen[m[1]] = (seen[m[1]] || 0) + 1
      const want = sels.filter(s => s.startsWith('.' + pre)).map(s => s.slice(1))
      const suf = new Set()
      for (const c of want) {
        suf.add(c.slice(2))
        const n = seen[c] || 0
        if (n !== 1) bad.push(cls + ' 第' + (i + 1) + '块缺 ' + c + '（出现 ' + n + ' 次）')
      }
      const strays = Object.keys(seen).filter(c => !c.startsWith(pre))
      if (strays.length) bad.push(cls + ' 第' + (i + 1) + '块混进了别的配方: ' + strays.join(','))
      suffixSets[cls] = suf
    }
    ok('每个图标部件在每个图标块里都写全了（共 ' + marks.length + ' 块：' +
       marks.map(m => m[1]).join(',') + '）', bad.length === 0, bad.join(' | '))

    // 两套配方的部件名要对得上：小图标少写一条规则，那个部件在预报页就是空的，
    // 而主页（用 p-*）看着完全正常 —— 最容易漏的就是这种只坏一半的。
    const pl = [...(suffixSets['ic-lg'] || [])].sort().join(',')
    const sm = [...(suffixSets['ic-sm'] || [])].sort().join(',')
    if (suffixSets['ic-lg'] && suffixSets['ic-sm']) {
      ok('大小两套配方的部件名完全一致（各 ' + suffixSets['ic-lg'].size + ' 个）', pl === sm,
         'p: ' + pl + '  vs  s: ' + sm)
    }
  }

  // 模板表达式里不许出现比较运算符。
  //
  // 属性值里一个裸的 ">"（如 if="{{ic.drops > 0}}"）在这台表上会让整个部件
  // 一个像素都不画：毛毛雨、小雨的雨点就是这么丢的，而同一份配方里没有 ">" 的
  // cloud 都正常。缺件是静默的 —— 编译过、lint 过、只有盯着表盘才看得出来。
  // 要比较就在 JS 里算好布尔值再传进来（wmo.js 的 d1..d3 / f1..f3 / g1..g3）。
  const cmp = [...tpl.matchAll(/\{\{([^}]*)\}\}/g)]
    .map(m => m[1].trim())
    .filter(e => /[<>]/.test(e))
  ok('模板表达式里没有比较运算符（裸 ">" 会让部件整个不渲染）', cmp.length === 0,
     cmp.join(' | '))

  // 脚本语法（当 ES module 解析）——导出到 job 的 tmp，别往用户主目录扔文件
  const out = TMP + '/_chk_' + f.split('/').pop().replace(/\.ux$/, '.mjs')
  fs.writeFileSync(out, scr)
  console.log('  note script 已导出: ' + out)
}

console.log('\n=== 布局高度 ===')

// 屏幕 LCD 是 432x514，但快应用实际只拿到 432x466：底部约 48px 被系统占掉。
// 模拟器上把页面涂红、底栏涂绿实测过 —— 红色只到 y=458，绿色只露出 8px，y>=467 全黑。
// 所以任何"按 514 排满"的写死布局，底栏都会掉出可视区。
const DRAW_H = 466

const idx = fs.readFileSync(ROOT + 'src/pages/index/index.ux', 'utf8')
const ir = rulesOf(idx.match(/<style>([\s\S]*?)<\/style>/)[1])
const H = (n) => px(decl(ir, n, 'height'))
const GR = (n) => decl(ir, n, 'flex-grow')

// 写死高度的行：高度必须是确定的 px
for (const [k, label] of [['hdr', '顶栏'], ['row3', '详情行'], ['fc', '预报行'], ['ftr', '底栏']]) {
  console.log('  ' + label + ' .' + k + ' = ' + H(k) + 'px')
  ok('.' + k + ' 有确定的 px 高度', H(k) !== null, decl(ir, k, 'height'))
}

// 吸收剩余高度的行：必须 flex-grow:1 且不能同时写死高度
for (const k of ['body', 'hero', 'empty']) {
  ok('.' + k + ' 用 flex-grow 吸收剩余高度（不写死）', GR(k) === '1' && H(k) === null,
     'flex-grow=' + GR(k) + ' height=' + H(k))
}

// flex-grow 分到多少，要看它和哪些兄弟同级 —— 不能把两层写死的行加在一起算：
//   .page 的子元素: hdr / body(grow) / ftr      -> body = 466 - 64 - 56 = 346
//   .body 的子元素: hero(grow) / row3 / fc      -> hero = 346 - 92 - 116 = 138
const pageFixed = H('hdr') + H('ftr')
const bodyH = DRAW_H - pageFixed
console.log('  页面级写死: hdr ' + H('hdr') + ' + ftr ' + H('ftr') + ' = ' + pageFixed +
            ' -> .body(同级兄弟里唯一 grow) 分到 ' + bodyH + 'px')
ok('页面级写死行合计不超过可绘制高 ' + DRAW_H, pageFixed < DRAW_H, pageFixed)

const bodyFixed = H('row3') + H('fc')
const heroH = bodyH - bodyFixed
console.log('  .body 内写死: row3 ' + H('row3') + ' + fc ' + H('fc') + ' = ' + bodyFixed +
            ' -> .hero 分到 ' + heroH + 'px')
ok('.body 内写死行合计不超过 .body 高度', bodyFixed < bodyH, bodyFixed + ' >= ' + bodyH)
ok('hero 分到的高度不小于大图标 ' + H('ic-lg') + 'px，图标不会被压扁',
   heroH >= H('ic-lg'), heroH + ' < ' + H('ic-lg'))

// 卡片高 + margin-top 不能超出所在行容器，否则卡片会被压扁/溢出
const MT = (n) => px(decl(ir, n, 'margin-top')) || 0
for (const [row, card, label, next] of
     [['row3', 'cell', '详情行', 'fc-col'], ['fc', 'fc-col', '预报行', null]]) {
  const fit = H(card) + MT(card)
  ok(label + ' 卡片(' + H(card) + '+mt' + MT(card) + '=' + fit + ') 不超过容器 ' + H(row),
     fit <= H(row), fit + ' > ' + H(row))
  // 真正的视觉间距 = 上一行卡片下沿 到 下一行卡片上沿。
  // 上一行容器底部还剩 (行高 - 卡片高 - 上边距) 的留白，再加上下一行卡片自己的上边距。
  if (next) {
    const gap = (H(row) - fit) + MT(next)
    console.log('  note ' + label + ' 卡片下沿 -> 下一行卡片上沿 的间距 = ' + gap + 'px')
    ok(label + '与下一行卡片之间有可见间距（>0）', gap > 0, gap + 'px')
  }
}

const city = fs.readFileSync(ROOT + 'src/pages/city/city.ux', 'utf8')
const cr = rulesOf(city.match(/<style>([\s\S]*?)<\/style>/)[1])
const CH = (n) => px(decl(cr, n, 'height'))
const CGR = (n) => decl(cr, n, 'flex-grow')
const CFIXED = [['hdr', 64], ['searchbar', 68], ['ftr', 60]]
let csum = 0
for (const [k] of CFIXED) { csum += CH(k) || 0 }
console.log('  城市页写死行: ' + CFIXED.map(([k]) => k + ' ' + CH(k)).join(' + ') + ' = ' + csum + 'px')
ok('城市页 .lst 用 flex-grow 吸收剩余高度（不写死）', CGR('lst') === '1' && CH('lst') === null,
   'flex-grow=' + CGR('lst') + ' height=' + CH('lst'))
ok('城市页写死行合计不超过可绘制高 ' + DRAW_H, csum < DRAW_H, csum)
console.log('  城市页列表分到 ' + (DRAW_H - csum) + 'px')

// 搜索框要能放进搜索栏，且宽度不超出留白后的可用宽
const srchW = px(decl(cr, 'srch', 'width')), srchML = px(decl(cr, 'srch', 'margin-left'))
const barW = px(decl(cr, 'searchbar', 'width'))
ok('搜索框(' + CH('srch') + ') 不高于搜索栏(' + CH('searchbar') + ')', CH('srch') <= CH('searchbar'))
ok('搜索框宽度 ' + (srchML + srchW) + ' 不超出搜索栏 ' + barW, srchML + srchW <= barW,
   (srchML + srchW) + ' > ' + barW)

const fcPage = fs.readFileSync(ROOT + 'src/pages/forecast/forecast.ux', 'utf8')
const fr = rulesOf(fcPage.match(/<style>([\s\S]*?)<\/style>/)[1])
const FH = (n) => px(decl(fr, n, 'height'))
const FGR = (n) => decl(fr, n, 'flex-grow')
const fsum = FH('hdr') + FH('ftr')
console.log('  预报页写死行: hdr ' + FH('hdr') + ' + ftr ' + FH('ftr') + ' = ' + fsum + 'px')
ok('预报页 .lst 用 flex-grow 吸收剩余高度（不写死）', FGR('lst') === '1' && FH('lst') === null,
   'flex-grow=' + FGR('lst') + ' height=' + FH('lst'))
ok('预报页写死行合计不超过可绘制高 ' + DRAW_H, fsum < DRAW_H, fsum)

// 每行内部各块横着排，加起来不能超过行宽，否则右边的高低温会被挤出去
const rowW = px(decl(fr, 'li', 'width'))
const innerW = px(decl(fr, 'li-d', 'width')) + px(decl(fr, 'ic-sm', 'width'))
ok('预报行内左侧块 + 图标(' + innerW + ') 给中/右两块留了空间', innerW < rowW, innerW + ' >= ' + rowW)

// 7 天 × 行高必然超过列表可视高 —— 这是有意的，靠 <list> 滚动。
// 但行高不能小到读不清。
const listH = DRAW_H - fsum
console.log('  预报页列表可视 ' + listH + 'px，每行 ' + FH('li') + 'px -> 一屏约 ' +
            Math.floor(listH / FH('li')) + ' 行，其余滚动')
ok('预报行高不低于 56px（再小两行字就挤了）', FH('li') >= 56, FH('li'))

// 所有页面里带 margin-left 的定宽块，右边缘都不能越界
for (const [file, rules, W] of [['index', ir, 432], ['city', cr, 432], ['forecast', fr, 432]]) {
  const over = []
  for (const r of rules) {
    const w = px(decl([r], r.sel.slice(1), 'width'))
    const ml = px(decl([r], r.sel.slice(1), 'margin-left'))
    if (w === null || ml === null) continue
    if (ml + w > W) over.push(r.sel + ' ' + ml + '+' + w + '=' + (ml + w) + ' > ' + W)
  }
  ok(file + '.ux 定宽块没有越出屏幕右边', over.length === 0, over.join(' | '))
}

console.log('\n' + (fail ? '有 ' + fail + ' 项未通过' : '全部通过'))
process.exit(fail ? 1 : 0)
