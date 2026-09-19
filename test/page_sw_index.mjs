
import router from './shim_stack.mjs'
import prompt from './shim_prompt.mjs'
import cities from './cities.js'
// 城市名由 city.ux 负责写，这里只读，所以不引 saveCityName
import {
  fetchWeather, saveCache, loadCache, cacheFresh,
  loadCityName, withIcons, hhmm,
} from './weather_sw.js'

const DEFAULT_CITY = '北京'

function findCity(name) {
  for (let i = 0; i < cities.length; i++) if (cities[i].n === name) return cities[i]
  return null
}

export default {
  private: {
    city: DEFAULT_CITY,
    model: null,
    hasData: false,
    offline: false,
    busy: false,
    pending: false,
    ready: false,
    srcLabel: '',
    feelsText: '--',
    humText: '--',
    windText: '--',
    noForecast: false,
    forecastHint: '',
    emptyText: '还没有数据，联网后会自动获取',
    footText: '正在获取…',
  },

  onInit() {
    this.boot()
  },

  // onShow 有两个来路，得分开对待：
  //   1) 抬腕亮屏 —— 什么都不能做，否则每抬一次手腕打一次网络；
  //   2) 从城市页返回 —— 用户刚选完城市，必须把新城市读回来。
  // 区分办法：读一次本地存储看城市变没变（不发网络），变了才抓数据。
  //
  // 早先这里只判"缓存过期才刷新"，从城市页返回时缓存正好是新鲜的，
  // 于是整个 onShow 什么都不做 —— 城市页写的城市名根本没机会被主页看见。
  // 主页只认 this.city，而 this.city 只在 boot() 里读过一次存储，
  // 所以选了新城市也得等应用重启才生效。这就是"切不了城市"的根因。
  onShow() {
    // 应用刚起来时 onShow 会先于 boot() 的 await 跑一次，那时城市还没定，
    // 放它进来会和 boot() 抢着 pull。
    if (!this.ready) return
    this.syncCity()
  },

  async syncCity() {
    const saved = await loadCityName()
    if (saved && saved !== this.city && findCity(saved)) {
      this.city = saved
      // 旧城市的数据不能挂在新城市名下：顶着"上海"显示北京的 27°，
      // 比先空着更糟 —— 用户没法判断到底切没切成功。
      this.dropData()
      this.pull(true)
      return
    }
    // 城市没变，那就是抬腕亮屏：缓存过期才刷新，新鲜就不动
    if (this.hasData && !cacheFresh(this.model)) this.pull(false)
  },

  dropData() {
    this.model = null
    this.hasData = false
    this.offline = false
    this.emptyText = '正在获取 ' + this.city + ' 的天气…'
    this.footText = '正在获取…'
  },

  async boot() {
    const saved = await loadCityName()
    if (saved && findCity(saved)) this.city = saved

    const cached = await loadCache()
    // 只判 cached.now 是不够的：缓存里存的可能是上一个城市。切了城市但没抓到
    // 新数据就退出，下次启动会把旧城市的数据铺到新城市的标题底下。
    if (cached && cached.now && cached.city === this.city) {
      // 先把缓存铺满屏幕，再在后台刷新。
      // pull 不 await：缓存已经可见了，没必要让首屏等网络。
      this.apply(withIcons(cached))
      this.pull(false)
    } else {
      this.pull(true)
    }
    // 到这里城市才算定下来，此前不许 onShow 抢着 pull
    this.ready = true
  },

  async pull(showLoading) {
    const city = findCity(this.city) || findCity(DEFAULT_CITY)
    if (!city) return

    // 已经有一个请求在路上：记一笔待办，等它回来再抓。
    // 早先这里是直接 return，于是"切城市时正好在抓旧城市"这一下就被吞了 ——
    // 新城市的请求永远排不上队，界面就一直停在旧城市。
    if (this.busy) { this.pending = true; return }

    this.busy = true
    if (showLoading) this.footText = '正在获取…'

    try {
      const model = await fetchWeather(city)
      // 请求飞出去到回来这段时间里用户可能又换了城市。这份结果已经配不上
      // 当前选择了，扔掉 —— 否则它会把刚切过去的城市又顶回来。
      if (city.n === this.city) {
        this.apply(withIcons(model))
        saveCache(model)
      }
    } catch (e) {
      // 失败同理：旧城市的失败不该污染新城市的状态
      if (city.n === this.city) {
        this.offline = true
        if (this.hasData) {
          prompt.showToast({ message: '获取失败，显示离线数据', duration: 2000 })
        } else {
          this.emptyText = '联网失败，请检查网络后重试'
        }
        this.footText = this.hasData
          ? '离线 · 数据时间 ' + hhmm(this.model.ts)
          : '获取失败'
      }
    }

    this.busy = false
    if (this.pending) { this.pending = false; this.pull(false) }
  },

  apply(model) {
    if (!model || !model.now) return

    const n = model.now
    this.model = model
    this.hasData = true
    // 这里原本有一句 `this.city = model.city || this.city`，删掉。
    // 它让"谁最后返回谁说了算"：一份晚到的旧城市响应能把用户刚选的城市改回去。
    // 城市只由用户的选择决定（this.city），数据只负责填内容 ——
    // pull() 已经保证不会拿别的城市的数据来调 apply。
    this.srcLabel = model.src === 'cn' ? '中国天气网' : 'Open-Meteo'

    this.feelsText = (n.feels === null || n.feels === undefined) ? '--' : n.feels + '°'
    this.humText = (n.hum === null || n.hum === undefined) ? '--' : n.hum + '%'
    this.windText = (n.ws === null || n.ws === undefined)
      ? (n.wd || '--')
      : ((n.wd || '') + n.ws + '级')

    const days = model.days || []
    this.noForecast = days.length === 0
    this.forecastHint = '备用源无多日预报'

    // 只有拿到实时数据才算在线；兜底源也算在线
    this.offline = false
    this.footText = '更新 ' + hhmm(model.ts) + ' · 点按刷新'
  },

  refresh() {
    this.pull(true)
  },

  openCity() {
    router.push({ uri: '/pages/city' })
  },

  // 预报页只读缓存，所以这里不用先确保数据是新的 —— 它显示的
  // 就是主页此刻显示的同一份数据
  openForecast() {
    router.push({ uri: '/pages/forecast' })
  },
}
