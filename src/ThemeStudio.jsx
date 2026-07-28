import { THEME_PRESETS } from "./dengta-theme.js";

const APPEARANCE_OPTIONS = [
  { id: "auto", label: "Auto" },
  { id: "day", label: "Day" },
  { id: "night", label: "Night" },
];

export default function ThemeStudio({ preferences, updateTheme }) {
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
            <strong>Glass opacity</strong>
            <output>{Math.round(preferences.cardOpacity * 100)}%</output>
          </span>
          <input
            type="range"
            min="56"
            max="96"
            value={Math.round(preferences.cardOpacity * 100)}
            onChange={(event) =>
              updateTheme({ cardOpacity: Number(event.target.value) / 100 })
            }
          />
        </label>
        <label className="theme-opacity-control theme-light-control">
          <span>
            <strong>Sunlight</strong>
            <output>{Math.round(preferences.sunIntensity * 100)}%</output>
          </span>
          <small>调节日出、正午与夕阳照亮玻璃的范围</small>
          <input
            type="range"
            min="35"
            max="160"
            value={Math.round(preferences.sunIntensity * 100)}
            onChange={(event) =>
              updateTheme({ sunIntensity: Number(event.target.value) / 100 })
            }
          />
        </label>
        <label className="theme-opacity-control theme-light-control">
          <span>
            <strong>Moonlight</strong>
            <output>{Math.round(preferences.moonIntensity * 100)}%</output>
          </span>
          <small>调节月光点光源的亮度与照射面积</small>
          <input
            type="range"
            min="35"
            max="160"
            value={Math.round(preferences.moonIntensity * 100)}
            onChange={(event) =>
              updateTheme({ moonIntensity: Number(event.target.value) / 100 })
            }
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
    </section>
  );
}
