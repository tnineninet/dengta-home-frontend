import { memo } from "react";
import { getSunGlassSky } from "./sun-glass-sky.js";
import { coastSceneForSky } from "./coast-video-lifecycle.js";
import "./legacy-coast-backdrop.css";

const SCENES = {
  day: "/assets/coast-video/coast-day.webp",
  twilight: "/assets/coast-video/coast-twilight.webp",
  night: "/assets/coast-video/coast-night.webp",
};

function clamp(value, minimum = 0, maximum = 1) {
  const number = Number(value);
  return Number.isFinite(number)
    ? Math.max(minimum, Math.min(maximum, number))
    : minimum;
}

/**
 * The old background was never a fixed picture: the sun and moon climbed
 * through the sky, and the five sky colour stops shifted with sunrise/sunset.
 * This reuses the repository's own solar sky model and coast stills instead of
 * faking a static scene.
 */
function LegacyCoastBackdrop({ snapshot = {} }) {
  const sky = getSunGlassSky(
    Number.isFinite(snapshot.minute) ? snapshot.minute : 0,
    snapshot,
  );
  const scene = coastSceneForSky(sky);
  const colors = Array.isArray(sky.colors) && sky.colors.length >= 5
    ? sky.colors
    : ["#bcdbe5", "#c9e1e5", "#e8e4cf", "#f3d9a5", "#f7c683"];
  const style = {
    "--legacy-sky-0": colors[0],
    "--legacy-sky-1": colors[1],
    "--legacy-sky-2": colors[2],
    "--legacy-sky-3": colors[3],
    "--legacy-sky-4": colors[4],
    "--legacy-sun-x": `${clamp(sky.sunX, 0, 100)}%`,
    "--legacy-sun-y": `${clamp(sky.sunY, 0, 100)}%`,
    "--legacy-sun-opacity": clamp(sky.sunOpacity),
    "--legacy-moon-x": `${clamp(sky.moonX, 0, 100)}%`,
    "--legacy-moon-y": `${clamp(sky.moonY, 0, 100)}%`,
    "--legacy-moon-opacity": clamp(sky.moonOpacity),
    "--legacy-stars-opacity": clamp((sky.night - 0.16) * 1.22),
    "--legacy-cloud-opacity": clamp(0.1 + sky.daylight * 0.34),
    "--legacy-warm-opacity": clamp(Math.max(sky.sunriseAura, sky.sunsetAura)),
    "--legacy-blue-opacity": clamp(sky.blueAura),
    "--legacy-tint-opacity": clamp(0.18 + sky.daylight * 0.2 + sky.night * 0.12),
  };

  return (
    <div
      className="legacy-coast-backdrop"
      data-scene={scene}
      role="presentation"
      aria-hidden="true"
      style={style}
    >
      <img
        className="legacy-coast-photo"
        src={SCENES[scene]}
        alt=""
        decoding="async"
        draggable="false"
      />
      <div
        className="legacy-coast-sky-tint"
        style={{
          background: `linear-gradient(168deg, ${colors[0]} 0%, ${colors[1]} 24%, ${colors[2]} 52%, ${colors[3]} 78%, ${colors[4]} 100%)`,
        }}
      />
      <div className="legacy-coast-warm-glow" />
      <div className="legacy-coast-blue-glow" />
      <div className="legacy-coast-sun" />
      <div className="legacy-coast-moon" />
      <div className="legacy-coast-cloud legacy-coast-cloud-a" />
      <div className="legacy-coast-cloud legacy-coast-cloud-b" />
      <div className="legacy-coast-cloud legacy-coast-cloud-c" />
      <div className="legacy-coast-stars" />
      <div className="legacy-coast-haze" />
      <div className="legacy-coast-vignette" />
    </div>
  );
}

export default memo(LegacyCoastBackdrop);
