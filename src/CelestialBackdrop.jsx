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

export default function CelestialBackdrop({ snapshot }) {
  const x = `${Math.round(snapshot.progress * 78)}vw`;
  const y = `${Math.round(snapshot.arc * -58)}px`;

  return (
    <div
      className={[
        "celestial-backdrop",
        `phase-${snapshot.phase}`,
        `pattern-${snapshot.pattern}`,
        snapshot.moonPeak ? "moon-peak" : "",
      ]
        .filter(Boolean)
        .join(" ")}
      aria-hidden="true"
      style={{
        "--celestial-x": x,
        "--celestial-y": y,
      }}
    >
      <div className="celestial-sky-wash" />
      <div className="celestial-body">
        <span className="celestial-sun" />
        <span className="celestial-moon" />
      </div>
      <div className="celestial-shadow-cast">
        <PatternSilhouette pattern={snapshot.pattern} />
      </div>
    </div>
  );
}
