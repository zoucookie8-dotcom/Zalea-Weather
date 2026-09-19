import * as W from './weather.js'
import cities from './cities.js'

const pick = n => cities.find(c => c.n === n)
const list = ['北京','上海','拉萨','三亚','漠河'].map(pick).filter(Boolean)

for (const c of list) {
  try {
    const m = await W.fetchWeather(c)
    const withIc = W.withIcons(m)
    const n = m.now
    console.log(`\n【${c.n}】 源=${m.src}  经纬度=${c.lat},${c.lon}`)
    console.log(`  实时  ${n.temp}°  ${n.text}  体感${n.feels}°  湿度${n.hum}%  ${n.wd}${n.ws}级  白天=${n.isDay}`)
    console.log(`  今日  ${m.today.max}° / ${m.today.min}°  ${m.today.text}`)
    console.log(`  预报  ${m.days.map(d=>`${d.label} ${d.max}/${d.min}° ${d.text}`).join(' | ') || '(无)'}`)
    console.log(`  图标  主=${JSON.stringify(withIc.icNow)}`)
  } catch (e) {
    console.log(`\n【${c.n}】 失败: ${e.message}`)
  }
}
