# 藏宝地图底图：在线、离线与高德方案评估

2026-10-20。本文只描述可行方案与授权边界；当前代码默认仍使用 OpenStreetMap 在线瓦片，没有打包离线地图，也没有接入高德/百度 SDK。

## 1. 当前实现

- 底图地址：`src/surprise-map-display.js` 的 `SURPRISE_MAP_TILES`，默认 `https://tile.openstreetmap.org/{z}/{x}/{y}.png`。
- 构建时可替换：
  - `VITE_SURPRISE_MAP_TILES`：任意 `{z}/{x}/{y}` 栅格瓦片模板；
  - `VITE_SURPRISE_MAP_ATTRIBUTION`：对应的署名 HTML。
- 底图只在用户明确点「本次开启街道地图」后加载；关闭、切账号/伴侣、页面隐藏时销毁或暂停。
- 请求只包含粗略视区，不包含信件正文、账号 ID、令牌或精确 GPS 回执。

## 2. 方案对比

| 方案 | 能否离线 | 授权/成本 | 适配方式 | 建议 |
| --- | --- | --- | --- | --- |
| OpenStreetMap 官方瓦片 | 否 | 遵守 [tile usage policy](https://operations.osmfoundation.org/policies/tiles/)，禁止批量抓取 | 默认 | 仅适合小规模/开发；生产需换 |
| 自建 OSM 瓦片（Planetiler / tilemaker + tileserver-gl） | 可（本机/内网服务） | ODbL，需署名；城市级 mbtiles 通常数百 MB 到数 GB | `VITE_SURPRISE_MAP_TILES=http://你的瓦片服务/{z}/{x}/{y}.png` | **推荐的离线路线** |
| MapTiler / Mapbox 等商业栅格 | 可缓存但受条款限制 | 按量计费/Key | 同上，填他们的栅格模板与署名 | 有预算时最省事 |
| 高德/百度 JS API | 否（需在线鉴权） | 需 Key、安全密钥，受服务条款约束；不是 `{z}/{x}/{y}` 模板 | 不能直接套当前 `tileLayer`，要另写 SDK 适配层 | 可做，但需要单独评估条款与鉴权 |
| 从高德/百度 App 提取离线包 | 名义上可 | **通常违反其用户协议与数据授权**，且格式/加密不公开 | 不建议 | 不采用 |

## 3. 自建离线瓦片的落地步骤（示例）

1. 从 [Geofabrik](https://download.geofabrik.de/) 下载所需省/市 OSM extract。
2. 用 Planetiler 或 tilemaker 生成 `mbtiles`，只保留道路、地名、公园等必要图层。
3. 用 `tileserver-gl` 或 nginx + mbtiles 暴露为 `http://127.0.0.1:8080/{z}/{x}/{y}.png`。
4. 构建前端时设置：
   ```dotenv
   VITE_SURPRISE_MAP_TILES=http://127.0.0.1:8080/{z}/{x}/{y}.png
   VITE_SURPRISE_MAP_ATTRIBUTION=&copy; OpenStreetMap contributors
   ```
5. 如果服务在内网/本机，Android 真机需要能访问该地址；正式产品建议放在有 HTTPS 与容量保障的自建域名下。

## 4. 为什么不把整包地图塞进 APK

- 一个城市级栅格包通常几百 MB，全国包会到数十 GB；
- 地图数据有独立许可证与更新节奏，塞进 APK 后每次更新都要重新发版；
- 当前 APK 已约 41.6 MB，继续膨胀会影响安装与低端机体验。

更合适的是：APK 只带界面和缓存，底图由可替换的瓦片服务提供；需要离线时在设置里下载**按城市**的离线包到本机存储（后续可做，但需要独立的存储/清理/授权设计）。

## 5. 隐私与合规

- 底图服务能看到请求方的 IP 与当前查看区域；不要把精确 GPS、信件正文或账号信息拼进瓦片 URL。
- 自建瓦片同样要保留 OpenStreetMap/数据提供方的署名。
- 高德/百度的离线包、POI 数据与路径规划结果不能脱离其授权单独再分发。
## 6. 已实现的底图选择（2026-10-20）

藏宝地图的「开启沿途的地图」弹窗里现在可以直接选：

- **OpenStreetMap**：默认，WGS84；
- **高德地图**：GCJ-02 栅格瓦片；信件范围、公共落点和选点会自动做 WGS84 ↔ GCJ-02 换算，服务端仍只存 WGS84；
- **MapTiler**：填入自己的 Key，保存在本机当前账号；
- **自定义 / 离线瓦片**：填任意 `{z}/{x}/{y}` 模板与署名，或导入一份 JSON 清单（`template`、`attribution`），用于指向自建/内网瓦片服务。

注意：`自定义 / 离线瓦片` 目前是"登记瓦片服务地址"，还没有把 MBTiles/PMTiles/瓦片 ZIP 直接上传到 App 内；真正的离线包上传与解析是下一阶段，需要先确定存储配额、瓦片格式和清理策略。高德 Web API Key 也还没有接入反向地理编码/POI，当前只用其公开栅格底图。
