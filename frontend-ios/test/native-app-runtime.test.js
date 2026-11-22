import test from "node:test";
import assert from "node:assert/strict";
import { classifyNativeAppUrl, parseNativeAuthCallback, markNativePlatform, installNativeDeepLinks } from "../src/native-app-runtime.js";
import { resolveEmailRedirectUrl } from "../src/auth-redirect.js";

const callback = "dengta://auth#access_token=fictional-access&refresh_token=fictional-refresh";
const settle = async () => { for (let i = 0; i < 30; i++) await Promise.resolve(); };
test("native callback accepts the registered destination and recovery metadata", () => {
  assert.deepEqual(parseNativeAuthCallback(callback), { accessToken: "fictional-access", refreshToken: "fictional-refresh", recovery: false });
  assert.equal(parseNativeAuthCallback(callback.replace("auth#", "auth/#") + "&type=recovery&token_type=bearer&expires_in=3600").recovery, true);
});

for (const url of [
  callback.replace("dengta:", "https:"), callback.replace("auth#", "auth.evil#"), callback.replace("auth#", "auth/extra#"),
  callback.replace("auth#", "user@auth#"), callback.replace("auth#", "auth:123#"), callback.replace("auth#", "auth?x=1#"),
  callback + "&access_token=duplicate", callback + "&type=unknown", callback + "&expires_in=-1", callback + "&unexpected=value",
  "dengta://auth#access_token=one", "dengta://auth#access_token=&refresh_token=two", callback.replace("fictional-access", "%0Aprivate"),
]) test("malformed callback is rejected without a session mutation: " + url.split("#")[0], () => {
  assert.equal(parseNativeAuthCallback(url), null);
  assert.equal(classifyNativeAppUrl(url), null);
});

test("room links use exact destinations and official HTTPS origins", () => {
  for (const url of ["dengta://room/join?code=ABCDEF", "https://www.dengtahome.com/room/join?code=ABCDEF"]) assert.equal(classifyNativeAppUrl(url), "room");
  for (const url of ["https://evil.example/room/join", "https://www.dengtahome.com.evil/room/join", "dengta://room/joins", "https://www.dengtahome.com/other?room_code=ABCDEF"]) assert.equal(classifyNativeAppUrl(url), null);
});

test("iOS native redirect wins over HTTPS override while Android/Web precedence stays intact", () => {
  const configuredUrl = "https://configured.example/callback/";
  assert.equal(resolveEmailRedirectUrl({ nativePlatform: true, platform: "ios", configuredUrl }), "dengta://auth");
  assert.equal(resolveEmailRedirectUrl({ nativePlatform: true, platform: "android", configuredUrl }), configuredUrl);
  assert.equal(resolveEmailRedirectUrl({ nativePlatform: false, platform: "web", configuredUrl }), configuredUrl);
});

test("platform marker distinguishes native iOS, Android and Web", () => {
  for (const platform of ["ios", "android", "web"]) {
    const documentObject = { documentElement: { dataset: {} } };
    assert.equal(markNativePlatform({ isNativePlatform: () => platform !== "web", getPlatform: () => platform }, documentObject), platform);
    assert.equal(documentObject.documentElement.dataset.nativePlatform, platform);
  }
});

test("cold/hot delivery overlap executes once and disposal removes the listener", async () => {
  let listener, calls = 0, removed = 0;
  const stop = installNativeDeepLinks({ app: {
    async addListener(_event, callback) { listener = callback; return { remove: async () => { removed++; } }; },
    async getLaunchUrl() { listener({ url: callback }); return { url: callback }; },
  }, onAuthUrl: async () => { calls++; return { ok: true }; } });
  await settle(); assert.equal(calls, 1); stop(); await settle(); assert.equal(removed, 1);
  listener({ url: callback }); await settle(); assert.equal(calls, 1);
});

test("failed auth dispatch may be retried and arbitrary destinations never dispatch", async () => {
  let listener, calls = 0;
  const stop = installNativeDeepLinks({ app: {
    async addListener(_event, callback) { listener = callback; return { remove: async () => {} }; },
    async getLaunchUrl() { return {}; },
  }, onAuthUrl: async () => { calls++; if (calls === 1) throw new Error("fictional-failure"); return { ok: true }; } });
  await settle(); listener({ url: callback }); await settle(); listener({ url: callback }); await settle();
  listener({ url: "https://evil.example/room/join" }); await settle(); assert.equal(calls, 2); stop();
});

test("disposal during asynchronous listener registration removes the late handle", async () => {
  let resolve, removed = 0, launches = 0;
  const registration = new Promise(done => { resolve = done; });
  const stop = installNativeDeepLinks({ app: { addListener: () => registration, getLaunchUrl: async () => { launches++; return {}; } } });
  stop(); resolve({ remove: async () => { removed++; } }); await settle();
  assert.equal(removed, 1); assert.equal(launches, 0);
});
