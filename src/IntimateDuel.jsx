import { useEffect, useMemo, useRef, useState } from "react";
import { apiRequest } from "./api";
import {
  DUEL_SKILLS,
  applyDuelNarration,
  createDuelState,
  normalizeDuelState,
  playDuelRound,
  skillAvailability,
  winnerLabel,
} from "./intimate-duel";

const STORAGE_KEY = "dengta_intimate_duel_v2";

function readStoredDuel(names) {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    return stored ? normalizeDuelState(JSON.parse(stored), names) : createDuelState(names);
  } catch {
    return createDuelState(names);
  }
}

function FighterCard({ fighter, tone }) {
  return (
    <article className={`duel-fighter-card ${tone}`}>
      <header>
        <span className="duel-avatar" aria-hidden="true">
          {fighter.name.slice(0, 1)}
        </span>
        <div>
          <strong>{fighter.name}</strong>
          <small>{fighter.combo > 1 ? `COMBO ×${fighter.combo}` : "READY"}</small>
        </div>
      </header>
      <div className="duel-meter-row stamina">
        <span>体力</span>
        <strong>{fighter.stamina}/100</strong>
        <div className="duel-meter" aria-label={`体力 ${fighter.stamina}`}>
          <span style={{ width: `${fighter.stamina}%` }} />
        </div>
      </div>
      <div className={`duel-meter-row pleasure${fighter.pleasure >= 78 ? " warning" : ""}`}>
        <span>快感</span>
        <strong>{fighter.pleasure}/100</strong>
        <div className="duel-meter" aria-label={`快感 ${fighter.pleasure}`}>
          <span style={{ width: `${fighter.pleasure}%` }} />
        </div>
      </div>
    </article>
  );
}

export default function IntimateDuel({ aiName, userName, conversationId }) {
  const names = useMemo(
    () => ({
      playerName: String(userName || "你").trim() || "你",
      companionName: String(aiName || "小灯").trim() || "小灯",
    }),
    [aiName, userName],
  );
  const [duel, setDuel] = useState(() => readStoredDuel(names));
  const [isNarrating, setIsNarrating] = useState(false);
  const [notice, setNotice] = useState("");
  const logRef = useRef(null);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(duel));
    } catch {
      // A full local store must not interrupt an active round.
    }
  }, [duel]);

  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight, behavior: "smooth" });
  }, [duel.logs, isNarrating]);

  function restart() {
    setDuel(createDuelState(names));
    setIsNarrating(false);
    setNotice("");
  }

  async function narrateRound(event) {
    setIsNarrating(true);
    try {
      const data = await apiRequest("/api/v2/intimate-duel/narrate", {
        method: "POST",
        body: JSON.stringify({
          conversation_id: conversationId || undefined,
          duel_id: duel.id,
          round: event.round,
          player_skill: event.playerSkill.id,
          companion_skill: event.companionSkill?.id || null,
          player: event.player,
          companion: event.companion,
          player_combo: event.playerCombo,
          companion_combo: event.companionCombo,
          winner: event.winner,
        }),
      });
      if (data?.narration) {
        setDuel((current) => applyDuelNarration(current, event.id, data.narration));
      }
    } catch (error) {
      setNotice(error.message || "这一回合的场景文字暂时没有生成，数值结果已经保留。");
    } finally {
      setIsNarrating(false);
    }
  }

  function handleSkill(skill) {
    if (isNarrating || duel.status !== "active") return;
    try {
      const result = playDuelRound(duel, skill.id);
      setDuel(result.state);
      setNotice("");
      void narrateRound(result.event);
    } catch (error) {
      setNotice(error.message);
    }
  }

  return (
    <section className="feature-page intimate-duel" aria-label="成人双人回合对战">
      <header className="duel-stage-header">
        <div>
          <span>ADULT PRIVATE MATCH</span>
          <h2>{duel.status === "finished" ? winnerLabel(duel) : `ROUND ${duel.round}`}</h2>
        </div>
        <button type="button" className="duel-restart" onClick={restart}>
          {duel.status === "finished" ? "再来一局" : "重新开始"}
        </button>
      </header>

      <div className="duel-fighters">
        <FighterCard fighter={duel.player} tone="player" />
        <FighterCard fighter={duel.companion} tone="companion" />
      </div>

      <section ref={logRef} className="duel-log" aria-live="polite">
        {duel.logs.map((entry) => (
          <article key={entry.id} className={entry.kind}>
            <small>{entry.title}</small>
            <p>{entry.text}</p>
          </article>
        ))}
        {isNarrating && (
          <div className="duel-narrating" role="status">
            <span aria-hidden="true" />
            {duel.companion.name}正在接住这一回合…
          </div>
        )}
      </section>

      {notice && (
        <div className="duel-notice" role="status">
          <span>{notice}</span>
          <button type="button" aria-label="关闭提示" onClick={() => setNotice("")}>×</button>
        </div>
      )}

      <section className="duel-skills" aria-label="选择招式">
        <h3>{duel.status === "finished" ? "本局已经结束" : "选择你的招式"}</h3>
        <div className="duel-skill-grid">
          {DUEL_SKILLS.map((skill) => {
            const availability = skillAvailability(duel.player, skill);
            const disabled = !availability.available || isNarrating || duel.status !== "active";
            return (
              <button
                type="button"
                key={skill.id}
                className={skill.kind}
                disabled={disabled}
                onClick={() => handleSkill(skill)}
              >
                <span className="duel-skill-heading">
                  <strong>{skill.name}</strong>
                  <em>
                    {availability.reason === "cooldown"
                      ? `${availability.cooldown} 回合`
                      : skill.kind === "recover"
                        ? "恢复"
                        : `-${skill.staminaCost} 体力`}
                  </em>
                </span>
                <small>{skill.description}</small>
              </button>
            );
          })}
        </div>
      </section>
    </section>
  );
}
