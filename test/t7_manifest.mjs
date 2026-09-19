// manifest.json 校验 + 路由与磁盘文件一致性
import fs from 'fs'

const ROOT = '../'
let fail = 0
const ok = (n, c, x) => { c ? console.log('  OK  ' + n) : (fail++, console.log('  FAIL ' + n + (x !== undefined ? ' -> ' + JSON.stringify(x) : ''))) }

const raw = fs.readFileSync(ROOT + 'src/manifest.json', 'utf8')
let m
try { m = JSON.parse(raw); ok('manifest.json 是合法 JSON', true) }
catch (e) { ok('manifest.json 是合法 JSON', false, e.message); process.exit(1) }

ok('package 名合法(反向域名)', /^[a-z][a-z0-9]*(\.[a-z][a-z0-9]*)+$/.test(m.package), m.package)
ok('name 非空', typeof m.name === 'string' && m.name.length > 0, m.name)
ok('versionName 是 x.y.z', /^\d+\.\d+\.\d+$/.test(m.versionName), m.versionName)
ok('versionCode 是正整数', Number.isInteger(m.versionCode) && m.versionCode > 0, m.versionCode)
ok('deviceTypeList 含 watch', Array.isArray(m.deviceTypeList) && m.deviceTypeList.includes('watch'), m.deviceTypeList)
ok('designWidth = 432 (与屏幕同宽, px 即物理像素)', m.config && m.config.designWidth === 432, m.config)
ok('minPlatformVersion 是数字', Number.isInteger(m.minPlatformVersion), m.minPlatformVersion)
ok('icon 路径以 / 开头', typeof m.icon === 'string' && m.icon[0] === '/', m.icon)
ok('icon 文件真实存在', fs.existsSync(ROOT + 'src' + m.icon), ROOT + 'src' + m.icon)

const feats = (m.features || []).map(f => f.name)
ok('features 是数组', Array.isArray(m.features) && m.features.length > 0)
ok('声明了 system.fetch (HTTPS 请求)', feats.includes('system.fetch'), feats.join(','))
ok('声明了 system.storage (离线缓存)', feats.includes('system.storage'), feats.join(','))
ok('声明了 system.router (页面跳转)', feats.includes('system.router'), feats.join(','))
ok('声明了 system.prompt (toast)', feats.includes('system.prompt'), feats.join(','))
const known = ['system.router','system.fetch','system.storage','system.network','system.prompt','system.configuration','system.request','system.media','system.file','system.geolocation']
const unknown = feats.filter(f => !known.includes(f))
ok('没有可疑的 feature 名', unknown.length === 0, unknown.join(','))

// 路由 ↔ 磁盘
// Vela 约定：路由键是【目录】，component 是目录里的文件名
//   "pages/index": {component:"index"}  ->  src/pages/index/index.ux
// 这条按官方 vela-demo 模板确认过（模板里是 "pages/detail": {"component":"detail"}）
const pages = Object.keys((m.router || {}).pages || {})
const fileOf = (key) => ROOT + 'src/' + key + '/' + m.router.pages[key].component + '.ux'
ok('router.entry 在 pages 里', pages.includes(m.router.entry), m.router.entry)
for (const p of pages) {
  const comp = m.router.pages[p].component
  const f = fileOf(p)
  ok('路由 ' + p + ' -> ' + p + '/' + comp + '.ux 存在', fs.existsSync(f), f)
  if (fs.existsSync(f)) {
    const s = fs.readFileSync(f, 'utf8')
    ok('  ' + p + ' 是合法 .ux (含 template+script)', s.includes('<template>') && s.includes('<script>'))
  }
}
// 反向：磁盘上有 .ux 却没配路由
const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap(e =>
  e.isDirectory() ? walk(d + '/' + e.name) : (e.name.endsWith('.ux') ? [d + '/' + e.name] : []))
for (const f of walk(ROOT + 'src/pages')) {
  const rel = f.slice((ROOT + 'src/').length).replace(/\.ux$/, '')   // pages/index/index
  const dir = rel.split('/').slice(0, -1).join('/')                  // pages/index
  ok('磁盘文件 ' + rel + ' 已登记路由', pages.includes(dir), dir)
}
// 页面里 router.push/back 用到的 uri 都必须已登记
for (const f of walk(ROOT + 'src/pages')) {
  const s = fs.readFileSync(f, 'utf8')
  for (const mm of s.matchAll(/router\.(?:push|replace)\(\{\s*uri:\s*'([^']+)'/g)) {
    const uri = mm[1].replace(/^\//, '')
    ok(f.split('/').pop() + ' 里 push 的 ' + uri + ' 已登记', pages.includes(uri), uri)
  }
}

// app.ux
const app = fs.readFileSync(ROOT + 'src/app.ux', 'utf8')
ok('app.ux 存在且含生命周期', app.includes('onCreate'))
ok('app.ux 没有多余的 <template>', !app.includes('<template>'))

console.log('\n' + (fail ? '有 ' + fail + ' 项未通过' : '全部通过'))
process.exit(fail ? 1 : 0)
