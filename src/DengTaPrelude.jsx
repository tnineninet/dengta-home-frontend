import { useEffect, useState } from "react";

const PRELUDE_DURATION_MS = 2_600;

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
            data-word="DENGTA"
            d="M20 84V24C52 20 66 32 66 54S52 88 20 84H80V24H120H80V54H116H80V84H120H136V24L178 84V24H194C178 24 178 84 218 84C244 84 244 54 220 54H238V24H254H300H277V84H316L340 24L366 84L354 56H328L316 84"
          />
          <path className="dengta-prelude-line" d="M20 54H400" />
          <circle className="dengta-prelude-tip" cx="400" cy="54" r="2.5" />
        </svg>
        <div className="dengta-prelude-copy">
          <strong>DENGTA</strong>
          <small>小灯与桃桃的小屋</small>
        </div>
      </div>
    </div>
  );
}
