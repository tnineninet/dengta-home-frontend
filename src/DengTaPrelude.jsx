import { useEffect, useState } from "react";

const PRELUDE_DURATION_MS = 2_250;

export default function DengTaPrelude() {
  const [visible, setVisible] = useState(true);

  useEffect(() => {
    const timer = window.setTimeout(() => setVisible(false), PRELUDE_DURATION_MS);
    return () => window.clearTimeout(timer);
  }, []);

  if (!visible) return null;

  return (
    <div className="dengta-prelude" aria-hidden="true">
      <div className="dengta-prelude-mark">
        <svg viewBox="0 0 420 108" role="presentation">
          <path
            className="dengta-prelude-signature"
            d="M22 62c21-34 34-34 39-1 5 31 18 35 29 2 11-32 22-36 31-4 8 27 20 29 32 4 13-27 25-28 36-2 11 24 22 23 34-2 13-27 25-28 36 0 10 25 23 25 37-1 14-25 26-25 36 1 9 23 23 23 36-2 13-23 26-22 50 3"
          />
          <path
            className="dengta-prelude-line"
            d="M22 62H398"
          />
        </svg>
        <span className="dengta-prelude-tip" />
        <div className="dengta-prelude-copy">
          <strong>DengTa</strong>
          <small>小灯与桃桃的小屋</small>
        </div>
      </div>
    </div>
  );
}
