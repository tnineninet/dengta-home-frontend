import { createVisualLoop } from "./visual-loop.js";
import { memo, useEffect, useMemo, useRef } from "react";
import { getSunGlassSky, weatherModeFromAmbient, rainIntensityFromAmbient } from "./sun-glass-sky.js";
import useReducedVisualMotion from "./use-reduced-visual-motion.js";
import CoastVideoBackdrop from "./CoastVideoBackdrop.jsx";
import "./lumen-sky.css";

function clamp(value, minimum = 0, maximum = 1) {
  return Math.max(minimum, Math.min(maximum, value));
}

function parseHexRgb(hex) {
  const clean = hex.replace("#", "");
  return [
    Number.parseInt(clean.slice(0, 2), 16),
    Number.parseInt(clean.slice(2, 4), 16),
    Number.parseInt(clean.slice(4, 6), 16),
  ];
}

function blendHex(aHex, bHex, t) {
  const a = parseHexRgb(aHex);
  const b = parseHexRgb(bHex);
  return `rgb(${Math.round(a[0] + (b[0] - a[0]) * t)} ${Math.round(a[1] + (b[1] - a[1]) * t)} ${Math.round(a[2] + (b[2] - a[2]) * t)})`;
}

// Smooth video-matched 24h atmospheric palette (creamy golden sunrise -> soft cerulean day -> coral-peach dusk -> velvet midnight)
const LUMEN_PALETTE_KEYS = Object.freeze([
  { minute: 0, colors: ["#0b1224", "#121b33", "#192644", "#213052", "#28395c"] },
  { minute: 270, colors: ["#0e172c", "#17233f", "#243252", "#354162", "#474d6c"] },
  { minute: 360, colors: ["#324c78", "#60789e", "#9aa0ba", "#d4b2ad", "#ebc5a6"] },
  { minute: 430, colors: ["#86b5d6", "#aeced7", "#dbe2c9", "#f7dca3", "#f6c289"] },
  { minute: 520, colors: ["#75b1dc", "#a4cfe0", "#d4e2d8", "#f4dfac", "#f3c78d"] },
  { minute: 720, colors: ["#67a7da", "#9ec9e0", "#d0dfe0", "#ebe0c5", "#efd3a3"] },
  { minute: 930, colors: ["#6d9ecb", "#9ec0d5", "#d3d4cf", "#efc4a6", "#f0a991"] },
  { minute: 1050, colors: ["#4e72a3", "#8883ad", "#c58a9f", "#ec968e", "#f7a483"] },
  { minute: 1110, colors: ["#2b4b80", "#556896", "#877ea4", "#ba8b9d", "#d8958f"] },
  { minute: 1180, colors: ["#162447", "#23355c", "#35466e", "#4a5377", "#615e7c"] },
  { minute: 1280, colors: ["#0d152a", "#14203b", "#1c2b4c", "#24355a", "#2c3f66"] },
  { minute: 1440, colors: ["#0b1224", "#121b33", "#192644", "#213052", "#28395c"] },
]);

function getLumenAtmosphere(sky) {
  const normalized = ((Number(sky?.solarMinute) || 0) % 1440 + 1440) % 1440;
  const rightIdx = LUMEN_PALETTE_KEYS.findIndex((k) => k.minute >= normalized);
  const right = LUMEN_PALETTE_KEYS[Math.max(1, rightIdx)];
  const left = LUMEN_PALETTE_KEYS[Math.max(0, rightIdx - 1)];
  const rawT = (normalized - left.minute) / Math.max(1, right.minute - left.minute);
  const eased = rawT * rawT * (3 - 2 * rawT);
  const colors = left.colors.map((hex, i) => blendHex(hex, right.colors[i], eased));

  const orbVisible = clamp(sky.daylight * 0.92 + sky.sunrise * 0.55 + sky.sunset * 0.52);
  const isWarm = sky.sunrise > 0.2 || sky.sunset > 0.2;
  const coreColor = sky.sunset > sky.sunrise
    ? "rgb(255 224 188 / 0.95)"
    : isWarm
      ? "rgb(255 247 212 / 0.96)"
      : "rgb(255 253 238 / 0.9)";
  const innerColor = sky.sunset > sky.sunrise
    ? "rgb(248 164 142 / 0.68)"
    : "rgb(248 220 156 / 0.68)";
  const midColor = sky.sunset > sky.sunrise
    ? "rgb(236 140 150 / 0.34)"
    : "rgb(242 204 150 / 0.32)";

  return {
    colors,
    orbX: sky.sunX,
    orbY: Math.max(20, Math.min(78, sky.sunY)),
    orbScale: 0.92 + Math.sin((sky.progress || 0) * Math.PI) * 0.22,
    orbOpacity: Number(orbVisible.toFixed(3)),
    bokehOpacity: Number(clamp((sky.night - 0.14) * 1.15).toFixed(3)),
    veilOpacity: Number((0.28 + sky.sunrise * 0.32 + sky.sunset * 0.34 + sky.blueHour * 0.18).toFixed(3)),
    coreColor,
    innerColor,
    midColor,
    horizonColor: sky.night > 0.65
      ? "rgb(48 72 124 / 0.24)"
      : sky.sunset > 0.25
        ? "rgb(246 156 134 / 0.44)"
        : "rgb(248 214 158 / 0.42)",
  };
}

function sizeCanvas(canvas, maximumRatio) {
  const ratio = Math.min(window.devicePixelRatio || 1, maximumRatio);
  const nextWidth = Math.round(window.innerWidth * ratio);
  const nextHeight = Math.round(window.innerHeight * ratio);
  if (canvas.width !== nextWidth) canvas.width = nextWidth;
  if (canvas.height !== nextHeight) canvas.height = nextHeight;
  canvas.style.width = `${window.innerWidth}px`;
  canvas.style.height = `${window.innerHeight}px`;
  return ratio;
}

// Soft layered cloud puff (NO ctx.filter Gaussian blur -> 10x faster, keeps exact 2 fill() calls per cloud)
function drawCloudShape(context, x, y, size, alpha, darkness) {
  context.save();
  context.translate(x, y);
  context.scale(size, size * 0.74);
  const cloudPath = (offsetY = 0, inflate = 1) => {
    context.beginPath();
    context.ellipse(-58, 8 + offsetY, 67 * inflate, 28 * inflate, 0, 0, Math.PI * 2);
    context.ellipse(-18, -11 + offsetY, 52 * inflate, 38 * inflate, 0, 0, Math.PI * 2);
    context.ellipse(32, -4 + offsetY, 61 * inflate, 34 * inflate, 0, 0, Math.PI * 2);
    context.ellipse(73, 12 + offsetY, 51 * inflate, 24 * inflate, 0, 0, Math.PI * 2);
  };
  context.fillStyle = `rgba(${Math.round(82 - darkness * 30)},${Math.round(105 - darkness * 24)},${Math.round(136 - darkness * 18)},${(alpha * (0.16 + darkness * 0.22)).toFixed(3)})`;
  cloudPath(9, 1.08);
  context.fill();
  context.fillStyle = `rgba(${Math.round(246 - darkness * 126)},${Math.round(248 - darkness * 120)},${Math.round(250 - darkness * 102)},${(alpha * 0.86).toFixed(3)})`;
  cloudPath(0, 1);
  context.fill();
  context.restore();
}

function usePrototypeAtmosphere({ starsRef, cloudsRef, weatherRef, sky, mode, rainIntensity = 1, reduceMotion }) {
  const skyRef = useRef(sky);
  const loopRef = useRef(null);

  useEffect(() => {
    skyRef.current = sky;
    loopRef.current?.invalidate();
  }, [sky]);

  // NOTE: Do NOT depend on `starsVisible` (sky.night > 0.08)!
  // Rebuilding canvases when crossing dawn/dusk blanked the pixel buffer for 1-2 frames and caused severe flicker during scrubbing.
  useEffect(() => {
    const starsCanvas = starsRef.current;
    const cloudCanvas = cloudsRef.current;
    const weatherCanvas = weatherRef.current;
    if (!starsCanvas || !cloudCanvas || !weatherCanvas) return undefined;

    const starsContext = starsCanvas.getContext("2d");
    const cloudContext = cloudCanvas.getContext("2d");
    const weatherContext = weatherCanvas.getContext("2d");
    if (!starsContext || !cloudContext || !weatherContext) return undefined;
    const wetWeather = mode === "rain" || mode === "storm";
    const compact = typeof window !== "undefined" && (
      window.matchMedia?.("(max-width: 820px)")?.matches === true ||
      window.matchMedia?.("(pointer: coarse)")?.matches === true
    );
    let starPoints = [];
    let galaxyPoints = [];
    let bokehPoints = [];
    let cloudPoints = [];
    let rainDrops = [];
    let glassDrops = [];
    let ripples = [];
    let nextRippleAt = 0;
    let nextLightningAt = performance.now() + 480;
    let lightningUntil = 0;
    let lightningSegments = [];
    let starsRatio = 1;
    let cloudRatio = 1;

    const resize = () => {
      starsRatio = sizeCanvas(starsCanvas, compact ? 1.5 : 2);
      cloudRatio = sizeCanvas(cloudCanvas, compact ? 1.25 : 1.5);
      sizeCanvas(weatherCanvas, compact ? 1.25 : 1.5);
      starPoints = Array.from({ length: compact ? 70 : 110 }, (_, index) => ({
        x: ((index * 73) % 997) / 997,
        y: (((index * 137 + 31) % 719) / 719) * 0.82,
        radius: 0.4 + ((index * 19) % 13) / 10,
        phase: (index * 0.71) % (Math.PI * 2),
        steady: index % 4 === 0,
        speed: 950 + (index % 7) * 240,
      }));
      bokehPoints = Array.from({ length: compact ? 10 : 18 }, (_, index) => ({
        x: ((index * 163 + 47) % 991) / 991,
        y: (((index * 211 + 59) % 733) / 733) * 0.72,
        radius: 3.2 + (index % 5) * 1.4,
        phase: index * 1.13,
      }));
      galaxyPoints = Array.from({ length: compact ? 150 : 260 }, (_, index) => {
        const x = ((index * 89) % 997) / 997;
        const spread = ((((index * 149 + 47) % 1009) / 1009) - 0.5) * 0.2;
        return {
          x,
          y: 0.66 - x * 0.5 + spread,
          radius: 0.25 + ((index * 17) % 11) / 14,
          alpha: 0.14 + ((index * 23) % 17) / 29,
        };
      });
      cloudPoints = Array.from({ length: 9 }, (_, index) => ({
        x: ((index * 0.19 + 0.07) % 1.28) - 0.14,
        y: [0.2, 0.31, 0.47, 0.66, 0.26, 0.55, 0.39, 0.72, 0.16][index],
        scale: 0.62 + ((index * 29) % 7) / 8,
        speed: 0.65 + (index % 5) * 0.16,
        depth: 0.56 + (index % 3) * 0.18,
      }));
      rainDrops = Array.from({ length: Math.round(94 * rainIntensity) }, (_, index) => ({
        x: ((index * 83) % 991) / 991,
        y: ((index * 131) % 977) / 977,
        speed: (0.52 + (index % 11) / 14) * Math.sqrt(rainIntensity),
        length: (11 + (index % 9) * 2.2) * Math.sqrt(rainIntensity),
      }));
      glassDrops = Array.from({ length: 38 }, (_, index) => ({
        x: ((index * 97 + 23) % 991) / 991,
        y: ((index * 151 + 41) % 977) / 977,
        size: 1.8 + (index % 8) * 0.7,
        phase: index * 0.81,
      }));
    };

    const createLightning = (now) => {
      let x = window.innerWidth * (0.2 + Math.random() * 0.6);
      let y = -10;
      lightningSegments = [];
      while (y < window.innerHeight * 0.68) {
        const nextX = x + (Math.random() - 0.5) * 58;
        const nextY = y + 34 + Math.random() * 42;
        lightningSegments.push([x, y, nextX, nextY]);
        x = nextX;
        y = nextY;
      }
      lightningUntil = now + 430;
      nextLightningAt = now + 4600 + Math.random() * 5200;
    };

    const paint = (now) => {
      const currentSky = skyRef.current;
      const width = starsCanvas.width / starsRatio;
      const height = starsCanvas.height / starsRatio;
      const nightStrength = clamp(currentSky.night);

      starsContext.setTransform(starsRatio, 0, 0, starsRatio, 0, 0);
      starsContext.clearRect(0, 0, width, height);
      if (nightStrength > 0.05) {
        const starLayerAlpha = clamp((nightStrength - 0.05) * 1.45);
        // Pure gradient Milky Way band (NO software ctx.filter="blur(10px)"!)
        if (nightStrength > 0.22) {
          starsContext.save();
          starsContext.globalAlpha = clamp((nightStrength - 0.22) * 1.15);
          starsContext.translate(width * 0.52, height * 0.31);
          starsContext.rotate(-0.42);
          const galaxyBand = starsContext.createLinearGradient(0, -height * 0.22, 0, height * 0.22);
          galaxyBand.addColorStop(0, "rgba(152,172,226,0)");
          galaxyBand.addColorStop(0.28, "rgba(157,179,230,.08)");
          galaxyBand.addColorStop(0.46, "rgba(220,214,244,.22)");
          galaxyBand.addColorStop(0.52, "rgba(255,239,219,.34)");
          galaxyBand.addColorStop(0.68, "rgba(191,166,224,.14)");
          galaxyBand.addColorStop(1, "rgba(121,151,215,0)");
          starsContext.fillStyle = galaxyBand;
          starsContext.fillRect(-width, -height * 0.22, width * 2, height * 0.44);
          starsContext.restore();

          starsContext.save();
          starsContext.globalAlpha = clamp((nightStrength - 0.26) * 1.3);
          for (const point of galaxyPoints) {
            starsContext.beginPath();
            starsContext.fillStyle = `rgba(232,227,255,${point.alpha})`;
            starsContext.arc(point.x * width, point.y * height, point.radius, 0, Math.PI * 2);
            starsContext.fill();
          }
          starsContext.restore();
        }

        // Video-style soft bokeh orbs at night
        starsContext.save();
        starsContext.globalAlpha = starLayerAlpha * 0.65;
        for (const orb of bokehPoints) {
          const cx = orb.x * width;
          const cy = orb.y * height;
          const pulse = 0.62 + Math.sin(now / 1900 + orb.phase) * 0.3;
          if (typeof starsContext.createRadialGradient === "function") {
            const grad = starsContext.createRadialGradient(cx, cy, 0, cx, cy, orb.radius * 2.2);
            grad.addColorStop(0, `rgba(255,250,236,${(pulse * 0.65).toFixed(3)})`);
            grad.addColorStop(0.45, `rgba(208,225,255,${(pulse * 0.22).toFixed(3)})`);
            grad.addColorStop(1, "rgba(208,225,255,0)");
            starsContext.fillStyle = grad;
          } else {
            starsContext.fillStyle = `rgba(255,250,236,${(pulse * 0.45).toFixed(3)})`;
          }
          starsContext.beginPath();
          starsContext.arc(cx, cy, orb.radius * 2.2, 0, Math.PI * 2);
          starsContext.fill();
        }
        starsContext.restore();

        // Crisp pinpoint stars (zero shadowBlur overhead)
        starsContext.save();
        starsContext.globalAlpha = starLayerAlpha;
        for (const point of starPoints) {
          const pulse = point.steady
            ? 0.65
            : 0.52 + Math.sin(now / point.speed + point.phase) * 0.34;
          const alpha = clamp(pulse) * (0.72 + nightStrength * 0.28);
          starsContext.beginPath();
          starsContext.fillStyle = `rgba(255,250,234,${alpha.toFixed(3)})`;
          starsContext.arc(point.x * width, point.y * height, point.radius, 0, Math.PI * 2);
          starsContext.fill();
        }
        starsContext.restore();
      }

      const cloudWidth = cloudCanvas.width / cloudRatio;
      const cloudHeight = cloudCanvas.height / cloudRatio;
      const cloudStrength = mode === "cloudy" || wetWeather ? 1 : 0;
      cloudContext.setTransform(cloudRatio, 0, 0, cloudRatio, 0, 0);
      cloudContext.clearRect(0, 0, cloudWidth, cloudHeight);
      if (cloudStrength) {
        const darkness = clamp((1 - currentSky.daylight) * 0.45 + (wetWeather ? 0.5 : 0));
        for (const cloud of cloudPoints) {
          const travel = (now * 0.0000032 * cloud.speed) % 1.4;
          const x = (((cloud.x + travel + 0.18) % 1.4) - 0.18) * cloudWidth;
          drawCloudShape(
            cloudContext,
            x,
            cloud.y * cloudHeight,
            Math.max(0.72, cloudWidth / 780) * cloud.scale,
            cloud.depth * (wetWeather ? 0.7 : 0.4),
            darkness,
          );
        }
      }

      const weatherWidth = weatherCanvas.width / cloudRatio;
      const weatherHeight = weatherCanvas.height / cloudRatio;
      weatherContext.setTransform(cloudRatio, 0, 0, cloudRatio, 0, 0);
      weatherContext.clearRect(0, 0, weatherWidth, weatherHeight);
      if (wetWeather) {
        weatherContext.lineCap = "round";
        weatherContext.strokeStyle = "rgba(230,244,255,.18)";
        for (const drop of rainDrops) {
          const y =
            ((drop.y + now * 0.00055 * drop.speed) % 1.18) * weatherHeight -
            weatherHeight * 0.1;
          const x = drop.x * weatherWidth + y * 0.035;
          weatherContext.lineWidth = 0.7 + drop.speed;
          weatherContext.beginPath();
          weatherContext.moveTo(x, y - drop.length);
          weatherContext.lineTo(x + 2.4, y + drop.length);
          weatherContext.stroke();
        }
        for (const drop of glassDrops) {
          weatherContext.beginPath();
          weatherContext.fillStyle = "rgba(236,247,255,.16)";
          weatherContext.ellipse(
            drop.x * weatherWidth,
            drop.y * weatherHeight + Math.sin(now / 1300 + drop.phase) * 0.8,
            drop.size * 0.72,
            drop.size,
            0.18,
            0,
            Math.PI * 2,
          );
          weatherContext.fill();
        }
        if (now > nextRippleAt) {
          ripples.push({
            x: weatherWidth * (0.08 + Math.random() * 0.84),
            y: weatherHeight * (0.16 + Math.random() * 0.72),
            born: now,
          });
          nextRippleAt = now + 260 + Math.random() * 520;
        }
      }
      ripples = ripples.filter((ripple) => now - ripple.born < 1450 && wetWeather);
      for (const ripple of ripples) {
        const progress = (now - ripple.born) / 1450;
        weatherContext.strokeStyle = `rgba(225,241,255,${(1 - progress) * 0.28})`;
        weatherContext.lineWidth = 1.2 - progress * 0.7;
        weatherContext.beginPath();
        weatherContext.ellipse(
          ripple.x,
          ripple.y,
          4 + progress * 34,
          (4 + progress * 34) * 0.38,
          0,
          0,
          Math.PI * 2,
        );
        weatherContext.stroke();
      }
      if (mode === "storm" && now > nextLightningAt) createLightning(now);
      if (mode === "storm" && now < lightningUntil) {
        const flash = clamp((lightningUntil - now) / 430);
        weatherContext.fillStyle = `rgba(216,229,255,${flash * 0.2})`;
        weatherContext.fillRect(0, 0, weatherWidth, weatherHeight);
        weatherContext.strokeStyle = `rgba(240,245,255,${0.72 + flash * 0.28})`;
        weatherContext.shadowColor = "rgba(164,197,255,.9)";
        weatherContext.shadowBlur = 18;
        weatherContext.lineWidth = 1.35;
        weatherContext.beginPath();
        for (const [x1, y1, x2, y2] of lightningSegments) {
          weatherContext.moveTo(x1, y1);
          weatherContext.lineTo(x2, y2);
        }
        weatherContext.stroke();
        weatherContext.shadowBlur = 0;
      }
    };

    resize();
    let resizeTimer = null;
    const weatherMotion = mode === "cloudy" || mode === "rain" || mode === "storm";
    const loop = createVisualLoop(paint, {
      animated: !compact || weatherMotion,
      reducedMotion: reduceMotion,
      interval: () => {
        if (document.documentElement.dataset.timeScrubbing === "true") return 33;
        if (document.querySelector(".settings-sheet, .message-list.is-scrolling")) return 180;
        if (document.querySelector('[data-chat-streaming="true"]')) return 100;
        if (compact) return 66;
        return 33;
      },
    });
    loopRef.current = loop;
    const handleResize = () => {
      clearTimeout(resizeTimer);
      // 键盘弹出会连续触发 resize；此时画布应保持全屏尺寸，避免背景被逐帧拉伸。
      resizeTimer = setTimeout(() => {
        resizeTimer = null;
        if (document.documentElement.dataset.keyboardOpen === "true") return;
        resize();
        loop.invalidate();
      }, 140);
    };
    window.addEventListener("resize", handleResize);
    return () => {
      clearTimeout(resizeTimer);
      loop.dispose();
      loopRef.current = null;
      window.removeEventListener("resize", handleResize);
    };
  }, [cloudsRef, mode, rainIntensity, starsRef, weatherRef, reduceMotion]);
}

function CelestialBackdrop({
  snapshot,
  weather = null,
  weatherModeOverride = null,
  backgroundMode = "auto",
}) {
  const starsRef = useRef(null);
  const cloudsRef = useRef(null);
  const weatherRef = useRef(null);
  const reduceMotion = useReducedVisualMotion();
  const lowPower = useMemo(() => {
    const nav = globalThis.navigator;
    return Boolean(
      nav?.connection?.saveData ||
      (Number(nav?.deviceMemory) || 8) <= 4,
    );
  }, []);
  const minute = Number.isFinite(snapshot.minute)
    ? snapshot.minute
    : snapshot.hour * 60;
  const sky = useMemo(() => getSunGlassSky(minute, snapshot), [minute, snapshot]);
  const lumen = useMemo(() => getLumenAtmosphere(sky), [sky]);
  const isLumen = backgroundMode === "lumen";
  const weatherMode = ["clear", "cloudy", "rain", "storm"].includes(
    weatherModeOverride,
  )
    ? weatherModeOverride
    : weatherModeFromAmbient(weather);
  const rainIntensity = weatherModeOverride
    ? weatherMode === "storm" ? 1.6 : 1
    : rainIntensityFromAmbient(weather);
  usePrototypeAtmosphere({
    starsRef,
    cloudsRef,
    weatherRef,
    sky,
    mode: weatherMode,
    rainIntensity,
    reduceMotion: reduceMotion || lowPower,
  });

  const style = Object.fromEntries([
    ...sky.colors.map((color, index) => [`--sky-${index + 1}`, color]),
    ...lumen.colors.map((color, index) => [`--lumen-sky-${index + 1}`, color]),
    ["--sun-x", `${sky.sunX}%`],
    ["--sun-y", `${sky.sunY}%`],
    ["--sun-opacity", sky.sunOpacity],
    ["--moon-x", `${sky.moonX}%`],
    ["--moon-y", `${sky.moonY}%`],
    ["--moon-opacity", sky.moonOpacity],
    ["--prototype-star-opacity", sky.night],
    ["--milky-opacity", sky.milkyOpacity],
    ["--horizon-opacity", sky.horizonOpacity],
    ["--sunset-opacity", sky.sunset],
    ["--day-aura-opacity", sky.dayAura],
    ["--sunrise-aura-opacity", sky.sunriseAura],
    ["--sunset-aura-opacity", sky.sunsetAura],
    ["--blue-aura-opacity", sky.blueAura],
    ["--solar-falloff-opacity", sky.falloffOpacity],
    ["--chromatic-opacity", sky.chromaticOpacity],
    ["--lumen-orb-x", `${lumen.orbX}%`],
    ["--lumen-orb-y", `${lumen.orbY}%`],
    ["--lumen-orb-scale", lumen.orbScale.toFixed(3)],
    ["--lumen-orb-opacity", isLumen ? lumen.orbOpacity : (lumen.orbOpacity * 0.42).toFixed(3)],
    ["--lumen-bokeh-opacity", isLumen ? lumen.bokehOpacity : (lumen.bokehOpacity * 0.5).toFixed(3)],
    ["--lumen-veil-opacity", isLumen ? lumen.veilOpacity : (lumen.veilOpacity * 0.35).toFixed(3)],
    ["--lumen-core", lumen.coreColor],
    ["--lumen-inner", lumen.innerColor],
    ["--lumen-mid", lumen.midColor],
    ["--lumen-horizon", lumen.horizonColor],
  ]);

  return (
    <div
      className={`celestial-backdrop celestial-prototype-sky${isLumen ? " is-lumen-sky" : ""}`}
      aria-hidden="true"
      data-weather={weatherMode}
      data-background-mode={backgroundMode}
      data-minute={Math.round(sky.minute)}
      data-solar-minute={Math.round(sky.solarMinute)}
      style={style}
    >
      {!isLumen && (
        <CoastVideoBackdrop sky={sky} weatherMode={weatherMode} reducedMotion={reduceMotion || lowPower} />
      )}
      <div className="celestial-lumen-veil" />
      <canvas className="celestial-stars-canvas" ref={starsRef} />
      <div className="celestial-lumen-bokeh" />
      <div className="celestial-milky-way" />
      <div className="celestial-chromatic-light" />
      <div className="celestial-sunset-glow" />
      <div className="celestial-solar-falloff" />
      <div className="celestial-lumen-orb" />
      <div className="celestial-aura celestial-aura-day" />
      <div className="celestial-aura celestial-aura-sunrise" />
      <div className="celestial-aura celestial-aura-sunset" />
      <div className="celestial-aura celestial-aura-blue" />
      <div className="celestial-sun" />
      <div className="celestial-moon" />
      <canvas className="celestial-weather-clouds" ref={cloudsRef} />
      <div className="celestial-horizon-glow" />
      <div className="celestial-glass-dome">
        <div className="celestial-glass-haze" />
        <canvas className="celestial-glass-weather" ref={weatherRef} />
        <div className="celestial-glass-sheen" />
      </div>
    </div>
  );
}

export default memo(CelestialBackdrop);
