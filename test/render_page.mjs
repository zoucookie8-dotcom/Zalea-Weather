// 用 index.ux 的真实 CSS 数值渲染整页布局预览（432x514）
// 文字用实心块代替（无中文字体），但位置/尺寸/圆角/颜色都是 CSS 真值
import fs from 'fs'
import zlib from 'zlib'
import { iconFromKind } from '../src/common/wmo.js'

const SRC = '../src/pages/index/index.ux'
const sty = fs.readFileSync(SRC, 'utf8').match(/<style>([\s\S]*?)<\/style>/)[1].replace(/\/\*[\s\S]*?\*\//g, '')

const CSS = {}
for (const m of sty.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
  const body = m[2]
  const g = (p) => { const x = body.match(new RegExp('(?:^|;)\\s*' + p + '\\s*:\\s*([^;]+)')); return x ? x[1].trim() : null }
  for (const sel of m[1].split(',')) {
    const s = sel.trim(); if (!/^\.[A-Za-z0-9_-]+$/.test(s)) continue
    CSS[s.slice(1)] = { left: g('left'), top: g('top'), width: g('width'), height: g('height'),
      radius: g('border-radius'), bg: g('background-color'), color: g('color'),
      fs: g('font-size'), op: g('opacity'), mt: g('margin-top'), ml: g('margin-left'),
      pl: g('padding-left'), pr: g('padding-right') }
  }
}

const W = 432, H = 514
// 屏幕 514 高，但快应用只拿到 466：底部 48px 是系统保留区（模拟器实测，见 lint.mjs 注释）
const PAGE_H = 466
const px = Buffer.alloc(W * H * 4)
function init() { for (let i = 0; i < W * H; i++) { px[i*4]=0x0B; px[i*4+1]=0x14; px[i*4+2]=0x20; px[i*4+3]=255 } }
function blend(x, y, r, g, b, a) {
  if (x<0||y<0||x>=W||y>=H||a<=0) return
  const i=(y*W+x)*4, ia=1-a
  px[i]=Math.round(px[i]*ia+r*a); px[i+1]=Math.round(px[i+1]*ia+g*a); px[i+2]=Math.round(px[i+2]*ia+b*a); px[i+3]=255
}
const hex = (h) => { const v = parseInt(h.slice(1),16); return [(v>>16)&255,(v>>8)&255,v&255] }
function rr(x, y, w, h, rad, color, op) {
  const [r,g,b] = hex(color); const a = op===null||op===undefined?1:parseFloat(op)
  const R = rad === '50%' ? Math.min(w,h)/2
    : (!rad ? 0 : (String(rad).endsWith('px') ? parseFloat(rad) : parseFloat(rad)/100*Math.min(w,h)))
  for (let yy=Math.floor(y); yy<y+h; yy++) for (let xx=Math.floor(x); xx<x+w; xx++) {
    const cx=xx+0.5, cy=yy+0.5
    const qx=Math.max(x+R-cx,0,cx-(x+w-R)), qy=Math.max(y+R-cy,0,cy-(y+h-R))
    if (Math.sqrt(qx*qx+qy*qy) <= R) blend(xx,yy,r,g,b,a)
  }
}
// 文字用实心块代替：CJK 按 1.0em 宽，数字/字母按 0.55em
function text(x, y, s, size, color, align) {
  let w = 0
  for (const ch of s) w += (/[\u4e00-\u9fff\uff00-\uffef]/.test(ch) ? 1.0 : 0.55) * size
  const x0 = align === 'right' ? x - w : (align === 'center' ? x - w/2 : x)
  rr(x0, y + size*0.22, w, size*0.72, '12%', color)
  return w
}
function rect(cls, parent) {
  const c = CSS[cls]
  const P = (v, base, off) => v && v.endsWith('%') ? parseFloat(v)/100*base + (off||0) : (v?parseFloat(v):0)
  return { x: parent.x + P(c.left, parent.w), y: parent.y + P(c.top, parent.h), w: P(c.width, parent.w), h: P(c.height, parent.h), c }
}
// 两套配方：.ic-lg(108px) 用 p-*（百分比），.ic-sm(40px) 用 s-*（整数像素）。
// 云的四片（cloud + puff1..3）都是图标框的直接子节点 —— 以前把 puff 当成
// .p-cloud 的子节点来画，真机上那套嵌套在 40px 会散架，这里也照实平铺。
const SUFFIX = ['glow','sun','sun-sm','cloud2','cloud','puff1','puff2','puff3',
                'drop1','drop2','drop3','flake1','flake2','flake3',
                'fog1','fog2','fog3','bolt','bolt2','bolt3']
function drawIcon(root, ic, pre) {
  const show = { glow:ic.glow, sun:ic.sun, 'sun-sm':ic.sunSm, cloud2:ic.cloud2,
    cloud:ic.cloud, puff1:ic.cloud, puff2:ic.cloud, puff3:ic.cloud,
    bolt:ic.bolt, bolt2:ic.bolt, bolt3:ic.bolt,
    drop1:ic.d1, drop2:ic.d2, drop3:ic.d3,
    flake1:ic.f1, flake2:ic.f2, flake3:ic.f3,
    fog1:ic.g1, fog2:ic.g2, fog3:ic.g3 }
  for (const s of SUFFIX) {
    if (!show[s]) continue
    const r = rect(pre + s, root)
    if (r.c.bg) rr(r.x, r.y, r.w, r.h, r.c.radius, r.c.bg, r.c.op)
  }
}

init()

// 版面数值全部从 CSS 读，避免预览和真实代码脱节
const Hh = (n) => { const v = CSS[n] && CSS[n].height; return v && v.endsWith('px') ? parseFloat(v) : null }
const Mt = (n) => { const v = CSS[n] && CSS[n].mt; return v && v.endsWith('px') ? parseFloat(v) : 0 }

// hdr/row3/fc/ftr 是写死高度；body/hero 是 flex-grow，高度要按同级兄弟算出来：
//   .page: hdr / body(grow) / ftr        -> body = PAGE_H - hdr - ftr
//   .body: hero(grow) / row3 / fc        -> hero = body - row3 - fc
const hdrH = Hh('hdr'), rowH = Hh('row3'), cellH = Hh('cell')
const fcH = Hh('fc'), colH = Hh('fc-col'), ftrH = Hh('ftr')
const bodyH = PAGE_H - hdrH - ftrH
const heroH = bodyH - rowH - fcH
if (Hh('body') !== null || Hh('hero') !== null) {
  console.log('!! body/hero 不该写死高度（Vela 拿到的可绘制区比屏幕矮，写死会让底栏被裁）')
}
console.log('CSS 高度: hdr ' + hdrH + ' + body ' + bodyH + '(flex) + ftr ' + ftrH +
            ' = ' + (hdrH + bodyH + ftrH) + ' (可绘制 ' + PAGE_H + ')')
console.log('主体内部: hero ' + heroH + '(flex) + row3 ' + rowH + '(cell ' + cellH + ' +mt' + Mt('cell') + ')' +
            ' + fc ' + fcH + '(col ' + colH + ' +mt' + Mt('fc-col') + ') = ' + (heroH + rowH + fcH))

// ---- 顶栏 ----
rr(0, 0, W, hdrH, '0', '#0B1420')
text(24, 20, '上海', 26, '#FFFFFF')
text(W - 24, 24, 'Open-Meteo', 16, '#7FD1A0', 'right')

// ---- 主视觉 ----
const heroY = hdrH
drawIcon({ x: 30, y: heroY + (heroH - 108) / 2, w: 108, h: 108 }, iconFromKind('suncloud', 1), 'p-')
text(30 + 108 + 14, heroY + 40, '26', 96, '#FFFFFF')
text(30 + 108 + 14 + 118, heroY + 52, '°', 44, '#FFFFFF')
text(30 + 108 + 14, heroY + 140, '多云', 24, '#A9BDD4')

// ---- 三格详情 ----
const rowY = heroY + heroH
const cellW = (432 - 48 - 30) / 3
;['体感 33°', '湿度 58%', '风力 东北风2级'].forEach((s, i) => {
  const x = 24 + i * (cellW + 10)
  const y = rowY + Mt('cell')
  rr(x, y, cellW, cellH, '14px', '#131F2E')
  const [k, v] = s.split(' ')
  text(x + cellW / 2, y + 16, k, 16, '#7C90A8', 'center')
  text(x + cellW / 2, y + 38, v, 24, '#E8F0F9', 'center')
})

// ---- 预报 ----
const fcY = rowY + rowH
const fcW = (432 - 48 - 30) / 3
const days = [['明天', 'suncloud', 29, 23], ['后天', 'rain', 31, 21], ['大后天', 'overcast', 30, 22]]
days.forEach(([label, kind, mx, mn], i) => {
  const x = 24 + i * (fcW + 10)
  const y = fcY + Mt('fc-col')
  rr(x, y, fcW, colH, '14px', '#131F2E')
  text(x + fcW / 2, y + 8, label, 16, '#7C90A8', 'center')
  drawIcon({ x: x + fcW / 2 - 20, y: y + 30, w: 40, h: 40 }, iconFromKind(kind, 1), 's-')
  text(x + fcW / 2, y + 78, mx + '° / ' + mn + '°', 20, '#E8F0F9', 'center')
})

// ---- 底栏 ----
const ftrY = fcY + fcH
text(W / 2, ftrY + 18, '更新 11:38 · 点按刷新', 18, '#6F87A3', 'center')

// ---- 系统保留区（466 以下，快应用画不到）----
for (let y = PAGE_H; y < H; y++) for (let x = 0; x < W; x++) blend(x, y, 0, 0, 0, 1)
for (let x = 0; x < W; x++) blend(x, PAGE_H, 0x2A, 0x3A, 0x4A, 1)

// ---- 屏幕边界参考线 ----
for (let y = 0; y < H; y++) { blend(W-1, y, 0x2A, 0x3A, 0x4A, 1) }
for (let x = 0; x < W; x++) { blend(x, H-1, 0x2A, 0x3A, 0x4A, 1) }

// ---- PNG ----
const T=(()=>{const t=[];for(let n=0;n<256;n++){let c=n;for(let k=0;k<8;k++)c=c&1?0xEDB88320^(c>>>1):c>>>1;t[n]=c>>>0}return t})()
const crc=b=>{let c=0xFFFFFFFF;for(const x of b)c=T[(c^x)&0xFF]^(c>>>8);return (c^0xFFFFFFFF)>>>0}
const chunk=(ty,d)=>{const l=Buffer.alloc(4);l.writeUInt32BE(d.length);const td=Buffer.concat([Buffer.from(ty,'ascii'),d]);const c=Buffer.alloc(4);c.writeUInt32BE(crc(td));return Buffer.concat([l,td,c])}
const raw=Buffer.alloc(H*(W*4+1))
for(let y=0;y<H;y++){raw[y*(W*4+1)]=0;px.copy(raw,y*(W*4+1)+1,y*W*4,(y+1)*W*4)}
const ihdr=Buffer.alloc(13);ihdr.writeUInt32BE(W,0);ihdr.writeUInt32BE(H,4);ihdr[8]=8;ihdr[9]=6
fs.writeFileSync('./page.png', Buffer.concat([
  Buffer.from([0x89,0x50,0x4E,0x47,0x0D,0x0A,0x1A,0x0A]),
  chunk('IHDR',ihdr), chunk('IDAT',zlib.deflateSync(raw,{level:9})), chunk('IEND',Buffer.alloc(0))]))

console.log('page.png 已生成 432x514（466 以下涂黑 = 系统保留区）')
console.log('区块: 顶栏 0-' + hdrH + ' / 主视觉 ' + heroY + '-' + (heroY + heroH) +
            ' / 三格 ' + rowY + '-' + (rowY + rowH) + ' / 预报 ' + fcY + '-' + (fcY + fcH) +
            ' / 底栏 ' + ftrY + '-' + (ftrY + ftrH))
if (hdrH + bodyH + ftrH !== PAGE_H) console.log('!! 竖向溢出: ' + (hdrH + bodyH + ftrH) + ' != ' + PAGE_H)
if (heroH + rowH + fcH !== bodyH) console.log('!! 主体内部不等于 body')
if (ftrY + ftrH > PAGE_H) console.log('!! 底栏掉进系统保留区，会被裁掉')
console.log('三格单元宽 =', cellW.toFixed(1), ' 预报单元宽 =', fcW.toFixed(1))
