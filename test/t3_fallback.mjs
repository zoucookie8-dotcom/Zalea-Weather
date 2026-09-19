import * as W from './weather_cn.js'
import cities from './cities.js'
const pick = n => cities.find(c => c.n === n)
for (const name of ['北京','上海','株洲','湘潭','德阳','绍兴','香港']) {
  const c = pick(name)
  if (!c) { console.log(`【${name}】 不在城市表里`); continue }
  try {
    const m = await W.fetchWeather(c)
    const w = W.withIcons(m)
    console.log(`【${name}】码=${c.cn} 源=${m.src}`)
    console.log(`   实时 ${m.now.temp}° ${m.now.text}  湿度${m.now.hum}%  ${m.now.wd}${m.now.ws}级`)
    console.log(`   今日 ${m.today.max}° / ${m.today.min}° ${m.today.text}   主页预报条=${w.days.length} 天  完整预报=${(w.forecast||[]).length} 天`)
    console.log(`   图标 ${JSON.stringify(w.icNow)}`)
  } catch (e) { console.log(`【${name}】 失败: ${e.message}`) }
}
