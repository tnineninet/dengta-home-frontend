import { Capacitor, registerPlugin } from "@capacitor/core";

const DeviceTts = registerPlugin("DeviceTts");

function nativeAndroid() {
  try {
    return Capacitor.isNativePlatform() && Capacitor.getPlatform() === "android";
  } catch {
    return false;
  }
}

export function deviceTtsSupported() {
  return nativeAndroid();
}

export async function isDeviceTtsAvailable() {
  if (!nativeAndroid()) return false;
  try {
    const result = await DeviceTts.isAvailable();
    return result?.available === true;
  } catch {
    return false;
  }
}

export async function speakDeviceText(value) {
  if (!nativeAndroid()) throw new Error("设备语音只在 Android App 中可用");
  const text = Array.from(String(value || "").trim()).slice(0, 2000).join("");
  if (!text) throw new Error("没有可朗读的内容");
  await DeviceTts.speak({ text });
  return { provider: "android-tts", chars: text.length };
}

export async function stopDeviceText() {
  if (!nativeAndroid()) return;
  try {
    await DeviceTts.stop();
  } catch {
    // A destroyed engine must not block navigation/UI state.
  }
}
