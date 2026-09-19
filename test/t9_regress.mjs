// 两个只在真机上才暴露出来的坑，各钉一颗钉子。
//
// 1) storage.get 的回执形状。文档写 success(data) 里 data.data 才是值，但这台表
//    直接把值本身递进来。loadCache 只认 {data:} 的话，读永远返回空，而 set 报成功
//    —— 表现是主页一切正常、缓存看着写了其实读不回来，预报页永远"还没有数据"。
//
// 2) 图标部件的布尔开关。模板里写 if="{{ic.drops > 0}}" 时，属性值里那个裸的 ">"
//    会让部件整个不渲染：毛毛雨的雨点一个像素都没有。所以 wmo.js 现在预先算好
//    d1..d3 / f1..f3 / g1..g3，模板只读布尔。
import * as W from './weather.js'
import * as wmo from './wmo.js'
import storage, { __setShape, __reset } from './sysstorage.js'

let fail = 0
const ok = (n, c, x) => { c ? console.log('  OK  ' + n) : (fail++, console.log('  FAIL ' + n + (x !== undefined ? ' -> ' + JSON.stringify(x) : ''))) }

console.log('=== 图标部件布尔开关与个数一致 ===')
const KINDS = ['sun', 'suncloud', 'cloud', 'overcast', 'fog', 'drizzle', 'rain',
               'heavyrain', 'sleet', 'snow', 'heavysnow', 'thunder', '没有这个kind']
const badBool = []
for (const k of KINDS) {
  for (const isDay of [1, 0]) {
    const ic = wmo.iconFromKind(k, isDay)
    for (const [cnt, pre] of [['drops', 'd'], ['flakes', 'f'], ['fog', 'g']]) {
      for (let n = 1; n <= 3; n++) {
        const want = ic[cnt] > (n - 1)
        if (ic[pre + n] !== want) badBool.push(`${k}/${isDay} ${pre}${n}=${ic[pre + n]} 应为 ${want}`)
      }
    }
  }
}
ok('d1..d3 / f1..f3 / g1..g3 与 drops/flakes/fog 一致', badBool.length === 0, badBool.slice(0, 4).join(' | '))

// 少一个部件就是某个天气少画一块，编译和静态检查都不会吭声
const PART_KEYS = ['sun', 'sunSm', 'glow', 'cloud', 'cloud2', 'bolt',
                   'd1', 'd2', 'd3', 'f1', 'f2', 'f3', 'g1', 'g2', 'g3']
const missing = []
for (const k of KINDS) {
  const ic = wmo.iconFromKind(k, 1)
  for (const key of PART_KEYS) if (!(key in ic)) missing.push(k + '.' + key)
}
ok('每种天气的配方都带齐了全部开关', missing.length === 0, missing.join(', '))

// 每种天气至少画出一块，否则表盘上是个空框
const blank = []
for (const k of KINDS) {
  for (const isDay of [1, 0]) {
    const ic = wmo.iconFromKind(k, isDay)
    const n = PART_KEYS.filter(p => ic[p] === true).length
    if (n === 0) blank.push(k + '/' + isDay)
  }
}
ok('每种天气至少有一个可见部件', blank.length === 0, blank.join(', '))

console.log('\n=== 缓存读写：两种 storage.get 回执形状都要认 ===')
const model = {
  city: '北京', src: 'open-meteo', ts: Date.now(),
  now: { temp: 27, text: '阴', kind: 'overcast', feels: 28, hum: 52, wd: '西南风', ws: 2, isDay: 1 },
  today: { max: 29, min: 21, text: '阴', kind: 'overcast' },
  forecast: [{ label: '今天', date: '09-19', max: 29, min: 21, text: '阴', kind: 'overcast', pop: 10, wd: '南风', ws: 2 }],
}

for (const shape of ['bare', 'wrapped']) {
  __reset()
  __setShape(shape)
  await W.saveCache(W.withIcons(JSON.parse(JSON.stringify(model))))
  const back = await W.loadCache()
  const good = back && back.now && back.now.temp === 27 && back.forecast && back.forecast.length === 1
  ok('形状 ' + shape + '：写进去能读回来', good, back ? JSON.stringify(back).slice(0, 60) : back)
  ok('形状 ' + shape + '：city 字段完整', !!back && back.city === '北京', back && back.city)
}

// 没写过的时候要返回 null，不能抛
__reset()
for (const shape of ['bare', 'wrapped']) {
  __setShape(shape)
  let r, threw = false
  try { r = await W.loadCache() } catch (e) { threw = true }
  ok('形状 ' + shape + '：没有缓存时返回 null 且不抛', !threw && r === null, String(r))
}

// 存量数据被写坏时（存了个不是 JSON 的字符串）要返回 null，不能把页面炸掉
__reset()
__setShape('bare')
storage.set({ key: 'weather_cache_v1', value: '这不是 JSON' })
let broken, bThrew = false
try { broken = await W.loadCache() } catch (e) { bThrew = true }
ok('缓存内容不是 JSON 时返回 null 且不抛', !bThrew && broken === null, String(broken))

// withIcons 会 mutate 传进来的对象，saveCache 存的是派生后的东西 —— 确认读回来仍能重算
__reset()
__setShape('bare')
const m2 = W.withIcons(JSON.parse(JSON.stringify(model)))
await W.saveCache(m2)
const back2 = await W.loadCache()
const m3 = W.withIcons(back2)
ok('读回来重算后 days 仍是 forecast 去掉今天的 3 天（这里只有 1 天，应为空）',
   Array.isArray(m3.days) && m3.days.length === 0, m3.days && m3.days.length)
ok('读回来重算后预报页的 rows 还在', W.forecastRows(m3).length === 1, W.forecastRows(m3).length)

console.log('\n=== 城市名也走同一套 unwrap ===')
__reset()
for (const shape of ['bare', 'wrapped']) {
  __setShape(shape)
  W.saveCityName('株洲')
  const name = await W.loadCityName()
  ok('形状 ' + shape + '：城市名能读回来', name === '株洲', name)
}

console.log('\n' + (fail ? '有 ' + fail + ' 项未通过' : '全部通过'))
process.exit(fail ? 1 : 0)
