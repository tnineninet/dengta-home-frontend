import { Capacitor } from "@capacitor/core";
import { LocalNotifications } from "@capacitor/local-notifications";
import { apiRequest } from "./api";

export const DEFAULT_CHRONOS_TIMEZONE = "Asia/Shanghai";

export const DEFAULT_CHRONOS_POLICY = Object.freeze({
  enabled: true,
  timezone: DEFAULT_CHRONOS_TIMEZONE,
  quiet_hours_enabled: true,
  weekday_quiet_start: "23:30",
  weekday_quiet_end: "07:30",
  weekend_quiet_start: "01:00",
  weekend_quiet_end: "09:30",
  allow_explicit_alarms_in_quiet_hours: true,
  min_cooldown_minutes: 60,
  silence_wake_enabled: true,
  silence_wake_hours: 6,
  morning_ritual_enabled: false,
  morning_ritual_time: "08:00",
  evening_ritual_enabled: false,
  evening_ritual_time: "22:30",
  missed_grace_minutes: 45,
});

export const COMMON_TIMEZONES = Object.freeze([
  { value: "Asia/Shanghai", label: "中国标准时间 (Asia/Shanghai · UTC+8)" },
  { value: "Asia/Hong_Kong", label: "中国香港 (Asia/Hong_Kong · UTC+8)" },
  { value: "Asia/Taipei", label: "中国台北 (Asia/Taipei · UTC+8)" },
  { value: "Asia/Tokyo", label: "东京 (Asia/Tokyo · UTC+9)" },
  { value: "Asia/Seoul", label: "首尔 (Asia/Seoul · UTC+9)" },
  { value: "Asia/Singapore", label: "新加坡 (Asia/Singapore · UTC+8)" },
  { value: "Australia/Sydney", label: "悉尼 (Australia/Sydney)" },
  { value: "Europe/London", label: "伦敦 (Europe/London)" },
  { value: "Europe/Paris", label: "巴黎 / 柏林 (Europe/Paris)" },
  { value: "America/New_York", label: "纽约 (America/New_York)" },
  { value: "America/Los_Angeles", label: "洛杉矶 (America/Los_Angeles)" },
  { value: "Pacific/Auckland", label: "奥克兰 (Pacific/Auckland)" },
]);

const WEEKDAY_ZH = {
  Sun: "星期日",
  Mon: "星期一",
  Tue: "星期二",
  Wed: "星期三",
  Thu: "星期四",
  Fri: "星期五",
  Sat: "星期六",
};

const NATIVE_CHRONOS_ID_BASE = 81000;
const NATIVE_CHRONOS_MAX = 24;

export function detectBrowserTimeZone() {
  try {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (tz && typeof tz === "string") {
      new Intl.DateTimeFormat("en-CA", { timeZone: tz }).format(new Date(0));
      return tz;
    }
  } catch {
    // Fall back safely when runtime Intl timezone is unavailable.
  }
  return DEFAULT_CHRONOS_TIMEZONE;
}

export function getTimePeriodZh(hourDecimal) {
  if (hourDecimal < 5) return "凌晨";
  if (hourDecimal < 7) return "清晨";
  if (hourDecimal < 9) return "早上";
  if (hourDecimal < 11.5) return "上午";
  if (hourDecimal < 13.5) return "午间";
  if (hourDecimal < 17.5) return "下午";
  if (hourDecimal < 19.5) return "傍晚";
  if (hourDecimal < 23) return "晚上";
  return "深夜";
}

function pad2(n) {
  return String(Math.max(0, Math.floor(Number(n) || 0))).padStart(2, "0");
}

export function formatLocalClock(dateInput = new Date(), timezone = DEFAULT_CHRONOS_TIMEZONE) {
  let safeTz = String(timezone || DEFAULT_CHRONOS_TIMEZONE).trim() || DEFAULT_CHRONOS_TIMEZONE;
  try {
    new Intl.DateTimeFormat("en-CA", { timeZone: safeTz }).format(new Date(0));
  } catch {
    safeTz = DEFAULT_CHRONOS_TIMEZONE;
  }
  const instant = dateInput instanceof Date ? dateInput : new Date(dateInput);
  const valid = Number.isNaN(instant.getTime()) ? new Date() : instant;
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", {
      timeZone: safeTz,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      weekday: "short",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
    })
      .formatToParts(valid)
      .filter((p) => p.type !== "literal")
      .map((p) => [p.type, p.value]),
  );
  const hour = Number(parts.hour);
  const minute = Number(parts.minute);
  const second = Number(parts.second);
  const representedUtcMs = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    hour,
    minute,
    second,
  );
  const offsetMin = Math.round((representedUtcMs - valid.getTime()) / 60000);
  const sign = offsetMin >= 0 ? "+" : "-";
  const absOffset = Math.abs(offsetMin);
  return {
    timezone: safeTz,
    date: `${parts.year}-${parts.month}-${parts.day}`,
    hhmm: `${parts.hour}:${parts.minute}`,
    hhmmss: `${parts.hour}:${parts.minute}:${parts.second}`,
    weekdayName: WEEKDAY_ZH[parts.weekday] || "今天",
    periodName: getTimePeriodZh(hour + minute / 60),
    utcOffset: `UTC${sign}${pad2(Math.floor(absOffset / 60))}:${pad2(absOffset % 60)}`,
  };
}

export function formatCountdown(ms) {
  if (!Number.isFinite(ms) || ms <= 0) return "即将触发";
  const totalSec = Math.floor(ms / 1000);
  if (totalSec < 60) return `${totalSec} 秒`;
  const totalMin = Math.floor(totalSec / 60);
  const remSec = totalSec % 60;
  if (totalMin < 60) return remSec > 0 ? `${totalMin} 分 ${remSec} 秒` : `${totalMin} 分钟`;
  const hours = Math.floor(totalMin / 60);
  const remMin = totalMin % 60;
  if (hours < 24) return remMin > 0 ? `${hours} 小时 ${remMin} 分` : `${hours} 小时`;
  const days = Math.floor(hours / 24);
  const remHours = hours % 24;
  return remHours > 0 ? `${days} 天 ${remHours} 小时` : `${days} 天`;
}

export function kindLabelZh(kind) {
  const map = {
    one_shot: "一次性",
    daily: "每天",
    weekdays: "工作日",
    weekends: "周末",
  };
  return map[kind] || "定时";
}

export function buildPreviewChronosState(timezone = DEFAULT_CHRONOS_TIMEZONE) {
  const now = new Date();
  const in25m = new Date(now.getTime() + 25 * 60_000).toISOString();
  const in9h = new Date(now.getTime() + 9 * 3600_000).toISOString();
  const clock = formatLocalClock(now, timezone);
  const next1Clock = formatLocalClock(new Date(in25m), timezone);
  const next2Clock = formatLocalClock(new Date(in9h), timezone);
  return {
    ok: true,
    preview: true,
    server_now: now.toISOString(),
    clock: { ...clock, currentTime: `${clock.date} ${clock.hhmm}`, currentTimeSeconds: `${clock.date} ${clock.hhmmss}` },
    policy: {
      ...DEFAULT_CHRONOS_POLICY,
      timezone: clock.timezone,
      morning_ritual_enabled: true,
      morning_ritual_time: "07:30",
      evening_ritual_enabled: true,
      evening_ritual_time: "22:30",
    },
    schedules: [
      {
        id: "preview-water",
        title: "喝水伸懒腰提醒",
        prompt_hint: "提醒用户喝杯温水、放松肩颈",
        kind: "one_shot",
        time_hhmm: null,
        fire_at: in25m,
        next_fire_at: in25m,
        enabled: true,
        bypass_quiet_hours: true,
        created_by: "ai_tool",
        last_status: "scheduled",
      },
      {
        id: "ritual-morning",
        title: "早安叫醒仪式",
        prompt_hint: "按个性化指令风格自然叫醒开启今天",
        kind: "daily",
        time_hhmm: "07:30",
        next_fire_at: in9h,
        enabled: true,
        bypass_quiet_hours: true,
        created_by: "ritual",
        last_status: "scheduled",
      },
    ],
    summary: {
      enabled: true,
      timezone: clock.timezone,
      in_quiet_hours: false,
      quiet_window_label: "工作日 23:30–07:30",
      quiet_ends_at: null,
      quiet_minutes_remaining: 0,
      next_schedule: {
        id: "preview-water",
        title: "喝水伸懒腰提醒",
        next_fire_at: in25m,
        next_fire_local: `${next1Clock.date} ${next1Clock.hhmm}`,
        countdown_ms: 25 * 60_000,
        countdown_label: "25 分钟",
      },
      upcoming_schedules: [
        {
          id: "preview-water",
          title: "喝水伸懒腰提醒",
          next_fire_at: in25m,
          next_fire_local: `${next1Clock.date} ${next1Clock.hhmm}`,
          countdown_ms: 25 * 60_000,
          countdown_label: "25 分钟",
        },
        {
          id: "ritual-morning",
          title: "早安叫醒仪式",
          next_fire_at: in9h,
          next_fire_local: `${next2Clock.date} ${next2Clock.hhmm}`,
          countdown_ms: 9 * 3600_000,
          countdown_label: "9 小时",
        },
      ],
    },
    recent_runs: [
      {
        at: new Date(now.getTime() - 45 * 60_000).toISOString(),
        kind: "schedule_fired",
        title: "午休结束轻唤",
        status: "fired",
        message_preview: "到点啦，慢慢醒醒神，下午也要顺利呀。",
      },
    ],
  };
}

export function getChronosState() {
  return apiRequest("/api/v2/chronos/state");
}

export function updateChronosPolicy(patch) {
  return apiRequest("/api/v2/chronos/policy", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(patch || {}),
  });
}

export function createChronosSchedule(input) {
  return apiRequest("/api/v2/chronos/schedules", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input || {}),
  });
}

export function updateChronosSchedule(id, patch) {
  return apiRequest(`/api/v2/chronos/schedules/${encodeURIComponent(id)}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(patch || {}),
  });
}

export function deleteChronosSchedule(id) {
  return apiRequest(`/api/v2/chronos/schedules/${encodeURIComponent(id)}`, {
    method: "DELETE",
  });
}

export function triggerChronosHeartbeat(options = {}) {
  return apiRequest("/api/v2/chronos/heartbeat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(options || {}),
  });
}

/**
 * Arm OS-level local notifications on Capacitor (Android/iOS) for exact upcoming
 * Chronos wake alarms within 48 hours, guaranteeing wake delivery even if the
 * WebView is suspended by Android Doze.
 */
export async function syncNativeLocalWakeNotifications(
  schedules = [],
  { aiName = "小小灯", channelId = "dengta-home-reminders-v2" } = {},
) {
  if (!Capacitor?.isPluginAvailable?.("LocalNotifications")) return { synced: 0 };
  try {
    const cancelIds = Array.from({ length: NATIVE_CHRONOS_MAX }, (_, idx) => ({
      id: NATIVE_CHRONOS_ID_BASE + idx,
    }));
    await LocalNotifications.cancel({ notifications: cancelIds }).catch(() => {});

    const nowMs = Date.now();
    const horizonMs = nowMs + 48 * 3600_000;
    const upcoming = (Array.isArray(schedules) ? schedules : [])
      .filter((s) => {
        if (!s?.enabled || !s?.next_fire_at) return false;
        const ts = Date.parse(s.next_fire_at);
        return Number.isFinite(ts) && ts > nowMs + 10_000 && ts <= horizonMs;
      })
      .sort((a, b) => Date.parse(a.next_fire_at) - Date.parse(b.next_fire_at))
      .slice(0, NATIVE_CHRONOS_MAX);

    if (!upcoming.length) return { synced: 0 };

    await LocalNotifications.schedule({
      notifications: upcoming.map((item, idx) => ({
        id: NATIVE_CHRONOS_ID_BASE + idx,
        title: `${aiName || "小小灯"} · ${item.title || "定时唤醒"}`,
        body: item.prompt_hint || `约定的时间到了：${item.title || "定时唤醒"}`,
        schedule: { at: new Date(Date.parse(item.next_fire_at)), allowWhileIdle: true },
        smallIcon: "ic_launcher",
        channelId,
      })),
    });
    return { synced: upcoming.length };
  } catch {
    return { synced: 0 };
  }
}
