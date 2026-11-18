import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { COAST_VIDEO_SCENES, coastSceneForSky, createCoastVideoLifecycle } from "./coast-video-lifecycle.js";
import "./coast-video-backdrop.css";

const phoneLayout = () => globalThis.window?.matchMedia?.("(max-width: 820px)");
const isPhone = () => phoneLayout()?.matches === true;
function watchPhone(onChange) {
  const query = phoneLayout();
  query?.addEventListener?.("change", onChange);
  return () => query?.removeEventListener?.("change", onChange);
}

export default function CoastVideoBackdrop({ sky, weatherMode = "clear", reducedMotion = false }) {
  const scene = coastSceneForSky(sky);
  const videoRef = useRef(null);
  const layerRef = useRef(null);
  const [playback, setPlayback] = useState({ scene, posterScene: scene, state: "static" });
  const asset = COAST_VIDEO_SCENES[scene];
  const poster = COAST_VIDEO_SCENES[playback.posterScene];
  const state = playback.scene === scene ? playback.state : "static";
  const compact = useSyncExternalStore(watchPhone, isPhone, () => false);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return undefined;
    // The phone layout deliberately hides the looping coastline video and keeps
    // the poster. Do not decode the hidden clip: display:none does not pause a
    // playing <video>, and it dominated idle CPU/battery on the real device.
    if (compact) {
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
  }, [asset.video, reducedMotion, scene, compact]);

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
