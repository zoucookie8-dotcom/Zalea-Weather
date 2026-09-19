// 把主页 script 段抽出来当模块跑，验证 apply()/pull() 的运行时行为
import fs from 'fs'

const SRC = '../src/pages/index/index.ux'
const DIR = './'

let scr = fs.readFileSync(SRC, 'utf8').match(/<script>([\s\S]*?)<\/script>/)[1]
scr = scr.replace(/from '@system\.router'/g, "from './shim_router.mjs'")
         .replace(/from '@system\.prompt'/g, "from './shim_prompt.mjs'")
         .replace(/from '@system\.network'/g, "from './shim_net.mjs'")
         .replace(/from '\.\.\/\.\.\/common\/cities'/g, "from './cities.js'")
         .replace(/from '\.\.\/\.\.\/common\/weather'/g, "from './weather.js'")
fs.writeFileSync(DIR + 'page_index.mjs', scr)

// 路由桩要记账：跳转目标对不对是没法靠肉眼看出来的（点一下没反应，可能是
// 没绑 onclick、也可能是绑错了 uri），只能断言 push 收到了什么。
fs.writeFileSync(DIR + 'shim_router.mjs',
  `export default { push(o){ (globalThis.__pushed = globalThis.__pushed || []).push(o && o.uri) },\n` +
  `  replace(){}, back(){}, clear(){} }\n`)
fs.writeFileSync(DIR + 'shim_net.mjs', `export default { getType(o){ o.success && o.success({type:'wifi'}) }, subscribe(){}, unsubscribe(){} }\n`)
fs.writeFileSync(DIR + 'shim_prompt.mjs', `export default { showToast(o){ globalThis.__toast = o && o.message } }\n`)

const P = (await import('./page_index.mjs?t=' + Date.now())).default
const W = await import('./weather.js')
const cities = (await import('./cities.js')).default

let fail = 0
const ok = (n, c, x) => { c ? console.log('  OK  ' + n) : (fail++, console.log('  FAIL ' + n + (x !== undefined ? ' -> ' + JSON.stringify(x) : ''))) }

function newPage() {
  const o = Object.assign({}, P.private)
  for (const k of Object.keys(P)) if (k !== 'private' && typeof P[k] === 'function') o[k] = P[k].bind(o)
  return o
}

console.log('=== apply() 用真实数据 ===')
const c = cities.find(x => x.n === '上海')
const model = W.withIcons(await W.fetchWeather(c))
const p = newPage()
p.apply(model)
ok('hasData 置真', p.hasData === true)
// apply() 只管把数据铺到屏幕上，不管城市是谁。这里原本断言"city 更新为上海"，
// 而那正是 bug 的一部分：apply() 里那句 `this.city = model.city || this.city`
// 让"最后返回的那份响应说了算"，一份晚到的旧城市响应就能把用户刚选的城市顶回去。
// 现在城市只由用户的选择决定（syncCity / boot 读存储），pull() 负责保证不会拿
// 别的城市的数据来调 apply。所以这里反过来断言：apply() 不许动 city。
ok('apply() 不改写城市', p.city === '北京', p.city)
ok('offline 置假', p.offline === false)
ok('体感文案带度号', /°$/.test(p.feelsText), p.feelsText)
ok('湿度文案带百分号', /%$/.test(p.humText), p.humText)
ok('风力文案含"级"', /级$/.test(p.windText), p.windText)
ok('底栏含"更新"', p.footText.indexOf('更新') === 0, p.footText)
ok('无预报标记与天数一致', p.noForecast === (model.days.length === 0), [p.noForecast, model.days.length])
console.log('     city=' + p.city + '  体感=' + p.feelsText + '  湿度=' + p.humText + '  风力=' + p.windText)
console.log('     底栏=' + p.footText + '  数据源=' + p.srcLabel)

console.log('\n=== 兜底源（feels 为 null）===')
const cnModel = W.withIcons({
  city: '株洲', src: 'cn', ts: Date.now(),
  now: { temp: 23, text: '多云', kind: 'suncloud', feels: null, hum: 83, wd: '西风', ws: 1, isDay: 1 },
  today: { max: 29, min: 22, text: '多云', kind: 'suncloud' },
  days: [],
})
const p2 = newPage()
p2.apply(cnModel)
ok('体感缺失显示 --', p2.feelsText === '--', p2.feelsText)
ok('湿度正常显示', p2.humText === '83%', p2.humText)
ok('风力正常显示', p2.windText === '西风1级', p2.windText)
ok('多日预报为空时置 noForecast', p2.noForecast === true)
ok('数据源标为中国天气网', p2.srcLabel === '中国天气网', p2.srcLabel)

console.log('\n=== 极端/残缺输入不崩 ===')
const cases = [
  ['days 为空数组', { city:'X', src:'cn', ts:Date.now(), now:{temp:1,text:'晴',kind:'sun',feels:null,hum:null,wd:'',ws:null,isDay:1}, today:{max:1,min:0,text:'晴',kind:'sun'}, days:[] }],
  ['hum/ws 为 null', { city:'X', src:'cn', ts:Date.now(), now:{temp:1,text:'晴',kind:'sun',feels:null,hum:null,wd:'北风',ws:null,isDay:1}, today:{max:1,min:0,text:'晴',kind:'sun'}, days:[] }],
  ['无 days 字段', { city:'X', src:'cn', ts:Date.now(), now:{temp:1,text:'晴',kind:'sun',feels:1,hum:1,wd:'北风',ws:1,isDay:1}, today:{max:1,min:0,text:'晴',kind:'sun'} }],
]
for (const [name, m] of cases) {
  try { const q = newPage(); q.apply(W.withIcons(m)); ok(name + ' 不抛异常', true) }
  catch (e) { ok(name + ' 不抛异常', false, e.message) }
}

console.log('\n=== apply(null/undefined) 应当安全返回 ===')
for (const bad of [null, undefined, {}]) {
  try { const q = newPage(); q.apply(bad); ok('apply(' + JSON.stringify(bad) + ') 不抛', true) }
  catch (e) { ok('apply(' + JSON.stringify(bad) + ') 不抛', false, e.message) }
}

console.log('\n=== boot() 走缓存优先路径 ===')
const p3 = newPage()
// 城市名也得先落盘：boot() 现在会核对缓存的归属城市，只存缓存不存城市名的话，
// 缓存属于"上海"而当前城市还是默认的"北京"，这份缓存会被正确丢弃，测不到缓存路径。
await W.saveCityName('上海')
await W.saveCache(model)
await p3.boot()
ok('boot 后 hasData 置真', p3.hasData === true)
ok('boot 用的是缓存城市', p3.city === '上海', p3.city)
ok('boot 后底栏有更新字样', p3.footText.indexOf('更新') === 0, p3.footText)
console.log('     boot 底栏=' + p3.footText)

await new Promise(r => setTimeout(r, 2500))
console.log('     后台刷新后底栏=' + p3.footText + '  busy=' + p3.busy)

console.log('\n=== boot() 不认不属于当前城市的缓存 ===')
const p5 = newPage()
await W.saveCityName('北京')
await W.saveCache(model)          // 缓存里装的是上海的数据
await p5.boot()
ok('当前城市是北京', p5.city === '北京', p5.city)
ok('没有把上海的缓存铺到北京名下', !p5.model || p5.model.city !== '上海', p5.model && p5.model.city)

console.log('\n=== onShow 不该每次重抓 ===')
const p4 = newPage()
// ready 是"城市已经定下来"的闸门：应用刚起时 onShow 会先于 boot() 的 await 跑，
// 那时候放它进来会和 boot() 抢着 pull。测试里要手动把闸门打开。
p4.ready = true
p4.apply(model)
p4.model.ts = Date.now()
const before = JSON.stringify(p4.model.now)
await W.saveCityName(p4.city)     // 存储里的城市与当前一致，onShow 应当只判缓存新鲜度
p4.onShow()
await new Promise(r => setTimeout(r, 800))
ok('缓存新鲜时 onShow 不触发重抓', JSON.stringify(p4.model.now) === before)

console.log('\n=== 跳转目标 ===')
// 模拟器上没法合成点击（PostMessage 的 WM_LBUTTONDOWN 到不了快应用，实测点
// 底栏 0 像素变化），所以"点一下能不能进预报页"这件事只能在这里断言：
// 处理器绑没绑、uri 写对没有。配上真机上直接以预报页为入口跑通的那次截图，
// 整条链路才算齐。
const nav = newPage()
globalThis.__pushed = []
nav.openForecast()
ok('openForecast 跳到 /pages/forecast', globalThis.__pushed[0] === '/pages/forecast', globalThis.__pushed[0])
nav.openCity()
ok('openCity 跳到 /pages/city', globalThis.__pushed[1] === '/pages/city', globalThis.__pushed[1])

// onclick 绑对了没有：模板里那条预报行必须自己带 openForecast，
// 光有 .fc-more 那颗小胶囊的话，整条预报行就点不动了。
const tpl = fs.readFileSync(SRC, 'utf8').match(/<template>([\s\S]*?)<\/template>/)[1]
const fcRow = (tpl.match(/<div class="fc"[^>]*>/) || [])[0] || ''
ok('预报行 .fc 自己绑了 openForecast', /onclick="openForecast"/.test(fcRow), fcRow)
ok('底栏 .ftr 绑了 refresh', /<div class="ftr"[^>]*onclick="refresh"/.test(tpl))

console.log('\n' + (fail ? '有 ' + fail + ' 项未通过' : '全部通过'))
process.exit(fail ? 1 : 0)
