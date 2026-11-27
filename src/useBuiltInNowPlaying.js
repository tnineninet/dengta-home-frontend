import { useEffect, useLayoutEffect, useMemo, useRef } from "react";
import { apiRequest } from "./api.js";
import { authSession } from "./auth-session.js";
import { coWatchRequestOptions } from "./co-watch-request-scope.js";
import { createBuiltInNowPlaying, shouldYieldStartupToExternal } from "./built-in-now-playing.js";

export function useBuiltInNowPlaying({ scope, accountScope, companionScope, enabled, externalAvailable, readExternal, onSong, onBusy, onFeedback, onStartupFeedback }) {
  const callbacks = useRef({});
  const player = useRef(null);
  const lastSongRef = useRef(null);
  useLayoutEffect(() => { callbacks.current = { onSong, onBusy, onFeedback, onStartupFeedback, externalAvailable, readExternal }; });
  useLayoutEffect(() => {
    const instance = createBuiltInNowPlaying({
      scope,
      request: (path, options) => apiRequest(path, { ...options, retry: false, ...coWatchRequestOptions(options, authSession) }),
      onSong: song => { lastSongRef.current = song; callbacks.current.onSong(song); }, onBusy: value => callbacks.current.onBusy(value),
      onFeedback: message => callbacks.current.onFeedback(message), onStartupFeedback: value => callbacks.current.onStartupFeedback(value),
    });
    player.current = instance;
    return () => { instance.dispose(); if (player.current === instance) player.current = null; };
  }, [scope, accountScope, companionScope]);
  useEffect(() => {
    if (!enabled) return;
    let active = true;
    let retryTimer = null;
    let startRetries = 2;
    const instance = player.current;
    let randomEnabled = false;
    try { randomEnabled = window.localStorage.getItem(`dengta_random_play_enabled:${accountScope || "guest"}`) === "1" || window.localStorage.getItem("dengta_random_play_enabled") === "1"; } catch { /* Storage may be unavailable. */ }
    if (!randomEnabled) return;
    const attemptStart = async (remaining) => {
      if (!active) return;
      // Auth/scope can finish binding after the first cold-start effect. A
      // captured token from then would be stale, so capture fresh and retry
      // briefly instead of silently dropping autoplay for this launch.
      const token = scope.capture();
      if (!token || !scope.current(token)) {
        if (remaining > 0) retryTimer = window.setTimeout(() => { void attemptStart(remaining - 1); }, 800);
        return;
      }
      if (callbacks.current.externalAvailable()) {
        const song = await callbacks.current.readExternal().catch(() => null);
        if (!active || !scope.current(token) || shouldYieldStartupToExternal(song)) return;
      }
      await instance?.start();
      if (!active) return;
      if (lastSongRef.current?.source === "dengta") return;
      if (startRetries > 0) {
        startRetries--;
        retryTimer = window.setTimeout(() => { void attemptStart(0); }, 3000);
      }
    };
    const timer = window.setTimeout(() => { void attemptStart(6); }, 2500);
    return () => {
      active = false;
      window.clearTimeout(timer);
      if (retryTimer) window.clearTimeout(retryTimer);
    };
  }, [scope, accountScope, companionScope, enabled]);
  return useMemo(() => ({
    control: (action, song) => player.current?.control(action, song),
    start: options => player.current?.start(options),
    yieldToExternal: () => player.current?.yieldToExternal(),
    onLocalPlaybackChange: event => player.current?.localPlaybackChanged(event),
  }), []);
}

export function useLocalPlaybackHandoff({ accountScope, companionScope, generation, onLocalPlaybackChange }) {
  const callback = useRef(onLocalPlaybackChange), lifetime = useRef(null);
  useLayoutEffect(() => { callback.current = onLocalPlaybackChange; });
  useLayoutEffect(() => {
    const value = { accountScope, companionScope, owner: null, phase: null };
    lifetime.current = value;
    return () => {
      if (value.owner) callback.current?.({ ...value, phase: "released" });
      if (lifetime.current === value) lifetime.current = null;
    };
  }, [accountScope, companionScope, generation]);
  return useMemo(() => (phase, expectedOwner) => {
    const value = lifetime.current;
    if (!value || (expectedOwner && value.owner !== expectedOwner)) return null;
    if (!value.owner && ["pending", "playing"].includes(phase)) value.owner = {};
    if (!value.owner) return null;
    const owner = value.owner;
    value.phase = phase;
    callback.current?.({ accountScope: value.accountScope, companionScope: value.companionScope, owner, phase });
    if (!["pending", "playing"].includes(phase)) value.owner = null;
    return owner;
  }, []);
}
