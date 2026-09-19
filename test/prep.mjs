// 从项目源生成测试用的桩副本。
// 之前是手工 cp，结果把打过桩的 weather.js 覆盖成原文件、@system.* 解析不了。
// 现在统一由这里生成，跑测试前先跑它。
import fs from 'fs'

const SRC = '../src/common/'
const DIR = './'

// wmo.js / cities.js 不 import @system.*，可以直接照搬
for (const f of ['wmo.js', 'cities.js']) fs.copyFileSync(SRC + f, DIR + f)

// weather.js 里的三个 @system.* 换成桩：
//   fetch   -> sysfetch.js（真发 https）/ sysfetch_block.js（屏蔽主源，逼出兜底）
//   storage -> sysstorage.js（内存 Map）
//   network -> shim_net.mjs
const raw = fs.readFileSync(SRC + 'weather.js', 'utf8')
// 项目源写的是无扩展名的相对导入（'./wmo'），Vela 打包器能解析，Node ESM 不能，补上 .js
// 已经有扩展名的（'./sysstorage.js'）不能重复追加
const withExt = (s) => s.replace(/(from\s+')([^']+)(')/g, (m, a, p, c) =>
  p[0] === '.' && !/\.[A-Za-z0-9]+$/.test(p) ? a + p + '.js' + c : m)
const patch = (fetchStub) => withExt(raw
  .replace(/from '@system\.fetch'/, "from '" + fetchStub + "'")
  .replace(/from '@system\.storage'/, "from './sysstorage.js'")
  .replace(/from '@system\.network'/, "from './shim_net.mjs'"))

const live = patch('./sysfetch.js')
const blocked = patch('./sysfetch_block.js')
fs.writeFileSync(DIR + 'weather.js', live)
fs.writeFileSync(DIR + 'weather_cn.js', blocked)

// 兜底：真源里若还有没替换掉的 @system.* 就直接报错，别让测试悄悄跑在错的模块上
// （weather.js 只 import 了 fetch 和 storage 两个 @system 模块）
const expect = ["import fetch from './sysfetch", "import storage from './sysstorage.js'"]
for (const [name, text] of [['weather.js', live], ['weather_cn.js', blocked]]) {
  const left = [...text.matchAll(/from '(@system[^']*)'/g)].map(m => m[1])
  if (left.length) { console.error('!! ' + name + ' 仍有未替换的桩: ' + left.join(', ')); process.exit(1) }
  if (!text.includes(expect[0])) { console.error('!! ' + name + ' fetch 桩替换失败'); process.exit(1) }
  if (!text.includes(expect[1])) { console.error('!! ' + name + ' storage 桩替换失败'); process.exit(1) }
}

fs.writeFileSync(DIR + 'shim_net.mjs',
  "export default { getType(o){ o.success && o.success({type:'wifi'}) }, subscribe(){}, unsubscribe(){} }\n")
fs.writeFileSync(DIR + 'shim_router.mjs', 'export default { push(){}, replace(){}, back(){}, clear(){} }\n')
fs.writeFileSync(DIR + 'shim_prompt.mjs', 'export default { showToast(o){ globalThis.__toast = o && o.message } }\n')

console.log('prep 完成: wmo.js / cities.js / weather.js(联网) / weather_cn.js(屏蔽主源) / 三个 shim')
