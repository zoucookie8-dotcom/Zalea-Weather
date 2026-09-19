// 端到端：主页 + 城市页 在同一个 storage 上走一遍真实的切城市流程。
//
// 为什么非要有这个测试：t6 只把主页 script 单独拿出来跑，城市页是被绕过去的，
// 于是"这两个页面之间怎么交接"从来没人验过 —— 而 bug 恰恰就出在这条缝上。
// 当时的形态是：城市页把新城市写进了 storage，主页的 onShow 却只判"缓存过期
// 才刷新"，而刚选完城市时缓存正好是新鲜的，于是整个 onShow 什么都不做，新城市
// 根本没机会被主页看见；主页只认 this.city，this.city 又只在 boot() 里读过一次
// 存储，所以切了城市也得等应用重启才生效。光看主页看不出毛病，光看城市页也看
// 不出毛病，必须两边一起跑。
//
// 这里的路由桩是个真栈：push 进去给新页派 onInit + onShow，back 出来给下面那页
// 派 onShow —— 跟框架的语义一致（onShow 也覆盖"页面第一次显示"）。所以这里验的
// 是"框架派发 onShow 之后主页会不会读存储"，而不是"我手动调 this.onShow() 会怎样"。
//
// 取数用可编排的桩（sysfetch_canned），按请求里的经纬度反查城市、返回该城市专属
// 的温度。这样"数据也跟着切过去了"是被断言到的：切到上海之后显示的必须是上海的
// 25°，而不是北京那份。
import fs from 'fs'

const OUT = './'
const SRC = '../src/'

// ---------- 1. 数据层：fetch 换成可编排的桩，storage 与其它测试共用 sysstorage.js ----------
const rawWeather = fs.readFileSync(SRC + 'common/weather.js', 'utf8')
// 项目源写的是无扩展名的相对导入（'./wmo'），Vela 打包器能解析，Node ESM 不能，补上 .js
const withExt = (s) => s.replace(/(from\s+')([^']+)(')/g, (m, a, p, c) =>
  p[0] === '.' && !/\.[A-Za-z0-9]+$/.test(p) ? a + p + '.js' + c : m)
const weatherSw = withExt(rawWeather
  .replace(/from '@system\.fetch'/, "from './sysfetch_canned.js'")
  .replace(/from '@system\.storage'/, "from './sysstorage.js'")
  .replace(/from '@system\.network'/, "from './shim_net.mjs'"))
fs.writeFileSync(OUT + 'weather_sw.js', weatherSw)
const leftover = [...weatherSw.matchAll(/from '(@system[^']*)'/g)].map(m => m[1])
if (leftover.length) { console.error('!! weather_sw.js 还有未替换的桩: ' + leftover.join(', ')); process.exit(1) }

// ---------- 2. 三个页面：script 段抽出来，@system.* 换成桩 ----------
function pageScript(uxPath) {
  return fs.readFileSync(uxPath, 'utf8').match(/<script>([\s\S]*?)<\/script>/)[1]
    .replace(/from '@system\.router'/g, "from './shim_stack.mjs'")
    .replace(/from '@system\.prompt'/g, "from './shim_prompt.mjs'")
    .replace(/from '\.\.\/\.\.\/common\/cities'/g, "from './cities.js'")
    .replace(/from '\.\.\/\.\.\/common\/weather'/g, "from './weather_sw.js'")
}
fs.writeFileSync(OUT + 'page_sw_index.mjs', pageScript(SRC + 'pages/index/index.ux'))
fs.writeFileSync(OUT + 'page_sw_city.mjs', pageScript(SRC + 'pages/city/city.ux'))
fs.writeFileSync(OUT + 'page_sw_forecast.mjs', pageScript(SRC + 'pages/forecast/forecast.ux'))

// ---------- 3. 路由桩：一个真栈，重点是 back() 会对下面那页派发 onShow ----------
fs.writeFileSync(OUT + 'shim_stack.mjs', `
const factories = {}
const stack = []
export function __page(uri, make) { factories[uri] = make }
export function __reset() { stack.length = 0 }
export function __stack() { return stack.map((f) => f.uri) }
export function __top() { const t = stack[stack.length - 1]; return t && t.inst }
export function __entry(uri) {
  const make = factories[uri]
  const inst = make ? make() : null
  stack.push({ uri: uri, inst: inst })
  if (inst) { inst.onInit && inst.onInit(); inst.onShow && inst.onShow() }
  return inst
}
export default {
  push(o) {
    const make = factories[o.uri]
    const inst = make ? make() : null
    stack.push({ uri: o.uri, inst: inst })
    // 框架语义：新页首次显示也要走 onInit + onShow
    if (inst) { inst.onInit && inst.onInit(); inst.onShow && inst.onShow() }
  },
  back() {
    if (stack.length < 2) return
    const gone = stack.pop()
    if (gone.inst && gone.inst.onHide) gone.inst.onHide()
    const top = stack[stack.length - 1]
    if (top.inst && top.inst.onShow) top.inst.onShow()   // <-- 这里就是被验的那一下
  },
  replace() {}, clear() {},
}
`)

// ---------- 4. 可编排的 fetch 桩 ----------
fs.writeFileSync(OUT + 'sysfetch_canned.js', `
let handler = null
const calls = []
export function __setHandler(h) { handler = h }
export function __calls() { return calls.slice() }
export function __reset() { handler = null; calls.length = 0 }
export default {
  fetch(o) {
    calls.push(o.url)
    if (!handler) { o.fail && o.fail({}, 'no-handler'); return }
    Promise.resolve().then(() => handler(o.url)).then(
      (r) => { o.success && o.success(r) },
      (e) => { o.fail && o.fail({}, (e && e.message) || String(e)) })
  },
}
`)

const RS = await import('./shim_stack.mjs')
const F = await import('./sysfetch_canned.js')
const ST = await import('./sysstorage.js')
const W = await import('./weather_sw.js')
const cities = (await import('./cities.js')).default
const IX = (await import('./page_sw_index.mjs?t=' + Date.now())).default
const CT = (await import('./page_sw_city.mjs?t=' + Date.now())).default
const FC = (await import('./page_sw_forecast.mjs?t=' + Date.now())).default

let fail = 0
const ok = (n, c, x) => {
  c ? console.log('  OK  ' + n)
    : (fail++, console.log('  FAIL ' + n + (x !== undefined ? ' -> ' + JSON.stringify(x) : '')))
}
const settle = (ms) => new Promise(r => setTimeout(r, ms || 40))

// 每个城市一个专属温度：切过去之后温度对不对，就说明数据有没有跟着切
const TEMP = { 北京: 10, 上海: 25, 广州: 33, 杭州: 21, 成都: 18 }
const DAYS = ['2026-09-19', '2026-09-20', '2026-09-21', '2026-09-22',
              '2026-09-23', '2026-09-24', '2026-09-25']

function payload(temp) {
  return {
    current: { temperature_2m: temp, relative_humidity_2m: 55, apparent_temperature: temp - 1,
               is_day: 1, precipitation: 0, weather_code: 2,
               wind_speed_10m: 12, wind_direction_10m: 180 },
    daily: {
      time: DAYS,
      weather_code: [2, 3, 61, 0, 1, 2, 3],
      temperature_2m_max: [28, 27, 25, 30, 31, 29, 26],
      temperature_2m_min: [18, 17, 16, 19, 20, 18, 17],
      precipitation_probability_max: [10, 20, 80, 0, 5, 15, 30],
      wind_speed_10m_max: [12, 14, 20, 8, 9, 11, 13],
      wind_direction_10m_dominant: [180, 200, 90, 45, 60, 120, 150],
    },
  }
}

// 请求 URL 里的经纬度 -> 城市名。温度按城市给，于是"数据切没切"可断言。
const byLatLon = new Map(cities.map(c => [c.lat + ',' + c.lon, c.n]))
function cityOf(url) {
  const m = /latitude=([-\d.]+)&longitude=([-\d.]+)/.exec(url)
  return m ? byLatLon.get(m[1] + ',' + m[2]) : null
}
const ok200 = (url) => {
  const n = cityOf(url)
  return { code: 200, data: JSON.stringify(payload(TEMP[n] === undefined ? 0 : TEMP[n])) }
}
const failAll = () => { throw new Error('network down') }

function mk(def) {
  const o = Object.assign({}, def.private)
  for (const k of Object.keys(def)) if (k !== 'private' && typeof def[k] === 'function') o[k] = def[k].bind(o)
  return o
}

// 装一次"新应用"：清栈、清 fetch 记账、清 storage，注册三个页面工厂
function install(handler) {
  RS.__reset(); F.__reset(); ST.__reset()
  F.__setHandler(handler || (async (url) => ok200(url)))
  RS.__page('/pages/index', () => mk(IX))
  RS.__page('/pages/city', () => mk(CT))
  RS.__page('/pages/forecast', () => mk(FC))
}

// 用户动作：点主页顶栏进城市页，点某个城市 -> 城市页写 storage 再 back()
async function pickCity(name) {
  RS.__top().openCity()
  await settle(20)
  const cityInst = RS.__top()
  await cityInst.pick(cities.find(c => c.n === name))
  await settle(60)
}

console.log('=== 1. 主流程：选完城市回主页，主页必须换城市、也换数据 ===')
install()
await W.saveCityName('北京')
const idx = RS.__entry('/pages/index')
await settle(60)
ok('启动后读到存储里的北京', idx.city === '北京', idx.city)
ok('启动后拿到北京的数据', idx.model && idx.model.city === '北京', idx.model && idx.model.city)
ok('北京的温度是 10 度', idx.model && idx.model.now.temp === 10, idx.model && idx.model.now.temp)

const callsBefore = F.__calls().length
await pickCity('上海')
ok('返回后回到主页', RS.__stack().length === 1, RS.__stack())
ok('主页城市名换成上海', idx.city === '上海', idx.city)
ok('主页数据也是上海的', idx.model && idx.model.city === '上海', idx.model && idx.model.city)
ok('温度跟着换成上海的 25 度', idx.model && idx.model.now.temp === 25, idx.model && idx.model.now.temp)
ok('为切换发起过新的网络请求', F.__calls().length > callsBefore, F.__calls().length - callsBefore)
console.log('     city=' + idx.city + '  温度=' + (idx.model && idx.model.now.temp) + '°  底栏=' + idx.footText)

console.log('\n=== 2. 切城市时正好有请求在路上：新城市不能被吞掉 ===')
// 北京的请求挂住，等测试放行；上海的正常返回。
// 挂住的那份要用"北京"的真实载荷放出来 —— 万一守卫漏了，它会真的把界面顶回北京，
// 测试才抓得到。永久挂住不算数：那样 busy 永远不清，pending 也就永远排不上队。
let releaseBeijing = null
install((url) => {
  if (cityOf(url) === '北京') {
    return new Promise((res) => { releaseBeijing = () => res(ok200(url)) })
  }
  return Promise.resolve(ok200(url))
})
await W.saveCityName('北京')
const idx2 = RS.__entry('/pages/index')
await settle(40)
ok('北京的请求还在路上（busy）', idx2.busy === true, idx2.busy)
ok('此刻还没有数据', idx2.hasData === false, idx2.hasData)

await pickCity('上海')
ok('切换先排进 pending 等前一个请求让路', idx2.pending === true, idx2.pending)
ok('城市名已经换成上海', idx2.city === '上海', idx2.city)
ok('旧城市的数据被清掉，不顶着上海显示北京', idx2.hasData === false, idx2.hasData)

releaseBeijing()          // 北京的响应现在才到
await settle(80)
ok('晚到的北京响应没有把城市顶回去', idx2.city === '上海', idx2.city)
ok('新城市的数据最终拿到', idx2.model && idx2.model.city === '上海', idx2.model && idx2.model.city)
ok('温度是上海的 25 度（不是北京的 10）', idx2.model && idx2.model.now.temp === 25, idx2.model && idx2.model.now.temp)
ok('pending 已清空', idx2.pending === false, idx2.pending)
ok('busy 已清空', idx2.busy === false, idx2.busy)
console.log('     city=' + idx2.city + '  温度=' + (idx2.model && idx2.model.now.temp) + '°')

console.log('\n=== 3. 晚到的旧城市响应不能把城市顶回去 ===')
install()
await W.saveCityName('北京')
const idx3 = RS.__entry('/pages/index')
await settle(50)
ok('先有北京的数据', idx3.model && idx3.model.city === '北京')
// 用户切到广州之后，一份"北京"的响应才姗姗来迟
const late = W.withIcons({ city: '北京', src: 'open-meteo', ts: Date.now(),
  now: { temp: 10, text: '多云', kind: 'suncloud', feels: 9, hum: 55, wd: '南风', ws: 2, isDay: 1 },
  today: { max: 28, min: 18, text: '多云', kind: 'suncloud' }, forecast: [] })
idx3.city = '广州'
idx3.apply(late)
ok('apply() 不再改写城市（旧行为会把它顶回北京）', idx3.city === '广州', idx3.city)

console.log('\n=== 4. 切换后取数失败：不能顶着新城市名显示旧城市的数据 ===')
install((url) => { throw new Error('network down') })
await W.saveCityName('北京')
const idx4 = RS.__entry('/pages/index')
await settle(60)
ok('起步就失败时没有数据', idx4.hasData === false, idx4.hasData)

// 先给北京来一份成功的，再让后续请求全挂
F.__setHandler(async (url) => ok200(url))
idx4.pull(true)
await settle(60)
ok('恢复正常后拿到北京的数据', idx4.model && idx4.model.city === '北京', idx4.model && idx4.model.city)

F.__setHandler(failAll)
await pickCity('上海')
ok('城市名换成上海', idx4.city === '上海', idx4.city)
ok('旧城市的数据被清掉了（不顶着上海显示北京）', idx4.hasData === false, idx4.hasData)
ok('model 已置空', idx4.model === null)
// 失败文案由 pull() 的 catch 统一给（'联网失败，请检查网络后重试'），不带城市名 ——
// 城市名在顶栏上摆着，这里只要保证没有半点北京的东西混进来。
ok('空态是联网失败文案', /联网失败/.test(idx4.emptyText), idx4.emptyText)
ok('空态里没有北京的字样', !/北京/.test(idx4.emptyText), idx4.emptyText)
ok('顶栏仍显示上海', idx4.city === '上海', idx4.city)
ok('打上离线标记', idx4.offline === true, idx4.offline)
console.log('     顶栏=' + idx4.city + '  空态=' + idx4.emptyText + '  底栏=' + idx4.footText)

console.log('\n=== 5. 预报页：缓存城市与所选城市不一致时不拿旧城市充数 ===')
ST.__reset()
await W.saveCityName('上海')
// 缓存里留着北京的 7 天预报（切到上海但没抓到新数据的情形）
const beijing = W.withIcons({
  city: '北京', src: 'open-meteo', ts: Date.now(),
  now: { temp: 10, text: '多云', kind: 'suncloud', feels: 9, hum: 55, wd: '南风', ws: 2, isDay: 1 },
  today: { max: 28, min: 18, text: '多云', kind: 'suncloud' },
  forecast: DAYS.map((d, i) => ({ label: '第' + i + '天', date: d.slice(5), max: 28 + i, min: 18 + i,
                                  text: '多云', kind: 'suncloud', pop: 10, wd: '南风', ws: 2 })),
})
await W.saveCache(beijing)
const fc = mk(FC)
await fc.onInit()
await settle(40)
ok('缓存是北京的就不显示', fc.hasDays === false, fc.hasDays)
ok('行被清空', fc.rows.length === 0, fc.rows.length)
ok('说明缓存属于哪个城市', /北京/.test(fc.footText), fc.footText)
ok('空态点名上海', /上海/.test(fc.emptyText), fc.emptyText)
console.log('     空态=' + fc.emptyText + ' / ' + fc.emptySub + '  底栏=' + fc.footText)

// 缓存与所选城市一致时正常出 7 行
const shanghai = Object.assign({}, beijing, { city: '上海' })
await W.saveCache(shanghai)
const fc2 = mk(FC)
await fc2.onInit()
await settle(40)
ok('城市一致时出 7 行', fc2.hasDays === true && fc2.rows.length === 7, fc2.rows.length)
ok('页头城市是上海', fc2.city === '上海', fc2.city)

console.log('\n' + (fail ? '有 ' + fail + ' 项未通过' : '全部通过'))
process.exit(fail ? 1 : 0)
