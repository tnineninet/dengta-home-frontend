# monologue-stream 上游审计与 DengTa 集成借鉴点

状态：上游一手资料研究已锁定；随后已在同一工作树按本文 seam 实施后端 Phase 1。没有修改数据库 schema、用户数据、供应商配置或部署。

审计仓库：`tsuru0805/monologue-stream`

锁定快照：GitHub 默认分支在观察时为 `main`，`HEAD` 为 [`74ecec69fb8cf29e87162d1a95d2e568306b3a86`](https://github.com/tsuru0805/monologue-stream/commit/74ecec69fb8cf29e87162d1a95d2e568306b3a86)。作者时间与提交者时间均为 `2026-08-11T07:31:31Z`（`2026-08-11T16:31:31+09:00`）；观察时间为 `2026-08-12T14:20:03Z`（中国标准时间 `2026-08-12T22:20:03+08:00`）。包版本为 `0.1.0`（[固定版本清单](https://github.com/tsuru0805/monologue-stream/blob/74ecec69fb8cf29e87162d1a95d2e568306b3a86/pyproject.toml#L1-L10)）。分支名会移动，因此本文的源码链接全部固定到上述完整 SHA。

## 结论先行

1. **它不是隐藏思考链提取器。** 它让模型在普通回复正文开头显式生成一个 `[monologue]...[/monologue]` 块，再把这个块流式拆到“心声/思考”UI。上游明确写明，这只是模型在上下文中为人类生成的“可见自省”，不是模型供应商隐藏的原始 chain of thought，也不会改变模型真实推理深度（[README 边界](https://github.com/tsuru0805/monologue-stream/blob/74ecec69fb8cf29e87162d1a95d2e568306b3a86/README.en.md#L35-L50)，[模块说明](https://github.com/tsuru0805/monologue-stream/blob/74ecec69fb8cf29e87162d1a95d2e568306b3a86/monologue_filter.py#L1-L20)）。
2. **它适合解决“回复生成时心声同步出现”，不适合宣称“展示真实脑内推理”。** 对产品文案更诚实的命名是“AI 生成的心声”“可见独白”或“回应思路”；不应称为“真实思考链”“模型脑海原文”。这是从上游明确边界得出的产品推论（[README 边界](https://github.com/tsuru0805/monologue-stream/blob/74ecec69fb8cf29e87162d1a95d2e568306b3a86/README.en.md#L35-L50)）。
3. **核心可借鉴点是一个很窄的纯流式 seam。** 每个供应商适配层只需按顺序给过滤器喂普通文本 delta；过滤器立即返回正文增量、独白增量和一次性的闭合信号。它不要求拿到完整回复，也不耦合数据库、SSE、WebSocket 或任何模型 SDK（[过滤器契约](https://github.com/tsuru0805/monologue-stream/blob/74ecec69fb8cf29e87162d1a95d2e568306b3a86/monologue_filter.py#L34-L67)，[feed 返回值](https://github.com/tsuru0805/monologue-stream/blob/74ecec69fb8cf29e87162d1a95d2e568306b3a86/monologue_filter.py#L89-L100)）。
4. **上游没有定义应用级消息/事件协议。** README 中的 `emit_thinking()` / `emit_text()` 只是占位调用；示例最终也只是打印到终端。事件名、turn ID、sequence、幂等、断线重放、最终状态和错误语义都必须由 DengTa 自己定义（[快速接线](https://github.com/tsuru0805/monologue-stream/blob/74ecec69fb8cf29e87162d1a95d2e568306b3a86/README.en.md#L62-L81)，[Anthropic 示例输出](https://github.com/tsuru0805/monologue-stream/blob/74ecec69fb8cf29e87162d1a95d2e568306b3a86/examples/anthropic_api_streaming.py#L40-L66)）。
5. **不要把生成生命周期绑在“查看心声”按钮或当前客户端连接上。** 上游的生产建议是：服务器持续消费模型流并逐段持久化，SSE/WebSocket 只是直播视图；客户端断线不终止生成，回来后重连进行中流或从数据库读取已完成内容（[生产流式建议](https://github.com/tsuru0805/monologue-stream/blob/74ecec69fb8cf29e87162d1a95d2e568306b3a86/README.en.md#L119-L131)）。这正是避免“先提示没有心声，稍后又变成同步中”的关键架构 seam。

## 它实际生成的是什么

上游把两个不同对象明确分开：

| 对象 | 产生位置 | 上游能否取得 | 应如何呈现 |
|---|---|---:|---|
| 供应商内部隐藏的原始 CoT | 模型内部/供应商 thinking 管线 | 否；该仓库不恢复它 | 不声称可见，也不伪装成已取得 |
| 供应商可能返回的 thinking 摘要 | 供应商专用 thinking 通道 | 视模型与配置而定 | 可单独保存或忽略，但不是本仓核心输入 |
| 本仓的 visible monologue | 普通 assistant 正文最开头，由提示词要求模型显式撰写 | 是；它就是普通文本 token | 流式拆入“心声”UI，并明确这是 AI 生成内容 |

这个分类来自仓库自己的数据流图和“不解决什么”声明（[正文独白与供应商 thinking 的区分](https://github.com/tsuru0805/monologue-stream/blob/74ecec69fb8cf29e87162d1a95d2e568306b3a86/README.en.md#L5-L15)，[不能恢复 raw CoT](https://github.com/tsuru0805/monologue-stream/blob/74ecec69fb8cf29e87162d1a95d2e568306b3a86/README.en.md#L35-L50)）。

作为 2026-08-12 的官方交叉核验，Anthropic 文档也明确说明其可显示 thinking 是摘要而非 raw chain of thought，且没有 `display` 设置可以返回 raw CoT；摘要由不同模型处理，行为未来可能变化（[Anthropic Thinking 官方文档](https://platform.claude.com/docs/en/build-with-claude/thinking#summarized-thinking)）。这条外部链接不是仓库快照的一部分，仅用于核验上游对其示例供应商的描述；本报告的代码结论仍以固定 commit 为准。

因此，产品层还应承认一个进一步的事实：可见独白是模型按提示词生成的自我叙述，可能带有人设、修辞、错误归因或迎合，并不天然构成对生成最终答案因果过程的忠实记录。这个判断是由“它位于普通 text output、受 system prompt 和 style 控制”推得，而非仓库声称能够证明忠实性（[源码说明](https://github.com/tsuru0805/monologue-stream/blob/74ecec69fb8cf29e87162d1a95d2e568306b3a86/monologue_filter.py#L1-L20)，[prompt 示例](https://github.com/tsuru0805/monologue-stream/blob/74ecec69fb8cf29e87162d1a95d2e568306b3a86/examples/anthropic_api_streaming.py#L18-L35)）。

## 流式输出机制

完整路径是：

```text
system prompt 要求正文卷首写 [monologue]...[/monologue]
                         |
                         v
供应商普通 text delta（有序）
                         |
                         v
               MonologueFilter.feed(delta)
                    /                  \
      mono_out -> 心声直播/落库      text_out -> 正文直播/落库
                    \                  /
                     closed_now / finish()
                         |
                         v
              回合终态、快照、断线重放（应用自行实现）
```

上游要求独白位于正文最前面，并用 prompt 约束每轮都写；直接 API 示例把 `stream.text_stream` 的每个普通文本增量按顺序交给一个过滤器实例（[prompt 与位置约定](https://github.com/tsuru0805/monologue-stream/blob/74ecec69fb8cf29e87162d1a95d2e568306b3a86/examples/anthropic_api_streaming.py#L18-L35)，[文本流接线](https://github.com/tsuru0805/monologue-stream/blob/74ecec69fb8cf29e87162d1a95d2e568306b3a86/examples/anthropic_api_streaming.py#L40-L59)）。

`feed(chunk)` 的正式返回值是 `(text_out, mono_out, closed_now)`：两个文本输出都可能为空；`closed_now` 只在本次调用刚识别到闭合标记时为真。`finish()` 的返回值是 `(text_out, mono_out)`，用于流结束时清算仍在缓冲区的内容（[feed 契约](https://github.com/tsuru0805/monologue-stream/blob/74ecec69fb8cf29e87162d1a95d2e568306b3a86/monologue_filter.py#L94-L100)，[finish 契约](https://github.com/tsuru0805/monologue-stream/blob/74ecec69fb8cf29e87162d1a95d2e568306b3a86/monologue_filter.py#L148-L168)）。

过滤器是三态状态机：

- `SEEK`：只在流开头寻找开标记，允许前导空白；只要缓冲区仍可能是开标记前缀就继续扣留。一旦分叉，整个缓冲按原文输出到正文，并永久进入 `PASS`（[SEEK 实现](https://github.com/tsuru0805/monologue-stream/blob/74ecec69fb8cf29e87162d1a95d2e568306b3a86/monologue_filter.py#L101-L123)）。
- `IN`：寻找闭标记；如果本块没有完整闭标记，只扣留“可能是闭标记开头”的最长尾缀，其余独白立即输出，所以标记被 chunk 撕裂时仍能逐步直播（[IN 实现](https://github.com/tsuru0805/monologue-stream/blob/74ecec69fb8cf29e87162d1a95d2e568306b3a86/monologue_filter.py#L124-L139)，[尾缀重合算法](https://github.com/tsuru0805/monologue-stream/blob/74ecec69fb8cf29e87162d1a95d2e568306b3a86/monologue_filter.py#L170-L177)）。
- `PASS`：闭标记之后的所有内容原样成为正文，不再识别第二个独白块（[PASS 实现](https://github.com/tsuru0805/monologue-stream/blob/74ecec69fb8cf29e87162d1a95d2e568306b3a86/monologue_filter.py#L124-L146)，[只识别第一对的测试](https://github.com/tsuru0805/monologue-stream/blob/74ecec69fb8cf29e87162d1a95d2e568306b3a86/tests/test_monologue_filter.py#L121-L136)）。

状态机的重要边界行为：

- 没有卷首标记时，输入按原文进入正文，`mono_out` 为空；中途出现的标记按字面文本处理（[passthrough 测试](https://github.com/tsuru0805/monologue-stream/blob/74ecec69fb8cf29e87162d1a95d2e568306b3a86/tests/test_monologue_filter.py#L72-L105)）。
- 找到卷首标记时，标记和它之前的空白会被丢弃；若始终没找到完整标记，空白或未完成前缀会在 `finish()` 时原样归正文（[卷首识别](https://github.com/tsuru0805/monologue-stream/blob/74ecec69fb8cf29e87162d1a95d2e568306b3a86/monologue_filter.py#L106-L123)，[finish 清算](https://github.com/tsuru0805/monologue-stream/blob/74ecec69fb8cf29e87162d1a95d2e568306b3a86/monologue_filter.py#L148-L168)）。
- 流结束时仍未闭合的块不会被丢弃，剩余内容归入独白；这不等于回复成功完成，应用仍应把回合标为截断/中断，而不是无限“同步中”（[未闭合测试](https://github.com/tsuru0805/monologue-stream/blob/74ecec69fb8cf29e87162d1a95d2e568306b3a86/tests/test_monologue_filter.py#L108-L144)，[部分闭标记清算测试](https://github.com/tsuru0805/monologue-stream/blob/74ecec69fb8cf29e87162d1a95d2e568306b3a86/tests/test_monologue_filter.py#L177-L203)）。
- 标记可自定义，但不能为空，且开标记不能以空白开头（[构造器校验](https://github.com/tsuru0805/monologue-stream/blob/74ecec69fb8cf29e87162d1a95d2e568306b3a86/monologue_filter.py#L69-L87)，[自定义与错误测试](https://github.com/tsuru0805/monologue-stream/blob/74ecec69fb8cf29e87162d1a95d2e568306b3a86/tests/test_monologue_filter.py#L146-L174)）。
- `monologue_text` 会累计本实例已输出的全部独白，方便取完整值，但也意味着长独白会被额外保留一份内存副本（[累计实现](https://github.com/tsuru0805/monologue-stream/blob/74ecec69fb8cf29e87162d1a95d2e568306b3a86/monologue_filter.py#L83-L92)，[追加位置](https://github.com/tsuru0805/monologue-stream/blob/74ecec69fb8cf29e87162d1a95d2e568306b3a86/monologue_filter.py#L140-L168)）。

## 消息与事件协议

### 仓库真正定义的协议

| 层 | 输入 | 输出/动作 | 生命周期规则 | 固定来源 |
|---|---|---|---|---|
| 核心过滤器 | 一个有序的 Python `str` chunk | `(text_out, mono_out, closed_now)` | 一条 assistant 回复一个实例 | [源码契约](https://github.com/tsuru0805/monologue-stream/blob/74ecec69fb8cf29e87162d1a95d2e568306b3a86/monologue_filter.py#L34-L67) |
| 流尾 | 无新 chunk | `(text_out, mono_out)` | 每条流结束必须调用 `finish()` | [finish](https://github.com/tsuru0805/monologue-stream/blob/74ecec69fb8cf29e87162d1a95d2e568306b3a86/monologue_filter.py#L148-L168) |
| Anthropic Python 示例 | `stream.text_stream` 的普通文本 delta | 分别打印独白和正文 | 单回复单实例 | [示例](https://github.com/tsuru0805/monologue-stream/blob/74ecec69fb8cf29e87162d1a95d2e568306b3a86/examples/anthropic_api_streaming.py#L40-L66) |
| Claude CLI JSONL 示例 | 顶层 `type=stream_event`，内层 `message_start` 或 `content_block_delta/text_delta` | `message_start` 清算旧实例并新建；`text_delta.text` 喂过滤器 | 跳过带 `parent_tool_use_id` 的子代理/工具子流 | [JSONL 适配](https://github.com/tsuru0805/monologue-stream/blob/74ecec69fb8cf29e87162d1a95d2e568306b3a86/examples/claude_p_stream_json.py#L48-L84) |

CLI 示例具体识别的外层/内层形状可概括为：

```json
{"type":"stream_event","event":{"type":"message_start"}}
{"type":"stream_event","event":{"type":"content_block_delta","delta":{"type":"text_delta","text":"..."}}}
```

这只是对 Claude CLI 输出的适配，不是 monologue-stream 自己制定的网络协议；代码还明确忽略 JSON 解析失败、非 `stream_event`、子流和非 `text_delta` 事件（[CLI 事件筛选](https://github.com/tsuru0805/monologue-stream/blob/74ecec69fb8cf29e87162d1a95d2e568306b3a86/examples/claude_p_stream_json.py#L48-L78)）。

### 仓库没有定义的协议

上游没有提供以下任何应用层契约：

- SSE/WebSocket event name；
- `user_id`、`companion_id`、conversation ID、turn ID 或 message ID；
- 单调 sequence/cursor、幂等键、ack、重放窗口或断线续传；
- `started / streaming / complete / missing / interrupted / failed` 等终态；
- 心声和正文的数据库 schema、事务边界、权限或保留策略；
- backpressure、取消、超时、重试、并发回合或跨进程恢复。

这是对仓库范围的静态结论：项目只导出一个 `MonologueFilter` 模块，示例把分流结果打印到终端，README 只以抽象 `emit_thinking()` / `emit_text()` 表示应用层（[导出与版本](https://github.com/tsuru0805/monologue-stream/blob/74ecec69fb8cf29e87162d1a95d2e568306b3a86/monologue_filter.py#L23-L31)，[快速接线](https://github.com/tsuru0805/monologue-stream/blob/74ecec69fb8cf29e87162d1a95d2e568306b3a86/README.en.md#L62-L81)，[项目清单仅打包单模块](https://github.com/tsuru0805/monologue-stream/blob/74ecec69fb8cf29e87162d1a95d2e568306b3a86/pyproject.toml#L16-L21)）。

## 关键依赖与运行边界

- 核心包要求 Python `>=3.9`，版本 `0.1.0`；项目没有声明运行时 `dependencies`，`monologue_filter.py` 只导入标准库 `__future__`，所以“零运行时依赖”与源码相符（[pyproject](https://github.com/tsuru0805/monologue-stream/blob/74ecec69fb8cf29e87162d1a95d2e568306b3a86/pyproject.toml#L1-L10)，[模块 imports](https://github.com/tsuru0805/monologue-stream/blob/74ecec69fb8cf29e87162d1a95d2e568306b3a86/monologue_filter.py#L20-L26)）。
- 构建依赖是 `setuptools>=77`，构建后端为 `setuptools.build_meta`，只发布 `monologue_filter` 单模块（[构建清单](https://github.com/tsuru0805/monologue-stream/blob/74ecec69fb8cf29e87162d1a95d2e568306b3a86/pyproject.toml#L16-L21)）。
- 测试文件依赖 `pytest`，但 pyproject 没有声明 dev/test extra；因此直接运行测试的环境要自行安装 pytest（[测试 import](https://github.com/tsuru0805/monologue-stream/blob/74ecec69fb8cf29e87162d1a95d2e568306b3a86/tests/test_monologue_filter.py#L1-L13)，[完整项目清单](https://github.com/tsuru0805/monologue-stream/blob/74ecec69fb8cf29e87162d1a95d2e568306b3a86/pyproject.toml#L1-L21)）。
- 直接 API 示例额外需要 `anthropic` Python SDK 和环境中的 API key；这是示例依赖，不是核心过滤器依赖（[示例头部](https://github.com/tsuru0805/monologue-stream/blob/74ecec69fb8cf29e87162d1a95d2e568306b3a86/examples/anthropic_api_streaming.py#L1-L16)）。
- CLI 示例只使用 Python 标准库加本模块，但外部要求 `claude` CLI 已在 PATH 且完成登录；这也是示例运行条件，不是核心包依赖（[CLI 示例头部](https://github.com/tsuru0805/monologue-stream/blob/74ecec69fb8cf29e87162d1a95d2e568306b3a86/examples/claude_p_stream_json.py#L1-L24)）。
- 仓库不包含服务端、数据库、Web UI、移动端 SDK 或部署清单；因此不能把它当作完整的“心声同步服务”，只能当作一个解析原语和生产经验说明（[固定 commit 文件树](https://github.com/tsuru0805/monologue-stream/tree/74ecec69fb8cf29e87162d1a95d2e568306b3a86)，[单模块打包](https://github.com/tsuru0805/monologue-stream/blob/74ecec69fb8cf29e87162d1a95d2e568306b3a86/pyproject.toml#L16-L21)）。

## 许可证与复用限制

仓库使用 MIT License，版权行为 `Copyright (c) 2026 tsuru0805`。许可证允许使用、复制、修改、合并、发布、分发、再许可和销售，但要求软件的所有副本或实质性部分保留版权声明和许可声明，并且软件按“现状”提供、无担保（[固定 LICENSE](https://github.com/tsuru0805/monologue-stream/blob/74ecec69fb8cf29e87162d1a95d2e568306b3a86/LICENSE#L1-L21)）。

对 DengTa 的实际含义：

- 如果直接复制 `monologue_filter.py`、测试、示例 prompt 或其他实质性源码/文档，应在分发物或第三方 notices 中保留 MIT 版权与许可文本（[许可条件](https://github.com/tsuru0805/monologue-stream/blob/74ecec69fb8cf29e87162d1a95d2e568306b3a86/LICENSE#L5-L13)）。
- 如果只借鉴“卷首显式块 + 流式状态机 + 两通道分发”的思想并用 DengTa 自己的语言、接口和测试独立实现，技术上更容易避免引入 Python 运行时；是否构成“实质性部分”是法律判断，仍应保留本审计作为来源记录。MIT 不限制商业使用，但也不给专利、商标或适用性保证之外的额外承诺（[完整许可证](https://github.com/tsuru0805/monologue-stream/blob/74ecec69fb8cf29e87162d1a95d2e568306b3a86/LICENSE#L1-L21)）。
- README 还列出若干思想先例，并称没有使用 `st-stepped-thinking` 代码，同时说明尾缀扣留写法从其内部 mood-filter 实现线发展而来；这是一条作者提供的来源说明，不等于本次完成了完整第三方 provenance 审计（[相关工作与归因](https://github.com/tsuru0805/monologue-stream/blob/74ecec69fb8cf29e87162d1a95d2e568306b3a86/README.en.md#L185-L195)）。

以上为工程侧许可证摘要，不构成法律意见。

## 最值得借鉴的 seam

### 1. `ProviderTextDeltaAdapter`

每个模型供应商只负责把自己的事件转换成**有序普通文本 delta**；不要把供应商的隐藏 thinking 或 thinking 摘要冒充本项目的 visible monologue。Anthropic 示例直接使用普通 `text_stream`，CLI 示例也只把 `text_delta.text` 喂给过滤器（[Anthropic adapter](https://github.com/tsuru0805/monologue-stream/blob/74ecec69fb8cf29e87162d1a95d2e568306b3a86/examples/anthropic_api_streaming.py#L46-L59)，[CLI adapter](https://github.com/tsuru0805/monologue-stream/blob/74ecec69fb8cf29e87162d1a95d2e568306b3a86/examples/claude_p_stream_json.py#L60-L84)）。

### 2. `VisibleMonologueSplitter`

把状态机做成无数据库、无网络、无 UI 的纯回合对象；输入 delta，输出 `monologueDelta / textDelta / justClosed`。如果 DengTa 后端不是 Python，优先按固定测试契约做原生移植，而不是为了一个 177 行模块增加 Python sidecar（[核心实现](https://github.com/tsuru0805/monologue-stream/blob/74ecec69fb8cf29e87162d1a95d2e568306b3a86/monologue_filter.py#L28-L177)，[测试覆盖说明](https://github.com/tsuru0805/monologue-stream/blob/74ecec69fb8cf29e87162d1a95d2e568306b3a86/README.en.md#L167-L183)）。

### 3. `AssistantReplyLifecycle`

严格执行“一条 assistant 回复一个过滤器实例”；遇到新 assistant message 或流重试时先清算/丢弃旧缓冲，再建新实例。工具调用或 agentic 循环可能在一个用户回合中产生多条 assistant response，复用实例会把后续独白漏进正文（[类契约](https://github.com/tsuru0805/monologue-stream/blob/74ecec69fb8cf29e87162d1a95d2e568306b3a86/monologue_filter.py#L34-L51)，[CLI 的 message_start 重建](https://github.com/tsuru0805/monologue-stream/blob/74ecec69fb8cf29e87162d1a95d2e568306b3a86/examples/claude_p_stream_json.py#L60-L71)）。

### 4. `DurableTurnRecorder` 与 `LiveViewPublisher`

生成循环应在服务器上独立完成并逐段持久化；直播通道只发布已持久化或可按 cursor 重放的视图。这样“查看心声”是读取已有/正在写入的同一回合状态，而不是点击后再发起一次异步补算（[上游生产配方](https://github.com/tsuru0805/monologue-stream/blob/74ecec69fb8cf29e87162d1a95d2e568306b3a86/README.en.md#L119-L131)）。

### 5. `HumanFacingContentProjection`

因为独白原始标记位于正文，推送预览、消息列表、归档、摘要、记忆抽取等所有正文消费者都必须明确选择“显示独白字段”还是“只显示净正文”，否则锁屏通知可能泄露完整心声。上游建议历史回放给模型时保留标记，以强化格式；DengTa 也可以选择分别存储后在模型历史构建时受控重组，避免让 raw content 成为多个读口的隐性炸弹（[上游踩坑说明](https://github.com/tsuru0805/monologue-stream/blob/74ecec69fb8cf29e87162d1a95d2e568306b3a86/README.en.md#L105-L117)，[上游持久化建议](https://github.com/tsuru0805/monologue-stream/blob/74ecec69fb8cf29e87162d1a95d2e568306b3a86/README.en.md#L123-L127)）。后一种“分字段存储、受控重组”是本报告提出的 seam，不是上游已有代码。

### 6. 明确的终态而不是互相冲突的提示

上游承认模型总会有不写独白的回合，并要求预先设计 fallback；过滤器本身在无标记时只给正文，不会稍后凭空产生独白。应用因此需要以同一个 turn 状态机区分 `streaming`、`complete`、`missing`、`interrupted` 和 `failed`，且终态不可从“暂时没有”倒退成“同步中”（[无独白 fallback 经验](https://github.com/tsuru0805/monologue-stream/blob/74ecec69fb8cf29e87162d1a95d2e568306b3a86/README.en.md#L105-L116)，[无标记 passthrough](https://github.com/tsuru0805/monologue-stream/blob/74ecec69fb8cf29e87162d1a95d2e568306b3a86/tests/test_monologue_filter.py#L72-L105)）。状态名是本报告给 DengTa 的建议，不是上游网络协议。

## 必须补上的风险与边界

1. **Prompt 合规不是保证。** 旧历史、短消息和特殊模式都可能让模型漏写独白；上游自己的经验也要求 fallback，不能把“每轮 prompt 都要求”当作数据库必有字段的保证（[prompt/历史经验](https://github.com/tsuru0805/monologue-stream/blob/74ecec69fb8cf29e87162d1a95d2e568306b3a86/README.en.md#L105-L116)）。
2. **标记没有转义或嵌套语法。** 独白内容如果自然出现精确闭标记，会被提前关闭；正文若恰好以开标记起头，也会被解析为独白。这是由 `.find(close_marker)` 和只认卷首的实现直接决定的（[闭标记查找](https://github.com/tsuru0805/monologue-stream/blob/74ecec69fb8cf29e87162d1a95d2e568306b3a86/monologue_filter.py#L124-L139)，[卷首识别](https://github.com/tsuru0805/monologue-stream/blob/74ecec69fb8cf29e87162d1a95d2e568306b3a86/monologue_filter.py#L106-L123)）。
3. **截断仍会发生。** `finish()` 保住已经生成的未闭合独白，但不会恢复没生成的正文，也不能把网络/供应商错误变成成功；上游明确说 `max_tokens` 和断流不在过滤器能力范围内（[能力边界](https://github.com/tsuru0805/monologue-stream/blob/74ecec69fb8cf29e87162d1a95d2e568306b3a86/README.en.md#L35-L50)，[finish 行为](https://github.com/tsuru0805/monologue-stream/blob/74ecec69fb8cf29e87162d1a95d2e568306b3a86/monologue_filter.py#L148-L168)）。
4. **可见独白可能暴露不该展示的上下文。** 由于它受整个 system prompt、历史和模型上下文影响，并被设计为直接给人看，集成方必须评估是否会吐出系统指令、内部工具信息、第三方隐私或不适合推送预览的敏感内容。上游只提醒所有人类正文消费口剥离标记，没有实现内容安全、PII 检测或访问控制（[上游显示机制](https://github.com/tsuru0805/monologue-stream/blob/74ecec69fb8cf29e87162d1a95d2e568306b3a86/monologue_filter.py#L1-L20)，[消费口风险](https://github.com/tsuru0805/monologue-stream/blob/74ecec69fb8cf29e87162d1a95d2e568306b3a86/README.en.md#L105-L117)）。
5. **前导空白可能持续缓冲。** `SEEK` 对纯空白持续等待，直到出现非空白或 `finish()`；在正常有 token 上限的模型流里风险有限，但集成层仍应有回合级长度、时间和取消上限（[SEEK 逻辑](https://github.com/tsuru0805/monologue-stream/blob/74ecec69fb8cf29e87162d1a95d2e568306b3a86/monologue_filter.py#L101-L123)）。
6. **上游测试是解析器测试，不是生产流测试。** 固定 commit 含 25 个 pytest test method，覆盖逐字符、所有二分切点、passthrough、未闭合、自定义标记和即时输出，但没有数据库、SSE/WebSocket、断线重放、并发或移动端测试（[测试源码](https://github.com/tsuru0805/monologue-stream/blob/74ecec69fb8cf29e87162d1a95d2e568306b3a86/tests/test_monologue_filter.py#L19-L203)，[固定文件树](https://github.com/tsuru0805/monologue-stream/tree/74ecec69fb8cf29e87162d1a95d2e568306b3a86)）。

## 可直接移植的测试契约

如果 DengTa 用 JavaScript/TypeScript 原生实现，至少应移植这些行为而不是逐 chunk 正则匹配：

- 整块单次输入、逐字符输入、开/闭标记在所有二分切点撕裂；
- 无标记时逐字节/逐字符等价 passthrough；
- 近似开标记分叉、仅前缀到 EOF、纯空白、空 chunk；
- 前导空白 + 有效独白；正文中途标记必须是字面文本；
- 未闭合 EOF、部分闭标记 EOF、伪闭标记前缀分叉后不得丢字；
- 只识别第一对、`closed_now` 只触发一次；
- 自定义/空/非法标记与空独白块；
- 每次 `feed()` 有可安全输出的独白时立即发出，不缓冲到结束。

这些均有固定测试证据（[基础与全切点测试](https://github.com/tsuru0805/monologue-stream/blob/74ecec69fb8cf29e87162d1a95d2e568306b3a86/tests/test_monologue_filter.py#L43-L70)，[passthrough 测试](https://github.com/tsuru0805/monologue-stream/blob/74ecec69fb8cf29e87162d1a95d2e568306b3a86/tests/test_monologue_filter.py#L72-L105)，[边界测试](https://github.com/tsuru0805/monologue-stream/blob/74ecec69fb8cf29e87162d1a95d2e568306b3a86/tests/test_monologue_filter.py#L108-L175)，[逐调用直播测试](https://github.com/tsuru0805/monologue-stream/blob/74ecec69fb8cf29e87162d1a95d2e568306b3a86/tests/test_monologue_filter.py#L177-L203)）。

## 本次验证记录

- 通过 Git remote symbolic ref 与 GitHub repository API 交叉确认观察时默认分支为 `main`，两者均指向完整 SHA `74ecec69fb8cf29e87162d1a95d2e568306b3a86`；提交页为固定审计入口（[commit](https://github.com/tsuru0805/monologue-stream/commit/74ecec69fb8cf29e87162d1a95d2e568306b3a86)）。
- 静态阅读了该 commit 的 README（中/英）、`monologue_filter.py`、两份示例、`pyproject.toml`、LICENSE 和完整测试文件（[固定 tree](https://github.com/tsuru0805/monologue-stream/tree/74ecec69fb8cf29e87162d1a95d2e568306b3a86)）。
- 当前研究环境没有 `python`、`python3` 或 `py` launcher，因此没有声称本地运行测试通过；本文关于测试的陈述来自固定测试源码的静态核对，而不是执行结果（[上游运行命令与覆盖说明](https://github.com/tsuru0805/monologue-stream/blob/74ecec69fb8cf29e87162d1a95d2e568306b3a86/README.en.md#L177-L183)）。
- 未读取或输出任何 `.env`、API key 或其他密钥；未调用示例中的供应商 API。

## DengTa 当前实现诊断

以下本地诊断锁定到实施前的 DengTa 后端 commit [`889ec943cbe46e6a3dc502b29e461e580627e827`](https://github.com/buyaocaowo555-collab/dengta-home-backend/commit/889ec943cbe46e6a3dc502b29e461e580627e827) 和前端 commit [`8f74bee9071b005e3834d2d46fa17f9e26e4e9b2`](https://github.com/buyaocaowo555-collab/dengta-home-frontend/commit/8f74bee9071b005e3834d2d46fa17f9e26e4e9b2)。后端另有一处与本功能无关、实施前已经存在的用户工作树改动 `test/companion-creative.test.js`；研究与实现均未触碰或暂存它。

### 为什么会先显示“暂时没有”，再变成“回复同步中”

这是一个可由源码完整解释的 UI 竞态，不是模型先回答“没有”后又反悔：

1. 点击“听听她此刻的心声”时，组件先同步打开弹窗，再调用异步回调；但 `innerMonologuePending` 尚未置为 `true`，因此弹窗首次渲染落到最后一个空态分支，显示“这一次暂时没有收到可显示的心声”（[点击顺序](https://github.com/buyaocaowo555-collab/dengta-home-frontend/blob/8f74bee9071b005e3834d2d46fa17f9e26e4e9b2/src/ChatMessageExtras.jsx#L208-L212)，[弹窗分支](https://github.com/buyaocaowo555-collab/dengta-home-frontend/blob/8f74bee9071b005e3834d2d46fa17f9e26e4e9b2/src/ChatMessageExtras.jsx#L316-L333)）。
2. 异步回调先动态加载恢复模块，再尝试把 `local-assistant-*` 临时消息按正文和时间匹配到服务端 UUID；只有恢复成功后才设置 `innerMonologuePending=true`（[请求流程](https://github.com/buyaocaowo555-collab/dengta-home-frontend/blob/8f74bee9071b005e3834d2d46fa17f9e26e4e9b2/src/App.jsx#L2958-L2994)，[恢复算法](https://github.com/buyaocaowo555-collab/dengta-home-frontend/blob/8f74bee9071b005e3834d2d46fa17f9e26e4e9b2/src/inner-monologue-sync.js#L23-L69)）。
3. 若三次短窗口历史读取仍找不到匹配消息，恢复模块返回固定错误“回复同步中，请稍后再试”，回调再把这条错误写进 UI，于是用户看见空态被错误态替换（[重试与终值](https://github.com/buyaocaowo555-collab/dengta-home-frontend/blob/8f74bee9071b005e3834d2d46fa17f9e26e4e9b2/src/inner-monologue-sync.js#L71-L106)，[错误落 UI](https://github.com/buyaocaowo555-collab/dengta-home-frontend/blob/8f74bee9071b005e3834d2d46fa17f9e26e4e9b2/src/App.jsx#L2964-L2978)）。

即使只把 pending 提前，也只能修掉第一帧错文案，不能满足“回复生成时就同步生成并发送心声”。根因是现有心声属于**点击后第二次生成**：前端另发 `POST /companion/inner-monologue`，超时上限五分钟；后端读取已经保存的 assistant 回复，再用最近对话和记忆发起另一轮 `generateReply`。生成结果不写入消息表，只返回 JSON（[前端第二请求](https://github.com/buyaocaowo555-collab/dengta-home-frontend/blob/8f74bee9071b005e3834d2d46fa17f9e26e4e9b2/src/App.jsx#L2996-L3036)，[后端路由](https://github.com/buyaocaowo555-collab/dengta-home-backend/blob/889ec943cbe46e6a3dc502b29e461e580627e827/server.js#L3870-L3894)，[第二次模型生成](https://github.com/buyaocaowo555-collab/dengta-home-backend/blob/889ec943cbe46e6a3dc502b29e461e580627e827/services/visible-inner-monologue.js#L87-L162)）。

### 现有存储和同步边界

- 心声只保存在浏览器 `localStorage`，按账户 scope 和 assistant message ID 建索引，最多 120 条、每条最多 12,000 字符；服务端不保存，因此换设备、清站点数据或消息 ID 未同步时都可能不可见（[本地存储实现](https://github.com/buyaocaowo555-collab/dengta-home-frontend/blob/8f74bee9071b005e3834d2d46fa17f9e26e4e9b2/src/inner-monologue.js#L1-L85)）。
- 后端 capabilities 也明确宣告 `visible_inner_monologue_on_demand: true` 和 `visible_inner_monologue_storage: "device_only"`，同时关闭公开 reasoning summary stream（[能力声明](https://github.com/buyaocaowo555-collab/dengta-home-backend/blob/889ec943cbe46e6a3dc502b29e461e580627e827/server.js#L3023-L3031)）。
- 当前 `/chat/stream` 已是正确的主通道 seam：后端以 SSE 发 `status/meta/text/reasoning/done/error`，并在最终 `done` 中给出已保存的真实 assistant message ID（[后端 SSE](https://github.com/buyaocaowo555-collab/dengta-home-backend/blob/889ec943cbe46e6a3dc502b29e461e580627e827/server.js#L4213-L4259)）；前端的 POST-stream 解析器会把未知的非错误事件继续交给 `onEvent`，所以增加独立 `monologue` 事件不需要更换传输方式（[前端 SSE 解析](https://github.com/buyaocaowo555-collab/dengta-home-frontend/blob/8f74bee9071b005e3834d2d46fa17f9e26e4e9b2/src/api.js#L322-L359)）。
- 目前前端明确不渲染 `reasoning`/`provider_summary`，测试也要求心声走另一个按需流程（[现有回归约束](https://github.com/buyaocaowo555-collab/dengta-home-frontend/blob/8f74bee9071b005e3834d2d46fa17f9e26e4e9b2/test/mobile-layout.test.js#L856-L869)）。新设计应新增语义清晰的 `monologue` 通道，而不是重新把供应商摘要接回 UI。

### 现有模型流 seam

DengTa 已经把 OpenAI Responses、OpenAI-compatible、Anthropic 和 Gemini 汇聚到 `generateReplyStream`；供应商 adapter 向上只发普通 `text` 和经过严格筛选的 provider summary 事件（[汇聚入口](https://github.com/buyaocaowo555-collab/dengta-home-backend/blob/889ec943cbe46e6a3dc502b29e461e580627e827/services/ai-service.js#L3501-L3648)）。OpenAI Responses 和 compatible adapter 都在普通正文 delta 到达时发 `{type:"text"}`（[Responses 文本 delta](https://github.com/buyaocaowo555-collab/dengta-home-backend/blob/889ec943cbe46e6a3dc502b29e461e580627e827/services/ai-service.js#L1604-L1697)，[compatible 文本 delta](https://github.com/buyaocaowo555-collab/dengta-home-backend/blob/889ec943cbe46e6a3dc502b29e461e580627e827/services/ai-service.js#L2614-L2692)）。这正好允许在**普通正文 delta 汇聚后、写 SSE 与累积最终正文前**挂一个 Node 原生 splitter。

现有 `reasoning-stream.js` 只允许 `provider_summary` 作为公开 reasoning source，并做 `<think>` 清理、凭证模式脱敏、敏感上下文逐行回显拦截和 6,000 字符总上限（[现有安全 emitter](https://github.com/buyaocaowo555-collab/dengta-home-backend/blob/889ec943cbe46e6a3dc502b29e461e580627e827/services/reasoning-stream.js#L1-L83)，[事件输出](https://github.com/buyaocaowo555-collab/dengta-home-backend/blob/889ec943cbe46e6a3dc502b29e461e580627e827/services/reasoning-stream.js#L85-L203)）。它的安全原语值得复用，但 source 语义不应复用：`provider_summary` 与“同一个模型在普通正文中显式写出的公开心声”不是同一对象。

## 建议目标：同一主回复生成流程、同一条 chat SSE、同一条消息快照

### 产品和隐私定义

对用户可采用 DeepSeek 类似的展开/折叠直播体验，但产品定义应固定为：

> **“心声”是 AI 为本次回复同步生成、可供你阅读的第一人称独白；它不是模型隐藏的原始思考链，也不保证逐字还原答案形成的真实因果过程。**

UI 可显示“心声 · AI 生成”或首次使用说明，避免“真实脑海原文”“完整思考链”等承诺。不要把供应商 `reasoning_content`、`thinking_delta`、工具参数、系统提示词或 provider summary 混入该字段。上游同样明确把 visible monologue 与 raw CoT 分开（[上游边界](https://github.com/tsuru0805/monologue-stream/blob/74ecec69fb8cf29e87162d1a95d2e568306b3a86/README.en.md#L35-L50)）。

### 一轮数据流

```text
现有 main-chat prompt
  + 应用级“公开心声输出契约”（仅主聊天）
                         |
                         v
同一次 provider 请求的普通 text delta
                         |
                         v
Node VisibleMonologueSplitter（每条 provider assistant response 一个实例）
        /                                         \
monologue delta                              clean reply delta
        |                                         |
同一 POST /chat/stream SSE: monologue         同一 SSE: text
        \                                         /
         \---- 最终 assistant message 一次提交 ----/
             content = 干净正文（无标记）
             metadata = 有界、脱敏的公开心声快照和明确终态
                         |
                         v
历史读取/换设备/幂等重放直接返回同一快照；点击只展开，不再调用模型
```

这条路径**不增加心声专用的供应商请求**：沿用主回复原本的调用次数。无工具的普通回复通常仍是一请求；工具回合原本就可能经历多轮 provider response 及既有 fallback，不能把它误写成“每个 chat turn 必定只有一次”。额外成本来自主回复同一输出中的公开心声 token，而不是点击后第二次补算；因此应给篇幅硬上限并在 prompt receipt 中记录是否启用。供应商的真实 reasoning effort 仍由现有 `reasoning_effort` 独立控制，不能用心声长度冒充推理深度。

### Prompt seam

在 `buildMainChatPromptPlan` 中加入一个由应用维护、版本化的“公开心声输出契约”，仅对 `MAIN_CHAT_PROMPT_ARCHITECTURE` 生效；不要污染日记、动态、后台任务或当前 legacy on-demand architecture。当前主聊天 prompt 已有明确的持久个性化、稳定记忆和动态上下文分层，可在这里记录新 contract 版本与投递回执（[主聊天 prompt 计划](https://github.com/buyaocaowo555-collab/dengta-home-backend/blob/889ec943cbe46e6a3dc502b29e461e580627e827/services/ai-service.js#L467-L590)，[architecture 路由](https://github.com/buyaocaowo555-collab/dengta-home-backend/blob/889ec943cbe46e6a3dc502b29e461e580627e827/services/ai-service.js#L3076-L3183)）。

契约应表达以下行为，而不是索取“隐藏推理步骤”：

- 回复最前面输出一段有界的第一人称公开独白，随后闭合标记并写正式回复；篇幅、语气和细节服从用户个性化指令、用户详情与本轮请求，服务端只设置防滥用字符硬上限；
- 独白写“此刻注意到什么、情绪上被碰到哪里、为什么选择这种回应方向”，不写逐步求解过程；
- 不复述 system/developer/custom instructions，不提提示词、策略、工具参数、内部标识、密钥或第三方隐私；
- 不把独白当免责区，不在里面输出与正文安全标准不同的内容；
- 正文不得复述独白，且无论是否成功写出独白，都必须给出可独立成立的正式回复。

应提升 `MAIN_CHAT_PROMPT_CONTRACT_VERSION`，并在安全 prompt receipt 中记录 `visible_monologue_contract_version`、启用状态与字符预算，但不得把实际独白或提示词全文写进日志/回执。旧历史不应通过把 raw marker 塞回 `messages.content` 来强化格式；DengTa 可以每轮稳定投递版本化契约，避免上游所述“所有人类读口都要剥标记”的扩散风险。这个安全取舍会牺牲上游所说的“旧带 marker 历史压过新 prompt”的格式强化，因此刚上线和长旧会话的 `missing` 率可能更高；若实测需要提升遵循率，应在应用维护的 system 契约里加入不含真实历史/秘密的安全 few-shot 格式样例，而不是把 raw 心声重新混入历史正文（[上游历史格式经验](https://github.com/tsuru0805/monologue-stream/blob/74ecec69fb8cf29e87162d1a95d2e568306b3a86/README.en.md#L105-L116)）。

### Node splitter seam

不要引入 Python sidecar。以固定上游测试为行为规格，在 Node 中建立纯模块，例如概念接口：

```js
createVisibleMonologueSplitter({ openMarker, closeMarker, maxChars })
  -> {
       push(delta) -> { textDelta, monologueDelta, justClosed },
       finish() -> { textDelta, monologueDelta, state },
       snapshot() -> { text, state, truncated }
     }
```

接口名只是设计建议。行为保持上游的 `SEEK / IN / PASS`、标记撕裂安全、无标记逐字符等价 passthrough 和 EOF 清算（[上游状态机](https://github.com/tsuru0805/monologue-stream/blob/74ecec69fb8cf29e87162d1a95d2e568306b3a86/monologue_filter.py#L94-L177)）。与上游不同，DengTa 需要额外输出明确状态并执行长度/敏感信息限制。终态不能由三态枚举直接推导：`PASS` 既可能来自“开头没有 marker”，也可能来自“已经识别闭 marker”；空块闭合后同样进入 `PASS`。实现必须另记 `sawOpen/sawClose/hasSafeMonologue`（或等价事实），再判 `missing/complete/truncated`。

长度限制必须保留两个正交事实：纯 splitter 的结构状态在正常闭合时仍是 `complete`，另置 `display_truncated=true`；面向客户端的 aggregate 快照则将这个组合投影为 `state=truncated`，确保 UI 显示截断提示。即使展示预算已耗尽，splitter 仍要继续扫描到闭 marker，才能恢复并发布后续净正文；若安全策略决定整段丢弃，则应记录独立 `redacted`/reason 字段，不要借用结构截断原因。

接线位置应在 provider-specific envelope/`<think>` 清理已经完成之后，但在普通正文 `text` 事件写给客户端和最终 `generated.text` 保存之前。最终 `generated.text` 必须来自 splitter 的净正文累计值，不能继续采用包含 marker 的 adapter 内部 raw text。非流式 `/chat` 也应把完整返回文本当作一个 chunk 走同一个模块，保证两个端点保存一致。

工具调用需要单独处理：当前 OpenAI-compatible 工具路径最多循环三轮，并在每轮 SSE 后才拥有完整工具参数；每个 provider assistant response/工具轮要新建 splitter，避免第一个闭合后的 `PASS` 状态把下一轮 marker 泄漏进正文（[当前工具轮循环](https://github.com/buyaocaowo555-collab/dengta-home-backend/blob/889ec943cbe46e6a3dc502b29e461e580627e827/services/ai-service.js#L2726-L2879)，[上游单回复单实例要求](https://github.com/tsuru0805/monologue-stream/blob/74ecec69fb8cf29e87162d1a95d2e568306b3a86/README.en.md#L89-L92)）。产品上可把同一用户回合的多个公开独白 segment 有序拼接为一个心声快照，但工具名、参数和结果必须先加入敏感集合再发布任何 segment；更保守的首版可只允许最终无工具调用的 assistant response 产生公开心声。

终态作用域是**整个用户回合的 aggregate**，不是单个 provider segment：中间纯工具调用 response 即使没有 marker，也不能先发整轮 `missing`；它只清算并切换 splitter。最终无工具 response 结束或整轮失败时，外层才发送唯一一次 `monologue phase=end`。这样 `missing/complete/truncated/failed` 不会在同一回合倒退回 `streaming`。此外，工具路径判断是否需要既有 completion fallback 时必须看“是否已有净正文”，不能看 raw `fullText`；否则一个仅含 `[monologue]` 的工具轮会错误地阻止 fallback。

### SSE 契约

不要复用 `reasoning` 事件。建议在现有 `data: JSON` 传输内增加一个可版本化事件：

```json
{
  "type": "monologue",
  "phase": "delta",
  "content": "我有一点担心她是在勉强自己……",
  "segment": 0,
  "offset": 0,
  "public": true,
  "source": "model_authored_visible_monologue",
  "schema_version": 1
}
```

闭合、缺失或中断时发送无正文的终态事件：

```json
{
  "type": "monologue",
  "phase": "end",
  "state": "complete",
  "segment": 0,
  "chars": 126,
  "schema_version": 1
}
```

`offset` 明确定义为该 segment 已发布的 **Unicode code point 数**，不是 UTF-8 byte、JavaScript UTF-16 code unit 或 grapheme cluster；客户端只在偏移连续时追加，可避免同一连接内重复 delta。实现和测试都应使用同一 code-point 计数，并覆盖 emoji、组合字符与跨 chunk surrogate pair。最终 `done.assistant_message` 中的快照是权威值，直播 delta 只是低延迟视图。建议事件顺序：`status/meta -> monologue delta* -> text* -> monologue end -> status saving/completed -> done`；无 marker 时正文正常 passthrough，在整个回合清算时发送一次 `state=missing`。

终态必须单向：

| state | 含义 | UI 行为 |
|---|---|---|
| `streaming` | 已确认进入公开心声块，仍在接收 | 展示实时文字和活动指示，不显示“没有” |
| `complete` | 已识别闭标记且有非空、安全心声 | 可折叠/展开；最终以消息快照校准 |
| `missing` | 本 response 没有合法卷首块或块为空 | 显示“这次没有生成可显示的心声”或隐藏入口；不得再变回同步中 |
| `truncated` | 流结束前块未闭合，但有可显示片段 | 可显示片段并标注“心声未完整生成”；若正式正文为空，本轮整体仍应失败 |
| `failed` | 供应商/安全筛选/服务端失败 | 结束活动态；与 chat `error` 一起提供正常重试，不保留“同步中” |

不要把 `phase=end` 当作整轮 `done`；正式正文和 assistant message 仍必须成功保存后，才能发聊天成功终态。当前 `/chat/stream` 已保证 catch 后发 `type=error` 而不再发成功 done，应继续保持该约束（[当前成功/失败终态](https://github.com/buyaocaowo555-collab/dengta-home-backend/blob/889ec943cbe46e6a3dc502b29e461e580627e827/server.js#L4236-L4259)）。

### 持久化与幂等 seam

首版建议把有界快照存入现有 assistant message 的 `tool_calls` JSON metadata，与正文在同一次 `saveMessage` 或 `commit_chat_generation_reply` 中原子提交：

```json
{
  "visible_monologue": {
    "schema_version": 1,
    "text": "……",
    "state": "complete",
    "source": "model_authored_visible_monologue",
    "generated_with_reply": true,
    "segment_count": 1
  }
}
```

这是 DengTa 的 MVP 适配建议，不是上游 schema。它有三个直接优点：

1. 当前 assistant commit 已把 `content` 与 `toolCalls` 交给同一个租约 RPC，天然避免“正文已保存但心声还在另一张表同步”的新竞态（[租约 commit 接口](https://github.com/buyaocaowo555-collab/dengta-home-backend/blob/889ec943cbe46e6a3dc502b29e461e580627e827/services/chat-idempotency.js#L119-L185)，[主聊天提交](https://github.com/buyaocaowo555-collab/dengta-home-backend/blob/889ec943cbe46e6a3dc502b29e461e580627e827/server.js#L2804-L2845)）。
2. `client_message_id` 幂等重放查回原 assistant message 时可以返回完全相同的心声快照，不会重新调用模型或出现新版本（[已提交回放](https://github.com/buyaocaowo555-collab/dengta-home-backend/blob/889ec943cbe46e6a3dc502b29e461e580627e827/server.js#L1299-L1342)）。
3. 上下文加载虽然读取 `tool_calls`，但四类 provider payload builder 都只从允许的对话结构组装模型输入：OpenAI Chat 仅在 assistant metadata 是数组 `tool_calls` 时透传工具调用（[OpenAI Chat builder](https://github.com/buyaocaowo555-collab/dengta-home-backend/blob/889ec943cbe46e6a3dc502b29e461e580627e827/services/ai-service.js#L1121-L1177)），Gemini 只映射 role/content（[Gemini builder](https://github.com/buyaocaowo555-collab/dengta-home-backend/blob/889ec943cbe46e6a3dc502b29e461e580627e827/services/ai-service.js#L1270-L1286)），Responses 跳过 tool role 并只映射 role/content（[Responses builder](https://github.com/buyaocaowo555-collab/dengta-home-backend/blob/889ec943cbe46e6a3dc502b29e461e580627e827/services/ai-service.js#L1289-L1315)），Anthropic 同样只映射 role/content/当前图片（[Anthropic builder](https://github.com/buyaocaowo555-collab/dengta-home-backend/blob/889ec943cbe46e6a3dc502b29e461e580627e827/services/ai-service.js#L1328-L1347)）。因此对象形态的 `visible_monologue` 不会自动成为下一轮模型指令；同时仍需保留主聊天上下文读取的 tenant 边界（[主聊天上下文读取](https://github.com/buyaocaowo555-collab/dengta-home-backend/blob/889ec943cbe46e6a3dc502b29e461e580627e827/services/context-reset.js#L53-L108)）。

`publicMessage` 当前采用 allowlist，只暴露有限 metadata。实现时应严格校验 `visible_monologue` 的 schema/state/source/字符数并投影为公开字段，不能泛化为“把整个 tool_calls 返回前端”（[当前公开投影](https://github.com/buyaocaowo555-collab/dengta-home-backend/blob/889ec943cbe46e6a3dc502b29e461e580627e827/services/chat-attachments.js#L682-L775)）。若后续需要单独查询、保留策略、审计或大规模分析，再迁移到 tenant-owned 专表；不应为了首版额外引入第二次异步写入。

正文 `messages.content` 应只保存已剥离 marker 的正式回复。这样推送、语音、日记、记忆压缩、动态与历史列表默认都不会意外拿到心声，也不需要在每个读口重复剥标记。心声只通过显式允许的消息详情/聊天 UI 投影展示；锁屏推送默认不得包含它。

### 前端 seam 与旧数据迁移

前端发送时已经建立一个本地 assistant draft，并在同一 stream callback 处理 `status/text/error/done`（[当前流式 UI](https://github.com/buyaocaowo555-collab/dengta-home-frontend/blob/8f74bee9071b005e3834d2d46fa17f9e26e4e9b2/src/App.jsx#L3560-L3759)）。新增 `monologue` handler 应把 delta 直接累积到这条 draft 的公开心声字段；`done` 时用 `assistant_message.visible_monologue` 覆盖/校准草稿。点击心声区域只切换折叠或弹窗，不再触发网络请求，所以临时 message ID 不参与“心声是否存在”的判定。

兼容迁移建议：

- 新消息以服务端快照为权威，不再写 `dengta_visible_inner_monologues_v1`；
- 旧设备缓存仍可只读显示在旧消息上，并标为“仅此设备的旧版心声”；不得自动上传，因为旧缓存最初的隐私承诺是 device-only；
- `/companion/inner-monologue` 暂时仅作为旧消息的显式 legacy fallback，能力声明改为 legacy/deprecated；新消息只要拥有 `visible_monologue.state`，无论 `complete` 或 `missing` 都绝不调用它；
- 一个发布周期后根据兼容需要移除按需按钮、同步恢复模块和五分钟第二请求；移除前要保留旧客户端不会崩溃的 capability 协商。

建议 capabilities 增加 `visible_monologue_stream: true`、`visible_monologue_schema_version: 1`、`visible_monologue_storage: "message_metadata"`；不要把它命名为 `raw_cot` 或 `reasoning_content`。

## 安全、隐私和内容边界

1. **供应商隐藏推理永不进入。** 保留现有对 `reasoning_content`、raw thinking 和 `<think>` 的隔离；`public_reasoning_summary_stream` 可继续关闭。新 splitter 只接收经 provider adapter 认定的普通 assistant text delta。
2. **发布前脱敏。** 在每个 `monologueDelta` 发 SSE 前做控制字符清理、凭证模式替换、system/custom instructions、动态上下文、历史消息和工具参数的直接回显拦截；总长度和单 chunk 都要硬限制。脱敏必须跨 provider delta 保留尾缀或句界缓冲：逐 delta 正则会漏掉被切成 `Bear`+`er ...`、`sk-...`、私钥头尾或敏感 prompt 行的内容。可抽取现有 reasoning sanitizer 的通用原语，但新模块要使用 `source=model_authored_visible_monologue`，不能伪装成 provider summary；隐私测试应枚举这些哨兵的所有二分切点。
3. **正文和心声同一安全标准。** 公开心声不是绕开应用内容规则的隐藏区域；provider error document guard、边界残留检查和任何适用输出安全筛选都必须覆盖两个公开通道。
4. **最小公开投影。** API 只返回 `text/state/source/schema_version` 等允许字段，不返回 raw provider event、marker、prompt receipt 内容、工具调用参数或内部错误。
5. **租户边界不变。** 心声跟随已认证的 assistant message，在现有 `user_id + companion_id` request scope 内读写；请求体不得自行指定 ownership。换设备能同步是因为它属于同一租户消息，不是因为建立公共缓存。
6. **下游默认拒绝。** TTS、推送预览、记忆、日记、动态、画像和搜索默认只消费干净正文；要使用心声必须由各功能显式 opt-in 并重新评估隐私。首版建议全部不 opt-in。
7. **日志不可记录正文。** 监控只记录字符数、状态、segment 数、是否被截断/脱敏、首个 monologue delta 延迟和首个正文 delta 延迟，不记录心声文本。

## 建议先写的红测试

下面是研究阶段形成的验收清单。随后实施已按 TDD 覆盖核心 splitter、流/非流主路径、工具多轮、隐私二分切点、失败终态、公开投影和持久化接线；较大的 durable reconnect 与真实部署联调仍按本文边界保留为后续验证。

### A. 纯 splitter

- 把上游 25 个测试方法的行为迁成 Node 测试：整块、逐字符、所有二分切点、无标记完全 passthrough、近似前缀、正文中途 marker、前导空白、未闭合、伪闭标记、只认第一对、自定义 marker、空块和即时 emission（[固定上游测试](https://github.com/tsuru0805/monologue-stream/blob/74ecec69fb8cf29e87162d1a95d2e568306b3a86/tests/test_monologue_filter.py#L19-L203)）。
- 新增 Unicode 字符 offset、长度硬截断、控制字符、凭证、完整 system/user/tool 参数回显拦截；验证 marker 和被扣留尾缀永不出现在任一公开通道。
- `finish()` 根据 `sawOpen/sawClose/hasSafeMonologue` 判终态，而不是把 SEEK/IN/PASS 机械映射成 missing/truncated/complete；重复 `finish()` 与 close 后继续 `push()` 不得重复发布。

### B. 后端 chat contract

- 单次 `/chat/stream` 的一个模拟 provider 流 `[mono` + `logue]心声[/mono` + `logue]正文`，必须按序发 `monologue delta/end` 后发净 `text`；整个回合只调用 provider 一次。
- `done.assistant_message.content` 只含正文，公开心声快照完整且不含 marker；数据库 assistant row 在同一次 commit 中同时拥有正文与快照。
- 无 marker 轮正常返回正文并以 `missing` 终结，不能在完成后出现 `streaming`；空块同样是明确终态。
- provider 在公开心声中途失败时只发 chat error，不发成功 done；UI 所需终态为 failed，不无限 pending。
- idempotent retry 用同一个 `client_message_id` 时不再次生成，回放的正文和心声快照逐字相同。
- SSE 客户端断开后服务器仍能完成最终 commit；重新读取会话历史能拿到同一快照。服务器进程中断的恢复能力另列为后续 durable streaming，不应在首版测试中虚假承诺。
- OpenAI-compatible 工具两轮分别撕裂 marker 时不泄漏 marker、工具名、参数或第二段到正文；每个 provider assistant response 拥有独立 splitter 生命周期。
- 非流式 `/chat` 与 `/chat/stream` 对同一固定 provider 输出得到相同净正文/心声快照。
- capability 和 chat-contract 测试明确断言 `public_reasoning_summary_stream=false`、新 `visible_monologue_stream=true`，并禁止 raw `reasoning_content/thinking_delta` 映射为 monologue。

### C. 前端竞态与体验

- 点击已完成但仍是本地临时 ID 的新式消息，只展开已有/正在流式的心声，不发 `/companion/inner-monologue`，也不运行 UUID 文本/时间恢复。
- 第一条 `monologue delta` 到达就展示实际文字或 pending；从任何渲染帧都不得先出现“暂时没有”再变“同步中”。
- `missing/complete/truncated/failed` 都是终态；完成后旧 delta 或 React 重渲染不能让状态倒退到 streaming。
- `done` 快照与本地 delta 不一致时，以服务端快照替换，不能重复拼接；用 `segment+offset` 检测重复/缺口。
- 刷新、换设备和历史 hydration 后仍可打开服务端心声；清空 `localStorage` 不影响新消息。
- 旧版 device-only 缓存仍能只读显示且不会未经同意上传；新消息不再写该 key。
- chat error、取消、换会话和并发发送不会把 A 会话心声拼到 B 会话或下一条 assistant draft。

### D. 隐私回归

- system prompt、自定义指令、用户详情、稳定记忆、动态上下文、完整用户消息、API key、Bearer token、私钥、工具名与参数的测试哨兵都不得出现在 SSE、数据库公开快照、history API、推送或 TTS。
- `messages.content`、语音文本、推送正文、日记和记忆输入均只收到净正文；只有 chat message detail/UI 能看到允许的心声字段。
- `publicMessage` 对伪造的超长、未知 state/source、嵌套 object 或 raw reasoning 字段采取拒绝/丢弃，而不是透传。

## 分阶段建议与明确非目标

### Phase 1：同轮生成和最终持久化

- Node 原生 splitter + 主聊天输出契约；
- 同一 `/chat/stream` 中直播 `monologue`；
- 最终快照随 assistant message 原子提交、历史可恢复；
- 前端点击只展开，新消息不再发第二模型请求；
- 无 marker、失败和截断拥有明确终态；
- provider raw reasoning 保持隔离。

这已经直接解决用户报告的两个问题：不会点击后才开始计算，也不会经历“暂时没有 -> 回复同步中”的状态倒退。

### Phase 2：真正可续传的 durable stream（可选）

上游建议生成服务端独立运行、逐段持久化并支持 cursor 重放。DengTa 当前是在生成完成后一次提交 assistant message；它的 client-message 租约可防重复生成和做最终回放，但尚没有逐 delta 持久化/stream cursor。若产品要求锁屏、进程重启或长时断网后继续看到**同一回合的中途文字**，需要单独设计 tenant-owned turn-event/draft 存储、序号、保留策略与清理 worker。这不应与 Phase 1 混成一个未经验证的承诺。

### 非目标

- 不恢复、推断或展示供应商隐藏 raw CoT；
- 不把 provider summary 改名为“心声”；
- 不增加第二次心声模型调用；
- 不把心声写入长期记忆、system prompt、TTS、推送或公开日志；
- 不引入 Python runtime/sidecar；
- 不在本阶段修改数据库 schema 或部署，也不把中途 delta 冒充 durable event store。

## 实施决策摘要

| 决策 | 建议 |
|---|---|
| 用户体验 | DeepSeek 类折叠直播，但标明“心声 · AI 生成” |
| 内容本质 | 同一模型在普通正文通道显式生成的公开独白，不是隐藏 CoT |
| 模型调用 | 不增加心声专用调用；沿用主回复既有调用次数，不再点击后补算 |
| 分流位置 | provider 普通 text delta 汇聚后、SSE/最终正文保存前 |
| 网络协议 | 现有 `/chat/stream` 增加独立、版本化 `monologue` 事件 |
| 最终真相 | `done.assistant_message` 与 tenant-scoped 历史中的持久快照 |
| 首版存储 | assistant `tool_calls.visible_monologue` 有界对象，与正文原子 commit |
| 正文存储 | 只存净正文，不存 marker/raw 混合文本 |
| 隐私 | 新通道发布前脱敏；下游默认只消费净正文 |
| 旧功能 | 新消息停用按需请求；旧 device-only 缓存只读兼容，legacy route 逐步退役 |
| 许可 | 实质移植状态机/测试时，在源码头与 `THIRD_PARTY_NOTICES.md` 保留 `Copyright (c) 2026 tsuru0805`、MIT 许可全文和固定提交链接 |

结论：`monologue-stream` 的思路与 DengTa 当前架构高度匹配，但应复用的是**卷首公开独白 + 撕裂安全状态机 + 同回合双通道**，不是其 Python 文件、供应商 thinking 通道或“真实思考链”叙事。DengTa 已有统一模型流、SSE、assistant 原子提交、幂等租约和消息历史；沿这些 seam 做 Phase 1，可以在不增加心声专用模型调用的前提下同步发送心声和正式回复，并从结构上消除当前点击补算与消息 ID 恢复竞态。
