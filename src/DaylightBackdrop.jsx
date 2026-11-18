import { memo } from "react";
import { atlasHeightPercent, daylightAt } from "./daylight-sky.js";
import atlas from "./assets/daylight-sky.webp";
import "./daylight-backdrop.css";

// Fixed positions keep the sky still during a conversation and when scrubbing.
let seed = 4221;
const random = () => ((seed = Math.imul(seed, 1664525) + 1013904223 >>> 0) / 2 ** 32);
const stars = Array.from({ length: 80 }, (_, i) => <circle key={i}
  cx={random() * 390} cy={random() * 844} r={0.35 + random() * 0.62}
  opacity={0.25 + random() * 0.54} />);

export default memo(function DaylightBackdrop({ minute }) {
  const sky = daylightAt(minute);
  return <div className="daylight-backdrop" aria-hidden="true"
    style={{ "--sky-atlas": `url("${atlas}")`, "--sky-scale": `${atlasHeightPercent}%`,
      backgroundImage: `linear-gradient(${sky.top}, ${sky.bottom})` }}>
    <div className="daylight-tile" style={{ backgroundPositionY: sky.fromY }} />
    <div className="daylight-tile" style={{ backgroundPositionY: sky.toY, opacity: sky.mix }} />
    {sky.stars > 0 && <svg viewBox="0 0 390 844" preserveAspectRatio="xMidYMid slice"
      fill="white" focusable="false" style={{ opacity: sky.stars }}>{stars}</svg>}
  </div>;
});
