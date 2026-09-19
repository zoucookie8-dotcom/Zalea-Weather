import https from 'https'
export default {
  fetch(opts){
    const {url, header, success, fail} = opts
    if(url.indexOf('open-meteo') >= 0){ return fail({}, 'BLOCKED_FOR_TEST') }
    const req = https.get(url, {headers: header||{}}, r => {
      let b=''; r.setEncoding('utf8'); r.on('data',d=>b+=d)
      r.on('end',()=> success({ code: r.statusCode, data: b }))
    })
    req.on('error', e => fail({}, 'ERR:'+e.message))
    req.setTimeout(12000, ()=>{ req.destroy(); fail({}, 'TIMEOUT') })
  }
}
