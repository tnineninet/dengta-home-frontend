import { memo } from "react";
import "./legacy-coast-backdrop.css";

const SCENES = {
  day: {
    label: "晨光",
    photo: "/assets/coast-video/coast-day.webp",
  },
  twilight: {
    label: "暮色",
    photo: "/assets/coast-video/coast-twilight.webp",
  },
  night: {
    label: "星夜",
    photo: "/assets/coast-video/coast-night.webp",
  },
};

function resolveLegacyCoastScene(mode, snapshot = {}, appearance = "auto") {
  if (mode === "legacy-day") return "day";
  if (mode === "legacy-dusk") return "twilight";
  if (mode === "legacy-night") return "night";
  if (appearance === "day") return "day";
  if (appearance === "night") return "night";
  if (snapshot.phase === "dawn" || snapshot.phase === "dusk") return "twilight";
  return snapshot.resolvedAppearance === "night" ? "night" : "day";
}

function LegacyCoastBackdrop({ mode = "legacy", snapshot = {}, appearance = "auto" }) {
  const scene = resolveLegacyCoastScene(mode, snapshot, appearance);
  const asset = SCENES[scene];

  return (
    <div
      className="legacy-coast-backdrop"
      data-scene={scene}
      data-mode={mode}
      role="presentation"
      aria-hidden="true"
    >
      <img
        className="legacy-coast-photo"
        src={asset.photo}
        alt=""
        decoding="async"
        draggable="false"
      />
      <div className="legacy-coast-wash" />
      <div className="legacy-coast-sun" />
      <div className="legacy-coast-cloud legacy-coast-cloud-a" />
      <div className="legacy-coast-cloud legacy-coast-cloud-b" />
      <div className="legacy-coast-cloud legacy-coast-cloud-c" />
      <div className="legacy-coast-moon" />
      <div className="legacy-coast-stars" />
      <div className="legacy-coast-haze" />
      <div className="legacy-coast-vignette" />
    </div>
  );
}

export default memo(LegacyCoastBackdrop);
