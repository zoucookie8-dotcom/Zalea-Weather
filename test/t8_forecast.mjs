// 7 天预报：字段、日期/星期、主页预报条的派生、兜底源的空态
//
// 这里刻意不重用 weather.js 内部的时间换算，而是用"UTC 时间 +8 小时"独立算一遍
// 上海的今天 —— 如果哪天有人把 dayMeta 改成 new Date('2026-09-19')，
// 那个按 UTC 解析、getDay() 随本地时区偏移的写法就会在这里露馅。
import * as W from './weather.js'
import cities from './cities.js'

let fail = 0
const ok = (n, c, x) => { c ? console.log('  OK  ' + n) : (fail++, console.log('  FAIL ' + n + (x !== undefined ? ' -> ' + JSON.stringify(x) : ''))) }

const pad = (n) => (n < 10 ? '0' + n : '' + n)
const WEEK = ['周日', '周一', '周二', '周三', '周四', '周五', '周六']

// 上海（UTC+8）第 offset 天的日期串和星期，全程走 UTC，不碰本地时区
function shDay(offset) {
  const d = new Date(Date.now() + 8 * 3600 * 1000 + offset * 86400000)
  return { s: pad(d.getUTCMonth() + 1) + '-' + pad(d.getUTCDate()), dow: d.getUTCDay() }
}

const c = cities.find(x => x.n === '上海')
const m = W.withIcons(await W.fetchWeather(c))

console.log('=== 结构 ===')
ok('源是 open-meteo', m.src === 'open-meteo', m.src)
ok('forecast 有 7 天', m.forecast && m.forecast.length === 7, m.forecast && m.forecast.length)
ok('预报页的 rows 有 7 行', W.forecastRows(m).length === 7, W.forecastRows(m).length)

const fc = m.forecast || []
// 打的是预报页真正要显示的那套文案（forecastRows 的产物），不是原始字段
console.log('  ' + W.forecastRows(m).map(r => (r.label + ' ' + r.date).padEnd(11) +
  r.text.padEnd(6) + r.range.padEnd(12) + r.popText).join('\n  '))

console.log('\n=== 日期与星期 ===')
ok('第 1 天标"今天"', fc[0] && fc[0].label === '今天', fc[0] && fc[0].label)
ok('第 2 天标"明天"', fc[1] && fc[1].label === '明天', fc[1] && fc[1].label)
ok('第 3 天标"后天"', fc[2] && fc[2].label === '后天', fc[2] && fc[2].label)

const badDate = [], badDow = []
for (let i = 0; i < fc.length; i++) {
  if (fc[i].date !== shDay(i).s) badDate.push(i + ':' + fc[i].date + '≠' + shDay(i).s)
  // 第 4 天起显示星期几
  if (i >= 3 && fc[i].label !== WEEK[shDay(i).dow]) {
    badDow.push(i + ':' + fc[i].label + '≠' + WEEK[shDay(i).dow])
  }
}
ok('7 天日期从"上海的今天"起连续', badDate.length === 0, badDate.join(' '))
ok('第 4 天起显示星期几且与日期相符', badDow.length === 0, badDow.join(' '))
ok('日期都是 MM-DD 形式', fc.every(d => /^\d{2}-\d{2}$/.test(d.date)),
   fc.map(d => d.date).join(','))

console.log('\n=== 每天的数据是否合理 ===')
ok('每天都有天气文字', fc.every(d => typeof d.text === 'string' && d.text.length > 0))
ok('每天都有 kind', fc.every(d => typeof d.kind === 'string' && d.kind.length > 0))
ok('最高温 >= 最低温', fc.every(d => d.max >= d.min),
   fc.filter(d => d.max < d.min).map(d => d.date).join(','))
ok('温度是整数且在合理范围', fc.every(d => Number.isInteger(d.max) && Number.isInteger(d.min) &&
   d.max > -60 && d.max < 60 && d.min > -70 && d.min < 50))
ok('降水概率要么是 null 要么在 0..100', fc.every(d => d.pop === null || (Number.isInteger(d.pop) && d.pop >= 0 && d.pop <= 100)),
   fc.map(d => d.pop).join(','))
ok('风力要么是 null 要么在 0..12 级', fc.every(d => d.ws === null || (Number.isInteger(d.ws) && d.ws >= 0 && d.ws <= 12)),
   fc.map(d => d.ws).join(','))
ok('每天都算出了图标配方', fc.every(d => d.ic && typeof d.ic === 'object'))

console.log('\n=== 主页那条预报条是派生出来的 ===')
ok('days 是 forecast 去掉今天后的 3 天', m.days.length === 3, m.days.length)
ok('days[0] 就是 forecast[1]', m.days[0] && fc[1] && m.days[0].date === fc[1].date && m.days[0].label === '明天')
ok('days 里不含今天', m.days.every(d => d.label !== '今天'), m.days.map(d => d.label).join(','))
ok('days 每一项也带图标', m.days.every(d => d.ic && typeof d.ic === 'object'))

console.log('\n=== forecastRows 的文案 ===')
const rows = W.forecastRows(m)
ok('range 形如 "30° / 25°"', /^-?\d+° \/ -?\d+°$/.test(rows[0].range), rows[0].range)
ok('popText 含"降水"', rows[0].popText.indexOf('降水') === 0, rows[0].popText)
ok('没风时不留下孤零零的分隔符', rows.every(r => r.popText.indexOf('·') !== 0 &&
   !/·\s*$/.test(r.popText)), rows.map(r => r.popText).join(' | '))
ok('每行都有 label/date/text', rows.every(r => r.label && r.date && r.text))

console.log('\n=== 雾天的图标不能是空的 ===')
// wmo.js 里 fog 只画三根横杠、不画云。预报行的图标块漏过这三个部件，
// 结果是雾天那一格一个像素都没有 —— 编译和静态检查都不会报。
const fog = W.withIcons({
  city: 'X', src: 'open-meteo', ts: Date.now(),
  now: { temp: 5, text: '雾', kind: 'fog', feels: 3, hum: 95, wd: '北风', ws: 1, isDay: 1 },
  forecast: [{ label: '今天', date: '01-01', max: 6, min: 1, text: '雾', kind: 'fog', pop: 10, wd: '北风', ws: 1 }],
})
const frow = W.forecastRows(fog)[0]
const visible = ['sun', 'sunSm', 'glow', 'cloud', 'cloud2', 'bolt'].filter(k => frow.ic[k]).length +
                frow.ic.drops + frow.ic.flakes + frow.ic.fog
ok('雾天图标至少有一个可见部件', visible > 0, JSON.stringify(frow.ic))
ok('雾天用的是 fog 部件', frow.ic.fog === 3, frow.ic.fog)

console.log('\n=== 兜底源（中国天气网）没有多日预报 ===')
const cn = W.withIcons({
  city: '株洲', src: 'cn', ts: Date.now(),
  now: { temp: 23, text: '多云', kind: 'suncloud', feels: null, hum: 83, wd: '西风', ws: 1, isDay: 1 },
  today: { max: 29, min: 22, text: '多云', kind: 'suncloud' },
  forecast: [],
})
ok('forecast 为空数组', Array.isArray(cn.forecast) && cn.forecast.length === 0)
ok('days 兜成空数组而不是 undefined', Array.isArray(cn.days) && cn.days.length === 0, cn.days)
ok('forecastRows 返回空数组', W.forecastRows(cn).length === 0)
ok('无 forecast 字段的模型也不炸', (() => {
  try {
    const q = W.withIcons({ now: { temp: 1, text: '晴', kind: 'sun', isDay: 1 } })
    return Array.isArray(q.days) && q.days.length === 0 && W.forecastRows(q).length === 0
  } catch (e) { return false }
})())

console.log('\n=== 旧缓存（没有 forecast 字段）要能读 ===')
const old = W.withIcons({
  city: '北京', src: 'open-meteo', ts: Date.now(),
  now: { temp: 20, text: '晴', kind: 'sun', feels: 19, hum: 40, wd: '北风', ws: 2, isDay: 1 },
  today: { max: 25, min: 15, text: '晴', kind: 'sun' },
  days: [{ label: '明天', max: 26, min: 16, text: '多云', kind: 'suncloud' }],
})
ok('旧的 days 原样保留', old.days.length === 1 && old.days[0].label === '明天', old.days.length)
ok('旧的 days 也补上了图标', !!(old.days[0].ic && old.days[0].ic.cloud), JSON.stringify(old.days[0].ic))

console.log('\n' + (fail ? '有 ' + fail + ' 项未通过' : '全部通过'))
process.exit(fail ? 1 : 0)
