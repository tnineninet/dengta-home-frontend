const STARS = Object.freeze([
  [7, 14, 0.72, "four"],
  [15, 27, 0.5, "dot"],
  [24, 11, 0.86, "five"],
  [33, 31, 0.62, "four"],
  [42, 18, 0.44, "dot"],
  [51, 8, 0.78, "four"],
  [60, 27, 0.56, "five"],
  [69, 13, 0.92, "four"],
  [77, 34, 0.48, "dot"],
  [84, 17, 0.7, "five"],
  [91, 29, 0.58, "four"],
  [12, 43, 0.45, "dot"],
  [28, 46, 0.69, "four"],
  [47, 39, 0.55, "five"],
  [64, 48, 0.74, "dot"],
  [81, 44, 0.62, "four"],
  [95, 49, 0.48, "dot"],
]);

function PatternSilhouette({ pattern }) {
  if (pattern === "cat") {
    return (
      <svg viewBox="0 0 440 260" role="presentation">
        <path d="M283 217c-2-47 12-80 44-94l-5-38 28 23 27-20-1 41c22 18 31 49 27 88h-55c5-29 1-52-12-69-18 12-27 35-26 69h-27Z" />
        <path d="M276 214c-31-20-47-11-54 4 30-4 49 8 63 27" />
      </svg>
    );
  }
  if (pattern === "botanical") {
    return (
      <svg viewBox="0 0 440 260" role="presentation">
        <path d="M66 259c20-74 64-131 122-176M132 181c-37-1-59-18-67-50 37-5 62 13 67 50ZM152 144c4-40 28-63 66-69 1 39-22 63-66 69ZM183 104c-16-28-14-52 6-73 25 26 23 50-6 73ZM274 260c-2-77 18-139 61-187M301 160c-30-13-45-36-43-70 34 8 49 31 43 70ZM322 120c6-36 28-55 64-58-2 38-23 57-64 58Z" />
      </svg>
    );
  }
  return <span className="celestial-window-lattice" />;
}

function StarField() {
  return (
    <div className="celestial-stars">
      {STARS.map(([left, top, opacity, shape], index) => (
        <i
          className={`celestial-star shape-${shape}`}
          key={`${left}-${top}`}
          style={{
            "--star-left": `${left}%`,
            "--star-top": `${top}%`,
            "--star-opacity": opacity,
            "--star-delay": `${(index % 7) * -0.47}s`,
          }}
        />
      ))}
    </div>
  );
}

export default function CelestialBackdrop({ snapshot }) {
  const x = `${Math.round(snapshot.progress * 84)}vw`;
  const y = `${Math.round(snapshot.arc * -52)}px`;
  const sourceX = `${Math.round(7 + snapshot.progress * 84)}%`;
  const activeIntensity = snapshot.activeIntensity;

  return (
    <div
      className={[
        "celestial-backdrop",
        `phase-${snapshot.phase}`,
        `pattern-${snapshot.pattern}`,
        snapshot.isSun ? "is-sun" : "is-moon",
        snapshot.moonPeak ? "moon-peak" : "",
      ]
        .filter(Boolean)
        .join(" ")}
      aria-hidden="true"
      data-light-source={snapshot.lightSource}
      data-sunrise={snapshot.sunriseLabel}
      data-sunset={snapshot.sunsetLabel}
      style={{
        "--celestial-x": x,
        "--celestial-y": y,
        "--celestial-progress": snapshot.progress,
        "--celestial-arc": snapshot.arc,
        "--celestial-active-intensity": snapshot.activeIntensity,
        "--celestial-light-angle": `${snapshot.lightAngle}deg`,
        "--celestial-source-x": sourceX,
        "--celestial-sky-opacity": Math.min(
          0.92,
          0.38 + activeIntensity * 0.26,
        ),
        "--celestial-light-opacity": Math.min(
          0.86,
          activeIntensity * 0.56,
        ),
        "--celestial-shadow-opacity": Math.min(
          0.5,
          activeIntensity * 0.3,
        ),
        "--celestial-night-shadow-opacity": Math.min(
          0.54,
          activeIntensity * 0.34,
        ),
        "--celestial-flare-opacity": Math.min(
          0.58,
          activeIntensity * 0.42,
        ),
        "--celestial-glow-soft": Math.min(0.58, activeIntensity * 0.25),
        "--celestial-glow-strong": Math.min(0.82, activeIntensity * 0.58),
        "--celestial-shadow-shift": `${Math.round(
          (0.5 - snapshot.progress) * 12,
        )}vw`,
        "--sun-glow-near": `${Math.round(22 * snapshot.sunIntensity)}px`,
        "--sun-glow-mid": `${Math.round(96 * snapshot.sunIntensity)}px`,
        "--sun-glow-far": `${Math.round(190 * snapshot.sunIntensity)}px`,
        "--moon-glow-near": `${Math.round(22 * snapshot.moonIntensity)}px`,
        "--moon-glow-mid": `${Math.round(92 * snapshot.moonIntensity)}px`,
        "--moon-glow-far": `${Math.round(180 * snapshot.moonIntensity)}px`,
      }}
    >
      <div className="celestial-sky-wash" />
      <div className="celestial-milky-way" />
      <StarField />
      <div className="celestial-clouds">
        <i className="celestial-cloud cloud-one" />
        <i className="celestial-cloud cloud-two" />
        <i className="celestial-cloud cloud-three" />
      </div>
      <div className="celestial-light-field" />
      <div className="celestial-body">
        <span className="celestial-sun" />
        <span className="celestial-moon" />
      </div>
      <div className="celestial-lens-flare">
        <i />
        <i />
        <i />
      </div>
      <div className="celestial-shadow-cast">
        <PatternSilhouette pattern={snapshot.pattern} />
      </div>
      <div className="celestial-glass-grain" />
    </div>
  );
}
