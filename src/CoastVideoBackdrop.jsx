import { useEffect, useRef, useState } from "react";
import { COAST_VIDEO_SCENES, coastSceneForSky, createCoastVideoLifecycle } from "./coast-video-lifecycle.js";
import "./coast-video-backdrop.css";

const preloadedPosters = new Set();

function preloadCoastPosters() {
  if (typeof globalThis.Image !== "function") return;
  for (const scene of Object.values(COAST_VIDEO_SCENES)) {
    if (!scene?.poster || preloadedPosters.has(scene.poster)) continue;
    preloadedPosters.add(scene.poster);
    const img = new globalThis.Image();
    img.decoding = "async";
    img.src = scene.poster;
  }
}

function isTimeScrubbingNow() {
  return globalThis.document?.documentElement?.dataset?.timeScrubbing === "true";
}

export default function CoastVideoBackdrop({ sky, weatherMode = "clear", reducedMotion = false }) {
  const requestedScene = coastSceneForSky(sky);
  const [settledScene, setSettledScene] = useState(requestedScene);
  const videoRef = useRef(null);
  const layerRef = useRef(null);

  // Preload all 3 coastline still posters once so cross-phase poster swaps never blank/flicker.
  useEffect(() => {
    preloadCoastPosters();
  }, []);

  // Defer <video> decoder swaps ONLY while actively dragging the time scrubber to prevent
  // rapid video.load() teardown flashes; normal prop updates switch immediately.
  useEffect(() => {
    if (!isTimeScrubbingNow()) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- sync immediately when not scrubbing
      setSettledScene(requestedScene);
      return undefined;
    }
    const root = globalThis.document?.documentElement;
    let settled = false;
    let timer = null;
    const commit = () => {
      if (settled) return;
      settled = true;
      setSettledScene(requestedScene);
    };
    timer = setTimeout(() => {
      if (!isTimeScrubbingNow()) commit();
    }, 180);
    let observer = null;
    if (root && typeof globalThis.MutationObserver === "function") {
      observer = new globalThis.MutationObserver(() => {
        if (!isTimeScrubbingNow()) commit();
      });
      observer.observe(root, { attributes: true, attributeFilter: ["data-time-scrubbing"] });
    }
    return () => {
      settled = true;
      clearTimeout(timer);
      observer?.disconnect();
    };
  }, [requestedScene]);

  const scene = isTimeScrubbingNow() ? settledScene : requestedScene;
  const [playback, setPlayback] = useState({ scene, posterScene: scene, state: "static" });
  const asset = COAST_VIDEO_SCENES[scene];
  const poster = COAST_VIDEO_SCENES[playback.posterScene];
  const state = playback.scene === scene ? playback.state : "static";

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return undefined;
    // The phone layout deliberately hides the looping coastline video and keeps
    // the poster. Do not decode the hidden clip: display:none does not pause a
    // playing <video>, and it dominated idle CPU/battery on the real device.
    if (globalThis.matchMedia?.("(max-width: 820px)")?.matches === true) {
      video.pause();
      video.removeAttribute("src");
      video.load();
      // eslint-disable-next-line react-hooks/set-state-in-effect -- poster fallback owns playback state
      setPlayback(current => ({ ...current, state: "static", posterScene: scene }));
      return undefined;
    }
    let disposed = false;
    let posterTimer = null;
    const lifecycle = createCoastVideoLifecycle(video, {
      source: asset.video,
      reducedMotion,
      applicationRoot: layerRef.current?.closest(".app-shell"),
      onState: next => {
        clearTimeout(posterTimer);
        setPlayback(current => ({
          scene,
          state: next,
          // Keep the previous still under the new clip during its initial fade.
          posterScene: next === "loading" || next === "playing" ? current.posterScene : scene,
        }));
        if (next === "playing") {
          posterTimer = setTimeout(() => {
            if (!disposed) setPlayback(current => current.scene === scene && current.state === "playing" ? { ...current, posterScene: scene } : current);
          }, 950);
        }
      },
    });
    return () => { disposed = true; clearTimeout(posterTimer); lifecycle.dispose(); };
  }, [asset.video, reducedMotion, scene]);

  return (
    <div ref={layerRef} className="coast-video-backdrop" data-scene={scene} data-playback={state} data-weather={weatherMode} aria-hidden="true">
      <img className="coast-video-poster" src={poster.poster} alt="" decoding="async" />
      <video ref={videoRef} className="coast-video-loop" muted loop playsInline preload="none" tabIndex={-1} disablePictureInPicture onTransitionEnd={event => {
        if (event.propertyName === "opacity") setPlayback(current => current.scene === scene && current.state === "playing" ? { ...current, posterScene: scene } : current);
      }} />
      <div className="coast-video-weather-shade" />
    </div>
  );
}
