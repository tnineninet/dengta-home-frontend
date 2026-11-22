# 网易云导入 / 播放问题排查与修复记录

## 背景
用户反馈两个问题：
1. 网易云歌单导入「成功」但读出来是 0 条歌。
2. 单曲链接导入后可点击跳转网易云播放，但软件内无实时进度，AI 伴侣也无法「理解/听到」歌曲内容。

## 问题一：歌单导入 0 条歌（已修复）

### 根因：后端把失败「静默吞掉」，保存了空歌单
`services/netease-cloud-music.js` 的 `importShare` / `playlistDetail` 存在三条静默失败路径，最终都保存了 `items: []` 的歌单：

1. **网易云 MCP 未登录 / 请求失败**：`cloud_music_playlist_detail` 返回文本 `获取失败: 未登录，请先调用 login 工具`（不是结构化 error）。`playlistDetailRecord` 解析不到标题 → 回退到空数组 → 保存 0 条。
2. **歌单曲目数 ≥ 1000**：标题正则 `(\d{1,3})首` 匹配不了 4 位以上 `trackCount` → `playlistDetailRecord` 返回 null → 0 条。
3. **未连接 MCP**：`importShare` 对歌单且无 `connection_id` 直接走 `saveExternalResource`（`items: []`），静默保存空歌单。

### 修复（`services/netease-cloud-music.js`）
- `playlistDetailRecord` 标题正则放宽为 `(\d{1,6})首`。
- `playlistDetail`：检测 `获取失败/未登录/失败` 等错误文本，抛 `502 netease_playlist_detail_unavailable`；解析后若 `items` 为空，抛 `502 netease_playlist_detail_empty`。
- `importShare`：歌单且无 `connection_id` 时抛 `400 netease_connection_required`（提示先连接 MCP）。

### 测试
`test/music-listening.test.js` 新增 3 个断言（错误文本、空歌单、无连接）。相关套件全部通过：
`music-listening` / `music-queue` / `music-routes` / `listening-runtime`。

## 问题二：无进度 + AI「听不到/不理解」（架构限制，未改动）

### 现状架构
网易云歌曲是 `external_netease` 播放模式：点击后通过 `orpheus://song/{id}` deep link 跳转到**外部网易云 App** 播放。DengTa 不持有音频流，因此：

- **无法实时进度**：DengTa 观察不到外部网易云 App 的播放位置；`media_position_seconds` 只在 DengTa 自己是播放器（内部播放）时由客户端同步。
- **AI 无法「听到」音频**：要把音频喂给 AI 需要流式获取音频源，会绕过网易云版权/DRM/防盗链（违反项目规则 5）。

### 已有的「理解」机制（仅内部播放可用）
`services/listening-runtime-context.js` 会在「一起听」会话（`co_watch_sessions.session_mode = "listening"`）激活时，把歌曲元数据（标题/歌手/歌单/播放状态/位置）和 `music_playlist_items.lyrics` 注入 AI 上下文，并明确声明「AI 没有直接听见音频，只知道客户端同步的播放元数据」。

该机制对**内部播放**（有合法可播放 URL 的音频）完整可用；对**外部网易云播放**不适用（无会话位置、无音频）。

### 歌词缺口
两个 MCP 都**没有**歌词工具：
- `cloud-music-mcp` 工具：status / login / daily_recommend / my_playlists / search / playlist_detail / create_playlist / add_to_playlist / album_info / artist_info / my_subscriptions / play。
- `netease-music-mcp` 工具：play_music / update_playlist_description / create_playlist / add_to_playlist / remove_from_playlist / list_my_playlists / get_playlist_songs / get_play_history / like_song / daily_recommend。

`music_playlist_items.lyrics` 字段已存在、`listening-runtime-context.js` 也读取它，但网易云歌曲导入时不抓歌词，字段为空。

### 可行方向（供后续决策，未实施）
- 让 AI「讨论」某首歌：用户把歌名/歌词贴进聊天，AI 即可讨论（现有聊天能力即可）。
- 让 AI 自动「理解」网易云歌曲：需先给 MCP 增加歌词工具（`cloud_music_lyric`），后端导入时抓歌词写入 `lyrics`，再配合「一起听」会话。属于第三方 MCP 或用户自托管服务的改动，超出本次修复范围。
- 完整「听到 + 进度同步」：仅对**内部播放**的合法音频可行，网易云外部播放无法在不违反 DRM 规则的前提下实现。
