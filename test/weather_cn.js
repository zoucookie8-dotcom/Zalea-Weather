// 天气数据层
//
// 两条数据通路，主备关系：
//   主  Open-Meteo   境外，免 key，一次请求拿齐实时 + 未来 7 天
//   备  中国天气网    境内，需要 Referer 头，拿实时 + 今日高低温（没有多日预报）
//
// 离线策略：
//   每次成功抓取都整体写进 @system.storage。启动时先把缓存渲染出来，
//   再在后台刷新；断网时页面照常显示缓存，并打上"离线"标记和抓取时间。
//   选城市完全走内置城市表，不联网。

import fetch from './sysfetch_block.js'
import storage from './sysstorage.js'
import { describe, iconFromKind, kindFromCnText } from './wmo.js'

const KEY_CACHE = 'weather_cache_v1'
const KEY_CITY = 'weather_city_v1'
const CACHE_TTL = 20 * 60 * 1000   // 20 分钟内不自动重抓

// ---------- 小工具 ----------

function pad(n) { return n < 10 ? '0' + n : '' + n }

export function hhmm(ts) {
  const d = new Date(ts)
  return pad(d.getHours()) + ':' + pad(d.getMinutes())
}

// km/h → 蒲福风力等级
function beaufort(kmh) {
  const b = [1, 5, 11, 19, 28, 38, 49, 61, 74, 88, 102, 117]
  for (let i = 0; i < b.length; i++) if (kmh <= b[i]) return i
  return 12
}

function windDir(deg) {
  const names = ['北', '东北', '东', '东南', '南', '西南', '西', '西北']
  return names[Math.round(((deg % 360) / 45)) % 8] + '风'
}

// 带超时的 fetch。Vela 的 fetch 没有超时参数，只能自己 race。
function request(url, headers) {
  return new Promise((resolve, reject) => {
    let done = false
    const finish = (fn, arg) => { if (!done) { done = true; fn(arg) } }

    if (typeof setTimeout === 'function') {
      setTimeout(() => finish(reject, new Error('timeout')), 9000)
    }

    fetch.fetch({
      url: url,
      method: 'GET',
      responseType: 'text',
      header: headers || {},
      success: (res) => {
        // 注意：Vela 里 code 是 HTTP 状态码，不是"0 表示成功"
        if (res.code >= 200 && res.code < 300) finish(resolve, res.data)
        else finish(reject, new Error('HTTP ' + res.code))
      },
      fail: (err, code) => finish(reject, new Error('fetch fail: ' + code)),
    })
  })
}

// responseType 按 text 取，但万一返回的已是对象也能吃下
function asText(data) {
  if (typeof data === 'string') return data
  try { return JSON.stringify(data) } catch (e) { return '' }
}

function asJson(data) {
  if (data && typeof data === 'object') return data
  return JSON.parse(asText(data))
}

// ---------- 主数据源：Open-Meteo ----------

function openMeteoUrl(city) {
  return 'https://api.open-meteo.com/v1/forecast'
    + '?latitude=' + city.lat + '&longitude=' + city.lon
    + '&current=temperature_2m,relative_humidity_2m,apparent_temperature,'
    + 'is_day,precipitation,weather_code,wind_speed_10m,wind_direction_10m'
    + '&daily=weather_code,temperature_2m_max,temperature_2m_min,'
    + 'precipitation_probability_max,wind_speed_10m_max,wind_direction_10m_dominant'
    + '&timezone=Asia%2FShanghai&forecast_days=7'
}

const WEEK = ['周日', '周一', '周二', '周三', '周四', '周五', '周六']

// '2026-09-19' -> { label:'今天', date:'09-19' }（label 由调用方按序号覆盖）
//
// 注意别写 new Date('2026-09-19') —— 那按 UTC 解析，再取 getDay() 会随本地时区
// 偏移一天。手工拆年月日、用本地构造函数才是确定的。
function dayMeta(iso, index) {
  const p = String(iso).split('-')
  const y = parseInt(p[0], 10), m = parseInt(p[1], 10), d = parseInt(p[2], 10)
  let label
  if (index === 0) label = '今天'
  else if (index === 1) label = '明天'
  else if (index === 2) label = '后天'
  else label = WEEK[new Date(y, m - 1, d).getDay()]

  return {
    label: label,
    date: pad(m) + '-' + pad(d),
  }
}

function pickOpenMeteo(raw, name) {
  const cur = raw.current
  const day = raw.daily
  if (!cur || !day || !day.time) throw new Error('bad payload')

  const kind = describe(cur.weather_code)
  const now = {
    temp: Math.round(cur.temperature_2m),
    text: kind.t,
    kind: kind.k,
    feels: Math.round(cur.apparent_temperature),
    hum: Math.round(cur.relative_humidity_2m),
    wd: windDir(cur.wind_direction_10m),
    ws: beaufort(cur.wind_speed_10m),
    isDay: cur.is_day,
  }

  // 完整的 7 天（含今天）。主页那条 3 天预报条由它派生，两处不存两份数据。
  const src = day.time
  const forecast = []
  for (let i = 0; i < src.length && i < 7; i++) {
    const dk = describe(day.weather_code[i])
    const meta = dayMeta(src[i], i)

    // 降水概率这个字段不是每个模式都给，缺了就是 null，别当成 0 ——
    // "0% 概率" 和 "不知道" 是两回事，前者会让人放心出门。
    const popRaw = day.precipitation_probability_max ? day.precipitation_probability_max[i] : null
    const pop = (popRaw === null || popRaw === undefined) ? null : Math.round(popRaw)

    const wsRaw = day.wind_speed_10m_max ? day.wind_speed_10m_max[i] : null
    const wdRaw = day.wind_direction_10m_dominant ? day.wind_direction_10m_dominant[i] : null

    forecast.push({
      label: meta.label,
      date: meta.date,
      max: Math.round(day.temperature_2m_max[i]),
      min: Math.round(day.temperature_2m_min[i]),
      text: dk.t,
      kind: dk.k,
      pop: pop,
      wd: (wdRaw === null || wdRaw === undefined) ? '' : windDir(wdRaw),
      ws: (wsRaw === null || wsRaw === undefined) ? null : beaufort(wsRaw),
    })
  }

  const first = forecast[0]
  return {
    city: name,
    src: 'open-meteo',
    ts: Date.now ? Date.now() : new Date().getTime(),
    now: now,
    forecast: forecast,
    today: first || { max: now.temp, min: now.temp, text: now.text, kind: now.kind },
  }
}

// ---------- 备用数据源：中国天气网 ----------
//
// 返回的是 JS 变量赋值而不是 JSON：
//   var dataSK={"cityname":"北京","temp":"26",...}
//   var cityDZ101010100 ={"weatherinfo":{...}};var alarmDZ...
// 所以要先把对象字面量抠出来再 JSON.parse。

function pickAssignment(text, re) {
  const m = text.match(re)
  if (!m) throw new Error('no payload')
  return JSON.parse(m[1])
}

async function fetchChina(city) {
  const hdr = { 'Referer': 'http://www.weather.com.cn/' }

  const curText = asText(await request(
    'https://d1.weather.com.cn/sk_2d/' + city.cn + '.html', hdr))
  const cur = pickAssignment(curText, /var\s+dataSK\s*=\s*(\{[\s\S]*?\})\s*;?\s*$/)

  let fc = null
  try {
    const fcText = asText(await request(
      'https://d1.weather.com.cn/dingzhi/' + city.cn + '.html', hdr))
    fc = pickAssignment(fcText, /"weatherinfo"\s*:\s*(\{[\s\S]*?\})\s*\}/)
  } catch (e) { /* 预报拿不到就只显示实时 */ }

  const num = (s) => { const n = parseInt(s, 10); return isNaN(n) ? null : n }

  const textCn = (fc && fc.weather) || cur.weather || ''
  const kind = kindFromCnText(textCn)
  const temp = num(cur.temp)
  const max = fc ? num(fc.temp) : null
  const min = fc ? num(fc.tempn) : null

  const now = {
    temp: temp === null ? '--' : temp,
    text: textCn || describe(0).t,
    kind: kind,
    feels: null,                                    // 该接口不给体感
    hum: num(cur.SD),
    wd: cur.WD || '',
    ws: num(cur.WS),                                // 已经是"几级"
    isDay: 1,
  }

  return {
    city: city.n,
    src: 'cn',
    ts: Date.now ? Date.now() : new Date().getTime(),
    now: now,
    today: { max: max === null ? now.temp : max, min: min === null ? now.temp : min,
             text: textCn, kind: kind },
    forecast: [],                                   // 兜底源没有多日预报
  }
}

// ---------- 对外：抓取（主 → 备） ----------

export async function fetchWeather(city) {
  const errors = []
  try {
    const raw = asJson(await request(openMeteoUrl(city)))
    return pickOpenMeteo(raw, city.n)
  } catch (e) { errors.push('open-meteo: ' + e.message) }

  try {
    return await fetchChina(city)
  } catch (e) { errors.push('cn: ' + e.message) }

  throw new Error(errors.join(' | '))
}

// ---------- 缓存 ----------

// 只序列化真正需要的字段。
//
// days 是由 forecast 派生出来的（withIcons 里 forecast.slice(1, 4)），不存它：
// 存两份迟早会出现"主页那条预报条和预报页对不上"。读回来 withIcons 会重算。
// 图标配方（ic）会跟着 forecast 一起进去，这个无所谓 —— 读回来同样整个重算，
// 带上只是多占些字节（实测 1918 字节，storage 写 3072 都没问题）。
function serializable(model) {
  return {
    city: model.city, src: model.src, ts: model.ts,
    now: model.now, today: model.today, forecast: model.forecast,
  }
}

export function saveCache(model) {
  return new Promise((resolve) => {
    try {
      storage.set({
        key: KEY_CACHE,
        value: JSON.stringify(model && model.now ? serializable(model) : model),
        success: () => resolve(true),
        fail: () => resolve(false),
      })
    } catch (e) { resolve(false) }
  })
}

// storage.get 的回执形状在不同 Vela 版本上不一样：
//   文档写的是 success(data) 里 data.data 才是值；
//   但这台表上的模拟器直接把值本身当第一个参数递进来（JSON.stringify 出来
//   就是 "\"RT1758...\""，而不是 {"data":"RT1758..."}）。
// 两种都得认。只认 {data:...} 的话，读永远返回空，而 set 却报成功 ——
// 表现就是主页一切正常、缓存看着写了其实读不回来，预报页永远"还没有数据"。
function unwrap(d) {
  if (d === null || d === undefined) return null
  if (typeof d === 'object' && d.data !== undefined) return d.data
  return d
}

export function loadCache() {
  return new Promise((resolve) => {
    try {
      storage.get({
        key: KEY_CACHE,
        success: (d) => {
          const v = unwrap(d)
          if (!v) return resolve(null)
          try { resolve(JSON.parse(v)) } catch (e) { resolve(null) }
        },
        fail: () => resolve(null),
      })
    } catch (e) { resolve(null) }
  })
}

export function cacheFresh(model) {
  if (!model || !model.ts) return false
  const now = Date.now ? Date.now() : new Date().getTime()
  return (now - model.ts) < CACHE_TTL
}

// 记住上次选的城市。
//
// 返回 Promise：写完（或最多 300ms）才 resolve，调用方要等它。
// 为什么要等 —— storage.set 是异步落盘的，写完立刻读有可能读回旧值，
// 而主页从城市页返回时是"立刻就要读"（见 index.ux 的 syncCity）。
// 不等的话就会出现"选了新城市、回来还是旧城市"。
//
// 三个出口都 resolve，绝不允许挂住：这台 Vela 上 storage 的回执形状和文档
// 不一致（storage.get 把值本身当第一个参数递进来，见 unwrap），万一
// success/fail 一个都不回调，await 就永远不返回，城市页再也退不出去。
// 所以补一个 300ms 兜底。
export function saveCityName(name) {
  return new Promise((resolve) => {
    let done = false
    const fin = () => { if (!done) { done = true; resolve(true) } }
    try {
      storage.set({ key: KEY_CITY, value: name, success: fin, fail: fin })
    } catch (e) { fin(); return }
    if (typeof setTimeout === 'function') setTimeout(fin, 300)
  })
}

export function loadCityName() {
  return new Promise((resolve) => {
    try {
      storage.get({ key: KEY_CITY, success: (d) => resolve(unwrap(d)),
                    fail: () => resolve(null) })
    } catch (e) { resolve(null) }
  })
}

// 把模型展开成模板要用的图标开关
export function withIcons(model) {
  if (!model || !model.now) return model
  model.icNow = iconFromKind(model.now.kind, model.now.isDay)
  if (model.today) model.icToday = iconFromKind(model.today.kind, 1)

  // 主页那条 3 天预报条（不含今天）由完整的 forecast 派生出来，
  // 不单独存一份 —— 两份数据放久了必然会出现"主页和预报页对不上"。
  // forecast 为空（兜底源，或旧缓存）时保持 days 原样，别把它清掉；
  // 两者都没有也要兜成空数组，否则模板里 model.days.length 会炸。
  if (model.forecast && model.forecast.length) {
    model.days = model.forecast.slice(1, 4)
  } else if (!model.days) {
    model.days = []
  }
  for (let i = 0; i < model.days.length; i++) {
    model.days[i].ic = iconFromKind(model.days[i].kind, 1)
  }
  if (model.forecast) {
    for (let i = 0; i < model.forecast.length; i++) {
      model.forecast[i].ic = iconFromKind(model.forecast[i].kind, 1)
    }
  }
  return model
}

// 预报页要显示的每行文案。放在这里而不是页面里，是为了能被测试直接调。
export function forecastRows(model) {
  const list = (model && model.forecast) || []
  const rows = []
  for (let i = 0; i < list.length; i++) {
    const d = list[i]
    const pop = (d.pop === null || d.pop === undefined) ? '降水 --' : ('降水 ' + d.pop + '%')
    // 有风才拼上去，没风不要留个孤零零的分隔符
    const wind = (d.ws === null || d.ws === undefined) ? '' : (' · ' + (d.wd || '') + d.ws + '级')

    rows.push({
      label: d.label,
      date: d.date,
      text: d.text,
      range: d.max + '° / ' + d.min + '°',
      popText: pop + wind,
      ic: d.ic || iconFromKind(d.kind, 1),
    })
  }
  return rows
}
