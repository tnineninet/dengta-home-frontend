import { THEME_PRESETS } from "./dengta-theme.js";
import { useGlassScrubber } from "./use-glass-scrubber";
import "./theme-background-switcher.css";

const APPEARANCE_OPTIONS = [
  { id: "auto", label: "Auto" },
  { id: "day", label: "Day" },
  { id: "night", label: "Night" },
];

const BACKGROUND_OPTIONS = [
  {
    id: "auto",
    label: "日出日落",
    hint: "晨光、晚霞与星夜，随时钟渐变",
    preview: "linear-gradient(155deg, #407aa7, #d6c6bf 52%, #ffa432)",
  },
  {
    id: "coast",
    label: "实时海岸",
    hint: "新版天气、云层与光线实时变化",
    preview: "linear-gradient(155deg, #8ec8e2 0%, #b7dde1 42%, #f8d99c 100%)",
  },
  {
    id: "legacy",
    label: "旧版动态天空",
    hint: "太阳月亮高度、日出日落五段色彩随时变化",
    image: "/assets/coast-video/coast-day.webp",
  },
];

export default function ThemeStudio({
  preferences,
  minute,
  previewing,
  onPreview,
  updateTheme,
  chatSkinPreferences,
  updateChatSkin,
}) {
  const glassScrubber = useGlassScrubber(
    preferences.cardOpacity * 100,
    (value) => updateTheme({ cardOpacity: value / 100 }),
  );

  return (
    <section className="theme-studio" aria-labelledby="theme-studio-title">
      <div className="settings-card-heading">
        <div>
          <span className="settings-kicker">APPEARANCE</span>
          <h3 id="theme-studio-title">Theme studio</h3>
        </div>
        <span className="theme-live-dot">Live</span>
      </div>

      <div className="theme-preset-grid" aria-label="皮肤预设">
        {THEME_PRESETS.map((preset) => (
          <button
            type="button"
            className={preferences.preset === preset.id ? "active" : ""}
            key={preset.id}
            aria-pressed={preferences.preset === preset.id}
            onClick={() =>
              updateTheme({
                preset: preset.id,
                accent: preset.accent,
                card: preset.card,
              })
            }
          >
            <span
              className="theme-preset-swatch"
              style={{
                "--preset-background": preset.background,
                "--preset-card": preset.card,
                "--preset-accent": preset.accent,
              }}
            >
              {preferences.preset === preset.id && <em>✓</em>}
            </span>
            <small>{preset.label}</small>
          </button>
        ))}
      </div>

      <div className="theme-background-control">
        <span>
          <strong>背景</strong>
          <small>自选聊天壁纸优先显示；恢复默认后跟随这里的选择。</small>
        </span>
        <div className="theme-background-grid" role="group" aria-label="背景模式">
          {BACKGROUND_OPTIONS.map((option) => (
            <button
              type="button"
              className={preferences.background === option.id ? "active" : ""}
              aria-pressed={preferences.background === option.id}
              key={option.id}
              onClick={() => updateTheme({ background: option.id })}
            >
              <span
                className="theme-background-swatch"
                style={
                  option.image
                    ? { backgroundImage: `url(${option.image})` }
                    : { background: option.preview }
                }
                aria-hidden="true"
              />
              <span className="theme-background-copy">
                <strong>{option.label}</strong>
                <small>{option.hint}</small>
              </span>
              {preferences.background === option.id ? <em aria-hidden="true">✓</em> : null}
            </button>
          ))}
        </div>
        {onPreview && <div className="daylight-clock-control">
          <label htmlFor="theme-daylight-clock">预览天空
            <output htmlFor="theme-daylight-clock">{String(Math.floor(minute / 60)).padStart(2, "0")}:{String(minute % 60).padStart(2, "0")}</output>
          </label>
          <input id="theme-daylight-clock" type="range" min="0" max="1439" value={minute}
            onChange={event => onPreview(Number(event.target.value))} />
          <button type="button" disabled={!previewing} onClick={() => onPreview(null)}>{previewing ? "回到现在" : "跟随现在"}</button>
        </div>}
      </div>

      <div className="theme-control-list">
        <label className="theme-color-control">
          <span>
            <strong>Accent</strong>
            <small>按钮、状态和互动高光</small>
          </span>
          <input
            type="color"
            value={preferences.accent}
            onChange={(event) => updateTheme({ accent: event.target.value })}
          />
        </label>
        <label className="theme-color-control">
          <span>
            <strong>Card colour</strong>
            <small>玻璃卡片的底色</small>
          </span>
          <input
            type="color"
            value={preferences.card}
            onChange={(event) => updateTheme({ card: event.target.value })}
          />
        </label>
        <label className="theme-opacity-control">
          <span>
            <strong>Global glass</strong>
            <output>{Math.round(glassScrubber.value)}%</output>
          </span>
          <input
            type="range"
            min="0"
            max="100"
            value={Math.round(glassScrubber.value)}
            {...glassScrubber.inputProps}
          />
        </label>
      </div>

      <div className="theme-appearance-control">
        <span>
          <strong>Light cycle</strong>
          <small>定位开启后按当地日出日落 · 否则使用上海时刻</small>
        </span>
        <div>
          {APPEARANCE_OPTIONS.map((option) => (
            <button
              type="button"
              className={
                preferences.appearance === option.id ? "active" : ""
              }
              aria-pressed={preferences.appearance === option.id}
              key={option.id}
              onClick={() => updateTheme({ appearance: option.id })}
            >
              {option.label}
            </button>
          ))}
        </div>
      </div>

      <div className="theme-font-control">
        <span>
          <strong>字体</strong>
          <small>聊天与界面文字</small>
        </span>
        <div role="group" aria-label="字体模式">
          <button
            type="button"
            className={preferences.fontMode === "standard" ? "active" : ""}
            aria-pressed={preferences.fontMode === "standard"}
            onClick={() => updateTheme({ fontMode: "standard" })}
          >
            DengTa 标准
          </button>
          <button
            type="button"
            className={preferences.fontMode === "system" ? "active" : ""}
            aria-pressed={preferences.fontMode === "system"}
            onClick={() => updateTheme({ fontMode: "system" })}
          >
            跟随系统
          </button>
        </div>
      </div>

      <section className="chat-skin-control" aria-labelledby="chat-skin-title">
        <div className="settings-card-heading">
          <div>
            <span className="settings-kicker">CHAT SKIN</span>
            <h4 id="chat-skin-title">奶油挂件</h4>
          </div>
          <span className="theme-live-dot">Live</span>
        </div>
        <label className="chat-skin-toggle">
          <span>
            <strong>奶油气泡与原创挂件</strong>
            <small>旧消息只换样式，不改聊天数据</small>
          </span>
          <input
            type="checkbox"
            checked={chatSkinPreferences?.skin === "taotao-cream"}
            onChange={(event) =>
              updateChatSkin?.({
                skin: event.target.checked ? "taotao-cream" : "classic-glass",
              })
            }
          />
        </label>
        <label className="chat-skin-select">
          <span>
            <strong>挂件活跃度</strong>
            <small>安静、自然或热闹</small>
          </span>
          <select
            value={chatSkinPreferences?.ornamentActivity || "natural"}
            onChange={(event) =>
              updateChatSkin?.({ ornamentActivity: event.target.value })
            }
          >
            <option value="quiet">安静</option>
            <option value="natural">自然</option>
            <option value="lively">热闹</option>
          </select>
        </label>
        <label className="chat-skin-toggle">
          <span>
            <strong>AI 心情输入提示</strong>
            <small>随当前会话氛围更新，不阻塞回复</small>
          </span>
          <input
            type="checkbox"
            checked={chatSkinPreferences?.dynamicComposerHint !== false}
            onChange={(event) =>
              updateChatSkin?.({ dynamicComposerHint: event.target.checked })
            }
          />
        </label>
        <label className="chat-skin-toggle">
          <span>
            <strong>减少动画</strong>
            <small>关闭回弹、挂件与背景动态；系统偏好也会生效</small>
          </span>
          <input
            type="checkbox"
            checked={chatSkinPreferences?.reduceMotion === true}
            onChange={(event) =>
              updateChatSkin?.({ reduceMotion: event.target.checked })
            }
          />
        </label>
        <label className="chat-skin-toggle">
          <span>
            <strong>沉浸聊天模式</strong>
            <small>隐藏处理阶段、生成中提示、心声和空的 AI 气泡，只显示最终回复与附件</small>
          </span>
          <input
            type="checkbox"
            checked={chatSkinPreferences?.hideGenerationProcess !== false}
            onChange={(event) =>
              updateChatSkin?.({ hideGenerationProcess: event.target.checked })
            }
          />
        </label>
        <label className="chat-skin-toggle">
          <span>
            <strong>显示错误码与日志</strong>
            <small>失败时显示技术细节；关闭后仍会保存，打开后旧错误也会重新显示</small>
          </span>
          <input
            type="checkbox"
            checked={chatSkinPreferences?.showErrorDetails === true}
            onChange={(event) =>
              updateChatSkin?.({ showErrorDetails: event.target.checked })
            }
          />
        </label>
      </section>
    </section>
  );
}
