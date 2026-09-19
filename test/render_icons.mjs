// 从 index.ux 的 CSS 里解析几何，把天气图标真的画出来
// 目的：图标是最容易"看着代码对、实际不像"的部分，必须眼见为实
import fs from 'fs'
import zlib from 'zlib'
import { iconFromKind } from '../src/common/wmo.js'

const SRC = '../src/pages/index/index.ux'
const sty = fs.readFileSync(SRC, 'utf8').match(/<style>([\s\S]*?)<\/style>/)[1]
                     .replace(/\/\*[\s\S]*?\*\//g, '')

// --- 解析 CSS 类 ---
const CSS = {}
for (const m of sty.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
  const body = m[2]
  const g = (p) => { const x = body.match(new RegExp('(?:^|;)\\s*' + p + '\\s*:\\s*([^;]+)')); return x ? x[1].trim() : null }
  for (const sel of m[1].split(',')) {
    const s = sel.trim()
    if (!/^\.[A-Za-z0-9_-]+$/.test(s)) continue
    CSS[s.slice(1)] = {
      left: g('left'), top: g('top'), width: g('width'), height: g('height'),
      radius: g('border-radius'), bg: g('background-color'), opacity: g('opacity'),
    }
  }
}
const pct = (v) => (v && v.endsWith('%')) ? parseFloat(v) / 100 : null
const num = (v) => (v && v.endsWith('px')) ? parseFloat(v) : null

// --- 画布 ---
let W, H, px
function init(w, h) { W = w; H = h; px = Buffer.alloc(W * H * 4, 0); for (let i = 0; i < W * H; i++) { px[i*4]=0x0B; px[i*4+1]=0x14; px[i*4+2]=0x20; px[i*4+3]=255 } }
function blend(x, y, r, g, b, a) {
  if (x < 0 || y < 0 || x >= W || y >= H || a <= 0) return
  const i = (y * W + x) * 4, na = a, ia = 1 - na
  px[i] = Math.round(px[i]*ia + r*na); px[i+1] = Math.round(px[i+1]*ia + g*na)
  px[i+2] = Math.round(px[i+2]*ia + b*na); px[i+3] = 255
}
function hex2rgb(h) { const v = parseInt(h.slice(1), 16); return [(v>>16)&255, (v>>8)&255, v&255] }

// 在给定矩形里画一个（圆角）矩形/椭圆
function shape(rect, radius, color, opacity) {
  const [r, g, b] = hex2rgb(color)
  const { x, y, w, h } = rect
  const ell = radius === '50%' || radius === '50% 50%'
  const rad = ell ? Math.min(w, h) / 2
    : (pct(radius) !== null ? pct(radius) * Math.min(w, h) : (num(radius) || 0))
  const aa = 1
  for (let yy = Math.floor(y - 1); yy <= Math.ceil(y + h + 1); yy++) {
    for (let xx = Math.floor(x - 1); xx <= Math.ceil(x + w + 1); xx++) {
      const cx = xx + 0.5, cy = yy + 0.5
      let inside, edge = 0
      if (ell) {
        const ex = w / 2, ey = h / 2
        const dx = (cx - (x + ex)) / ex, dy = (cy - (y + ey)) / ey
        const d = Math.sqrt(dx*dx + dy*dy)
        inside = d <= 1
        edge = Math.max(0, Math.min(1, (1 - d) * Math.min(ex, ey)))
      } else {
        // 圆角矩形：算到内缩矩形的距离
        const ix0 = x + rad, iy0 = y + rad, ix1 = x + w - rad, iy1 = y + h - rad
        const qx = Math.max(ix0 - cx, 0, cx - ix1)
        const qy = Math.max(iy0 - cy, 0, cy - iy1)
        const d = Math.sqrt(qx*qx + qy*qy)
        inside = cx >= x && cx <= x + w && cy >= y && cy <= y + h && d <= rad
        edge = Math.max(0, Math.min(1, rad - d + 0.5))
      }
      if (inside) blend(xx, yy, r, g, b, opacity === null || opacity === undefined ? 1 : parseFloat(opacity) * edge)
    }
  }
}

// 计算某个类在父矩形里的绝对矩形。
// 两套配方的写法不一样：.p-* 全是百分比（相对父框缩放），.s-* 全是整数像素
// （相对父框左上角偏移，不缩放）。40px 的框里百分比会落到小数上，真机算不对，
// 所以小图标改用像素 —— 这里也照着分开算，预览才和表盘一致。
function rect(cls, parent) {
  const c = CSS[cls]
  if (!c) throw new Error('缺少样式: .' + cls)
  const L = pct(c.left), T = pct(c.top), Wd = pct(c.width), Ht = pct(c.height)
  if (L !== null) {
    return { x: parent.x + L * parent.w, y: parent.y + T * parent.h, w: Wd * parent.w, h: Ht * parent.h, c }
  }
  return { x: parent.x + num(c.left), y: parent.y + num(c.top), w: num(c.width), h: num(c.height), c }
}

// 按模板里的 DOM 顺序绘制（顺序决定遮挡关系）。
// 云的四片（cloud + puff1..3）是图标框的直接子节点，顺序照抄模板。
// 后缀顺序两套一样，只有前缀不同。
const SUFFIX = ['glow','sun','sun-sm','cloud2','cloud','puff1','puff2','puff3',
                'drop1','drop2','drop3','flake1','flake2','flake3',
                'fog1','fog2','fog3','bolt','bolt2','bolt3']
const ORDER = (pre) => SUFFIX.map(s => pre + s)

// 部件开关：和模板里的 if= 一一对应。d1..d3 / f1..f3 / g1..g3 是 wmo.js 预先算好的
// 布尔（模板里不能写 ">" 比较，那个会让部件整个不渲染），这里也读布尔，不自己比大小 ——
// 预览和表盘必须走同一份判断，否则又是"预览好好的、表盘缺一块"。
function drawIcon(root, ic, pre) {
  const show = {
    glow: ic.glow, sun: ic.sun, 'sun-sm': ic.sunSm, cloud2: ic.cloud2,
    cloud: ic.cloud, puff1: ic.cloud, puff2: ic.cloud, puff3: ic.cloud,
    bolt: ic.bolt, bolt2: ic.bolt, bolt3: ic.bolt,
    drop1: ic.d1, drop2: ic.d2, drop3: ic.d3,
    flake1: ic.f1, flake2: ic.f2, flake3: ic.f3,
    fog1: ic.g1, fog2: ic.g2, fog3: ic.g3,
  }
  for (const cls of ORDER(pre)) {
    if (!show[cls.slice(pre.length)]) continue
    const rr = rect(cls, root)
    if (rr.c.bg) shape(rr, rr.c.radius, rr.c.bg, rr.c.opacity)
  }
}

// --- PNG ---
const T = (() => { const t = []; for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0 } return t })()
const crc = (b) => { let c = 0xFFFFFFFF; for (const x of b) c = T[(c ^ x) & 0xFF] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0 }
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length)
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const cr = Buffer.alloc(4); cr.writeUInt32BE(crc(td))
  return Buffer.concat([len, td, cr])
}
function save(file) {
  const raw = Buffer.alloc(H * (W * 4 + 1))
  for (let y = 0; y < H; y++) { raw[y * (W * 4 + 1)] = 0; px.copy(raw, y * (W * 4 + 1) + 1, y * W * 4, (y + 1) * W * 4) }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(W, 0); ihdr.writeUInt32BE(H, 4); ihdr[8] = 8; ihdr[9] = 6
  fs.writeFileSync(file, Buffer.concat([
    Buffer.from([0x89,0x50,0x4E,0x47,0x0D,0x0A,0x1A,0x0A]),
    chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0)),
  ]))
}

// --- 出图：每种天气一行，左 108px（主视觉）右 40px（预报） ---
// 配方直接取自项目里的 wmo.js，保证渲染结果==真实代码行为
const CASES = [
  ['晴', 'sun'], ['晴间多云', 'suncloud'], ['多云', 'cloud'], ['阴', 'overcast'],
  ['雾', 'fog'], ['毛毛雨', 'drizzle'], ['中雨', 'rain'], ['大雨', 'heavyrain'],
  ['雨夹雪', 'sleet'], ['小雪', 'snow'], ['大雪', 'heavysnow'], ['雷阵雨', 'thunder'],
].map(([n, k]) => [n, iconFromKind(k, 1)])

const CELL_H = 124, PAD = 12
init(360, CASES.length * CELL_H + PAD)
CASES.forEach(([name, ic], i) => {
  const y = i * CELL_H + PAD
  drawIcon({ x: 20, y: y + (108 - 108) / 2, w: 108, h: 108 }, ic, 'p-')   // 主视觉 108px（百分比）
  drawIcon({ x: 176, y: y + 34, w: 40, h: 40 }, ic, 's-')                 // 预报 40px（整数像素）
  // 分隔线
  for (let x = 0; x < W; x++) blend(x, y + CELL_H - 8, 0x1B, 0x29, 0x38, 1)
})
save('./icons.png')
console.log('icons.png 已生成')
CASES.forEach(([n], i) => console.log('  第' + (i + 1) + '行(自上而下): ' + n + '   左=108px 主视觉 / 右=40px 预报'))
