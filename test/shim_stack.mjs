
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
