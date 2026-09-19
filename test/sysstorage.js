// @system.storage 桩：内存 Map
//
// get 的回执形状可切换，默认 'bare'：
//   'bare'    —— 直接把值当第一个参数递进来。这是红米手表 5 的模拟器上实测的
//                行为：JSON.stringify 出来是 "\"RT1789...\""，而不是
//                {"data":"RT1789..."}。
//   'wrapped' —— 文档写的 { data: 值 } 形状。
//
// 默认走 bare 是有意的：这套测试要盯的是真机行为。以前桩返回的是文档写的
// {data:}，于是 loadCache 里 `if (!d || !d.data) return null` 一路绿灯通过，
// 到了真机上读永远是空 —— 而 set 还报成功，主页看着一切正常，缓存其实从没
// 读回来过。t9 两种形状都会跑一遍。
const m = new Map()
let shape = 'bare'

export function __setShape(s) { shape = s }
export function __reset() { m.clear(); shape = 'bare' }

export default {
  set(o) { m.set(o.key, o.value); o.success && o.success() },
  get(o) {
    const v = m.get(o.key)
    const val = v === undefined ? '' : v
    o.success && o.success(shape === 'wrapped' ? { data: val } : val)
  },
  delete(o) { m.delete(o.key); o.success && o.success() },
  clear(o) { m.clear(); o.success && o.success() },
}
