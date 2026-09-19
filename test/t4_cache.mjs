import * as W from './weather.js'
import * as wmo from './wmo.js'
import cities from './cities.js'

let pass = 0, fail = 0
const ok = (name, cond, extra) => { cond ? (pass++, console.log('  ✓', name)) : (fail++, console.log('  ✗', name, extra||'')) }

console.log('— 缓存往返 —')
const c = cities.find(x => x.n === '北京')
const m = W.withIcons(await W.fetchWeather(c))
ok('saveCache 返回 true', await W.saveCache(m) === true)
const back = await W.loadCache()
ok('loadCache 拿回对象', !!back && typeof back === 'object')
ok('城市名保留', back && back.city === '北京', back && back.city)
ok('实时温度保留', back && back.now.temp === m.now.temp)

// saveCache 只存 city/src/ts/now/today/forecast 这几个字段，icNow 和 days 都是
// 派生出来的，读完由 withIcons 重算 —— 不存第二份，否则主页那条预报条和预报页
// 迟早会对不上。所以这两个字段"读回来没有"是设计如此，不是丢数据。
ok('派生字段不落盘（icNow 不存）', back && back.icNow === undefined)
ok('派生字段不落盘（days 不存）', back && back.days === undefined)
ok('完整的 forecast 存下来了', back && back.forecast && back.forecast.length === m.forecast.length,
   back && back.forecast && back.forecast.length)

const re = W.withIcons(back)
ok('读回来重算能补回 icNow', !!re.icNow && re.icNow.drops === m.icNow.drops)
ok('读回来重算能补回 days', re.days.length === m.days.length, re.days.length)
ok('重算出的 days 与存前一致', JSON.stringify(re.days) === JSON.stringify(m.days))
ok('新缓存算新鲜', W.cacheFresh(back) === true)

console.log('— cacheFresh 边界 —')
const now = Date.now()
ok('ts=0 视为过期', W.cacheFresh({ts:0}) === false)
ok('ts=null 视为过期', W.cacheFresh({ts:null}) === false)
ok('undefined 视为过期', W.cacheFresh(undefined) === false)
ok('19 分钟前 → 新鲜', W.cacheFresh({ts: now - 19*60*1000}) === true)
ok('21 分钟前 → 过期', W.cacheFresh({ts: now - 21*60*1000}) === false)

console.log('— hhmm —')
ok('hhmm 补零', /^\d{2}:\d{2}$/.test(W.hhmm(Date.now())), W.hhmm(Date.now()))

console.log('— withIcons 幂等 —')
const a1 = W.withIcons(JSON.parse(JSON.stringify(m)))
const a2 = W.withIcons(a1)
ok('重复调用不改变结果', JSON.stringify(a1.icNow) === JSON.stringify(a2.icNow))

console.log('— 异常输入不崩 —')
ok('withIcons(null) 不抛', (()=>{ try { W.withIcons(null); return true } catch(e){ return false } })())
ok('withIcons({}) 不抛', (()=>{ try { W.withIcons({}); return true } catch(e){ return false } })())

console.log('— 城市表完整性 —')
ok('城市数 105', cities.length === 105, cities.length)
ok('无重复城市名', new Set(cities.map(x=>x.n)).size === cities.length)
ok('无重复天气码', new Set(cities.map(x=>x.cn)).size === cities.length)
ok('字段齐全', cities.every(x => x.n && x.p && x.py && typeof x.lat==='number' && typeof x.lon==='number' && /^\d{9}$/.test(x.cn)))
ok('经纬度在中国范围内', cities.every(x => x.lat>3 && x.lat<54 && x.lon>73 && x.lon<136))
const bad = cities.filter(x => !(x.lat>3 && x.lat<54 && x.lon>73 && x.lon<136))
ok('无越界坐标', bad.length===0, bad.map(x=>x.n).join(','))

console.log(`\n通过 ${pass} / 失败 ${fail}`)
process.exit(fail ? 1 : 0)
