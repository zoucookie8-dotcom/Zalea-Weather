// @system.fetch 桩：真发网络请求，走 Node 的 https
import https from 'https'
export default {
  fetch(opts){
    const {url, header, success, fail} = opts
    const req = https.get(url, {headers: header||{}}, r => {
      let b=''; r.setEncoding('utf8'); r.on('data',d=>b+=d)
      r.on('end',()=> success({ code: r.statusCode, data: b }))
    })
    req.on('error', e => fail({}, 'ERR:'+e.message))
    req.setTimeout(12000, ()=>{ req.destroy(); fail({}, 'TIMEOUT') })
  }
}
