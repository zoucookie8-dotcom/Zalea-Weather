
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
