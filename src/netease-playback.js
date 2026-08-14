import { Capacitor, registerPlugin } from "@capacitor/core";

const NeteasePlayback = registerPlugin("NeteasePlayback");
const RESOURCE_TYPES = new Set(["song", "playlist"]);
const RESOURCE_ID = /^\d{1,20}$/;

export function validateNeteaseResource(resourceType, resourceId) {
  const type = String(resourceType || "");
  const id = String(resourceId || "");
  if (!RESOURCE_TYPES.has(type) || !RESOURCE_ID.test(id)) throw new Error("网易云资源标识无效，无法打开。");
  return Object.freeze({ resourceType: type, resourceId: id });
}

export async function openNeteasePlayback(resourceType, resourceId) {
  const resource = validateNeteaseResource(resourceType, resourceId);
  if (Capacitor.isNativePlatform()) return NeteasePlayback.open(resource);
  const path = resource.resourceType === "song" ? "song" : "playlist";
  const url = `https://music.163.com/#/${path}?id=${resource.resourceId}`;
  window.open(url, "_blank", "noopener,noreferrer");
  return { opened: true, target: "web" };
}
