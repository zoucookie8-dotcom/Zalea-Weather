
import router from '@system.router'
import {
  loadCache, loadCityName, withIcons, forecastRows, hhmm,
} from '../../common/weather'

export default {
  private: {
    city: '',
    rows: [],
    hasDays: false,
    emptyText: '',
    emptySub: '',
    footText: '',
  },

  // 这一页只读缓存，不自己发请求：
  //   1) 保证和主页显示的是同一份数据，不会两边对不上；
  //   2) 断网时照样能看，符合这个应用"离线可用"的前提；
  //   3) 省一次网络请求和一份电。
  // 想刷新就返回主页点一下，那边有完整的取数逻辑。
  onInit() { this.load() },

  // 页面被复用的话 onInit 不会再跑（比如回主页切了城市又进来），
  // 所以显示时也读一次。只读本地缓存、不发网络，重复调用没有副作用。
  onShow() { this.load() },

  async load() {
    const saved = await loadCityName()
    if (saved) this.city = saved

    const cached = await loadCache()
    if (!cached || !cached.now) {
      this.emptyText = '还没有数据'
      this.emptySub = '回主页联网获取一次'
      this.footText = '暂无缓存'
      this.rows = []
      this.hasDays = false
      return
    }

    // 缓存属于另一个城市就不能拿来充数：主页刚切到上海、还没抓到，
    // 这里却把北京的 7 天列出来，两边就对不上了。宁可空着说清楚。
    if (this.city && cached.city && cached.city !== this.city) {
      this.emptyText = '还没有 ' + this.city + ' 的预报'
      this.emptySub = '回主页联网获取一次'
      this.footText = '缓存是' + cached.city + '的'
      this.rows = []
      this.hasDays = false
      return
    }

    if (cached.city) this.city = cached.city

    const model = withIcons(cached)
    const rows = forecastRows(model)
    this.rows = rows
    this.hasDays = rows.length > 0

    if (!this.hasDays) {
      this.emptyText = cached.src === 'cn'
        ? '备用源没有多日预报'
        : '这次没取到多日预报'
      this.emptySub = cached.src === 'cn'
        ? '中国天气网接口只给当天'
        : '回主页点一下重试'
    }

    const src = cached.src === 'cn' ? '中国天气网' : 'Open-Meteo'
    this.footText = '更新 ' + hhmm(cached.ts) + ' · ' + src
  },

  goBack() {
    router.back()
  },
}
