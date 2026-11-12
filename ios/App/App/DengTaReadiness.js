/* Debug Simulator reader. Export only fixed enums, booleans and geometry. */
(() => {
  const d = document, r = d.documentElement, v = window.visualViewport;
  const states = ['unconfigured', 'loading', 'anonymous', 'authenticating', 'recovery', 'authenticated', 'expired', 'error'];
  const state = states.includes(r.dataset.authStatus) ? r.dataset.authStatus : 'unknown';
  const viewport = { left: v?.offsetLeft || 0, top: v?.offsetTop || 0,
    width: v?.width || innerWidth, height: v?.height || innerHeight };
  const contains = (outer, inner) => inner.left >= outer.left - 1 && inner.top >= outer.top - 1 &&
    inner.right <= outer.left + outer.width + 1 && inner.bottom <= outer.top + outer.height + 1;
  const visible = element => {
    if (!element || element.disabled) return false;
    const box = element.getBoundingClientRect();
    if (box.width <= 0 || box.height <= 0 || !contains(viewport, box)) return false;
    for (let parent = element; parent; parent = parent.parentElement) {
      const style = getComputedStyle(parent);
      if (style.display === 'none' || style.visibility !== 'visible' || Number(style.opacity) <= 0.01) return false;
      if (parent !== element && /hidden|clip|scroll|auto/.test(`${style.overflowX} ${style.overflowY}`) &&
          !contains(parent.getBoundingClientRect(), box)) return false;
    }
    const inset = Math.min(4, box.width / 4, box.height / 4);
    return [[box.left + inset, box.top + inset], [box.right - inset, box.top + inset],
      [box.left + box.width / 2, box.top + box.height / 2], [box.left + inset, box.bottom - inset],
      [box.right - inset, box.bottom - inset]].every(([x, y]) => {
      const target = d.elementFromPoint(x, y);
      return target === element || element.contains(target);
    });
  };
  const form = d.querySelector('.auth-form');
  const controls = ['input[type="email"]', 'input[type="password"]', 'button[type="submit"]']
    .every(selector => visible(form?.querySelector(selector)));
  const blocked = !!d.querySelector('.dengta-prelude,.auth-loading-page,.auth-configuration-page,.auth-secure-cleanup-page,.auth-feedback[role="alert"]');
  return { state, ready: state === 'anonymous' && controls && !blocked,
    controls, blocked, keyboardOpen: r.dataset.keyboardOpen === 'true',
    viewportHeight: Math.round(viewport.height), viewportOffsetTop: Math.round(viewport.top),
    innerHeight: Math.round(innerHeight), androidMarker: r.dataset.dengtaAndroid === 'true',
    apkEntry: !!d.querySelector('a[href="/download"]') };
})()
