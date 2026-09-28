import { COMPANION_GENDERS, companionPronoun } from "./companion-gender";

export default function CompanionGenderFields({ settings, onChange }) {
  return <div className="mcp-form-grid">
    <label className="prompt-name-field">
      <span>AI 性别</span>
      <select aria-label="AI 性别" value={settings.ai_gender || "unspecified"} onChange={(event) => {
        onChange("ai_gender", event.target.value);
        onChange("ai_pronouns", "");
      }}>
        {COMPANION_GENDERS.map(({ value, label }) => <option key={value} value={value}>{label}</option>)}
      </select>
      <small>当前伴侣独立保存。男性默认“他”，女性默认“她”，其他默认“TA”。</small>
    </label>
    {settings.ai_gender === "other" && <label className="prompt-name-field">
      <span>自定义性别名称</span>
      <input aria-label="自定义性别名称" maxLength={60} value={settings.ai_gender_label || ""} onChange={(event) => onChange("ai_gender_label", event.target.value)} />
    </label>}
    <label className="prompt-name-field">
      <span>第三人称称谓（可选）</span>
      <input aria-label="第三人称称谓" maxLength={20} value={settings.ai_pronouns || ""} placeholder={companionPronoun({ ai_gender: settings.ai_gender })} onChange={(event) => onChange("ai_pronouns", event.target.value)} />
      <small>留空使用默认称谓，也可以填写 TA、they 等。当前：{companionPronoun(settings)}。</small>
    </label>
  </div>;
}
