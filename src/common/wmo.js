// WMO 天气代码 → 中文描述 + 图标配方
//
// Open-Meteo 用的是 WMO 4677 代码表，返回的是数字，必须本地翻译。
// 翻译和图标都在本地完成，所以断网时缓存里的天气一样能正常显示。
//
// kind 是给图标用的归一化类型；ic() 再把 kind + 白天/夜间 展开成
// 图标各部件的开关，模板里用 if 控制每个部件的显隐。

const TABLE = {
  0:  { t: '晴',       k: 'sun' },
  1:  { t: '晴间多云', k: 'suncloud' },
  2:  { t: '多云',     k: 'suncloud' },
  3:  { t: '阴',       k: 'overcast' },
  45: { t: '有雾',     k: 'fog' },
  48: { t: '冻雾',     k: 'fog' },
  51: { t: '毛毛雨',   k: 'drizzle' },
  53: { t: '毛毛雨',   k: 'drizzle' },
  55: { t: '毛毛雨',   k: 'drizzle' },
  56: { t: '冻毛毛雨', k: 'sleet' },
  57: { t: '冻毛毛雨', k: 'sleet' },
  61: { t: '小雨',     k: 'rain' },
  63: { t: '中雨',     k: 'rain' },
  65: { t: '大雨',     k: 'heavyrain' },
  66: { t: '冻雨',     k: 'sleet' },
  67: { t: '冻雨',     k: 'sleet' },
  71: { t: '小雪',     k: 'snow' },
  73: { t: '中雪',     k: 'snow' },
  75: { t: '大雪',     k: 'heavysnow' },
  77: { t: '米雪',     k: 'snow' },
  80: { t: '阵雨',     k: 'rain' },
  81: { t: '阵雨',     k: 'rain' },
  82: { t: '强阵雨',   k: 'heavyrain' },
  85: { t: '阵雪',     k: 'snow' },
  86: { t: '强阵雪',   k: 'heavysnow' },
  95: { t: '雷阵雨',   k: 'thunder' },
  96: { t: '雷阵雨伴冰雹', k: 'thunder' },
  99: { t: '雷阵雨伴冰雹', k: 'thunder' },
}

export function describe(code) {
  const row = TABLE[code]
  if (row) return row
  return { t: '未知', k: 'cloud' }
}

// 夜间：晴/晴间多云 收掉太阳，按"多云"处理
function nightKind(k) {
  if (k === 'sun') return 'cloud'
  if (k === 'suncloud') return 'cloud'
  return k
}

// kind + 昼夜 → 图标各部件开关
// sun/sunSm/glow/cloud/cloud2 为布尔，drops/flakes/fog 为个数，bolt 为布尔
//
// 直接吃 kind 而不是 WMO 码：码表里没有"纯多云"这一档，
// 从 kind 反查码会有损（cloud 会退化成 overcast，多画一层云）。
export function iconFromKind(kind, isDay) {
  let k = kind
  if (isDay === 0 || isDay === false) k = nightKind(k)

  const o = { sun: false, sunSm: false, glow: false, cloud: false, cloud2: false,
              drops: 0, flakes: 0, fog: 0, bolt: false }

  if (k === 'sun') { o.sun = true; o.glow = true }
  else if (k === 'suncloud') { o.sunSm = true; o.cloud = true }
  else if (k === 'cloud') { o.cloud = true }
  else if (k === 'overcast') { o.cloud = true; o.cloud2 = true }
  else if (k === 'fog') { o.fog = 3 }   // 雾不画云：云会把雾杠盖住糊成一坨
  else if (k === 'drizzle') { o.cloud = true; o.drops = 2 }
  else if (k === 'rain') { o.cloud = true; o.drops = 3 }
  else if (k === 'heavyrain') { o.cloud = true; o.cloud2 = true; o.drops = 3 }
  else if (k === 'sleet') { o.cloud = true; o.drops = 1; o.flakes = 2 }
  else if (k === 'snow') { o.cloud = true; o.flakes = 3 }
  else if (k === 'heavysnow') { o.cloud = true; o.cloud2 = true; o.flakes = 3 }
  else if (k === 'thunder') { o.cloud = true; o.cloud2 = true; o.drops = 1; o.bolt = true }
  else { o.cloud = true }

  // 再派生出一套布尔开关 d1..d3 / f1..f3 / g1..g3。
  //
  // 模板里本来写的是 if="{{$item.ic.drops > 0}}" —— 属性值里这个裸的 ">" 在这台表上
  // 直接让整个部件不渲染：毛毛雨、小雨的雨点一个像素都没画出来，而同一份配方里
  // 没有 ">" 的 cloud/cloud2 都正常。既然要吃这个亏，就别在模板里做比较，
  // 在这里算干净。
  o.d1 = o.drops > 0; o.d2 = o.drops > 1; o.d3 = o.drops > 2
  o.f1 = o.flakes > 0; o.f2 = o.flakes > 1; o.f3 = o.flakes > 2
  o.g1 = o.fog > 0; o.g2 = o.fog > 1; o.g3 = o.fog > 2

  return o
}

// 按 WMO 码出图标
export function icon(weatherCode, isDay) {
  return iconFromKind(describe(weatherCode).k, isDay)
}

// 中国天气网兜底接口给的是中文天气词，反查成 kind 用同一套图标
const CN_WORDS = [
  ['雷阵雨', 'thunder'], ['雷雨', 'thunder'], ['冰雹', 'thunder'],
  ['暴雪', 'heavysnow'], ['大雪', 'heavysnow'], ['中雪', 'snow'], ['小雪', 'snow'],
  ['阵雪', 'snow'], ['雨夹雪', 'sleet'], ['冻雨', 'sleet'],
  ['暴雨', 'heavyrain'], ['大暴雨', 'heavyrain'], ['特大暴雨', 'heavyrain'],
  ['大雨', 'heavyrain'], ['中雨', 'rain'], ['小雨', 'rain'], ['阵雨', 'rain'],
  ['毛毛雨', 'drizzle'], ['雾', 'fog'], ['霾', 'fog'],
  ['阴', 'overcast'],
  ['多云', 'suncloud'], ['晴', 'sun'],
]

export function kindFromCnText(text) {
  if (!text) return 'cloud'
  for (let i = 0; i < CN_WORDS.length; i++) {
    if (text.indexOf(CN_WORDS[i][0]) >= 0) return CN_WORDS[i][1]
  }
  return 'cloud'
}
