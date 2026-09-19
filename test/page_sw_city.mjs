
import router from './shim_stack.mjs'
import prompt from './shim_prompt.mjs'
import cities from './cities.js'
import { saveCityName, loadCityName } from './weather_sw.js'

// 手表屏幕小，默认只列常用城市；输入关键词后在全部 105 个里搜
const HOT = ['北京', '上海', '广州', '深圳', '杭州', '成都', '重庆', '武汉',
             '西安', '南京', '天津', '苏州', '长沙', '郑州', '青岛', '沈阳',
             '大连', '厦门', '福州', '昆明', '合肥', '济南', '哈尔滨', '南昌']
const MAX_SHOWN = 40

function byName(n) {
  for (let i = 0; i < cities.length; i++) if (cities[i].n === n) return cities[i]
  return null
}

function hotList() {
  const out = []
  for (let i = 0; i < HOT.length; i++) {
    const c = byName(HOT[i])
    if (c) out.push(c)
  }
  return out
}

export default {
  private: {
    q: '',
    cur: '',
    shown: hotList(),
    countText: '常用',
  },

  async onInit() {
    // 当前城市从 storage 读，不依赖路由传参
    const cur = await loadCityName()
    if (cur) this.cur = cur
  },

  onSearch(evt) {
    const q = ((evt && evt.value) || '').trim().toLowerCase()
    this.q = q

    if (!q) {
      this.shown = hotList()
      this.countText = '常用'
      return
    }

    const out = []
    for (let i = 0; i < cities.length && out.length < MAX_SHOWN; i++) {
      const c = cities[i]
      if (c.n.indexOf(q) >= 0 || c.py.indexOf(q) >= 0 || c.p.indexOf(q) >= 0) {
        out.push(c)
      }
    }
    this.shown = out
    this.countText = out.length ? out.length + ' 个结果' : '无结果'
  },

  async pick(item) {
    if (!item || !item.n) return
    // 等城市名落盘再返回。主页回来时会立刻读它（index.ux 的 syncCity），
    // 而 storage.set 是异步的 —— 不等就可能读到旧城市，看起来像没切成功。
    await saveCityName(item.n)
    prompt.showToast({ message: '已切换到 ' + item.n, duration: 1200 })
    router.back()
  },

  goBack() {
    router.back()
  },
}
