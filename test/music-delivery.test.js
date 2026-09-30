import assert from "node:assert/strict";
import fs from "node:fs";
import { createMusicRequestScope } from "../src/music-request-scope.js";
import { createAiMusicConsumer } from "../src/ai-music-consumer.js";
import { launchExternalMusic, externalMusicFeedback } from "../src/music-external-launch.js";
import { openNeteasePlayback, playNeteaseSilent } from "../src/netease-playback.js";

const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };
let identity = { accountScope: "account-a", companionScope: "companion-a" };
const auth = { getSnapshot: () => ({ user: { id: identity.accountScope }, activeCompanionId: identity.companionScope }) };
const scope = createMusicRequestScope(auth); scope.bind(identity);
const store = new Map(), storage = { getItem: key => store.get(key), setItem: (key, value) => store.set(key, value) };
const notices = [], requests = [{ id: "11111111-1111-4111-8111-111111111111", song_id: "123", title: "Fictional song" }];
let opens = 0, reports = [], failReport = true;
const consumer = () => createAiMusicConsumer({ scope, storage, list: async options => { assert.equal(options.accountScope, identity.accountScope); return requests; }, open: async () => { opens++; return { opened: true }; }, report: async (id, result, options) => { reports.push({ id, result, options }); if (failReport) throw Object.assign(Error("Authorization: Bearer fictional-private-secret"), { code: "fixture_result_failed", status: 503 }); }, onFeedback: value => notices.push(value) });
let current = consumer(); await current.drain(); assert.equal(opens, 1); assert.equal(reports.length, 1); assert.match(notices.at(-1), /fixture_result_failed/); assert.doesNotMatch(notices.at(-1), /fictional-private/);
failReport = false; await current.drain(); assert.equal(opens, 1, "a lost result retries reporting without opening again");
current = consumer(); await current.drain(); assert.equal(opens, 1, "a scoped stored receipt survives recreation");
assert.ok([...store.values()].every(value => !value.includes("Fictional song") && !value.includes("fictional-private")), "journal stores technical ids and outcomes only");

const listing = deferred(); let listCalls = 0;
current = createAiMusicConsumer({ scope, list: () => { listCalls++; return listing.promise; }, report: async () => {}, open: async () => { opens++; }, onFeedback: value => notices.push(value) });
const first = current.drain(); await current.drain(); assert.equal(listCalls, 1, "polling cannot overlap");
identity = { accountScope: "account-b", companionScope: "companion-b" }; scope.bind(identity); listing.resolve(requests); await first; assert.equal(opens, 1, "old account pending requests cannot open after switch");
current = consumer(); await current.drain(); assert.equal(opens, 2, "another account does not share receipts");

const native = deferred(); let lateReports = 0;
current = createAiMusicConsumer({ scope, storage, list: async () => [{ id: "22222222-2222-4222-8222-222222222222", song_id: "234" }], report: async () => lateReports++, open: () => native.promise });
const opening = current.drain(); await new Promise(resolve => setTimeout(resolve, 0)); scope.invalidate(); native.resolve({ opened: true }); await opening; assert.equal(lateReports, 0, "late native result cannot write through a new identity");
scope.bind(identity); current = createAiMusicConsumer({ scope, storage, list: async () => [{ id: "22222222-2222-4222-8222-222222222222", song_id: "234" }], report: async () => lateReports++, open: async () => { throw Error("must not open twice"); } });
await current.drain(); assert.ok(lateReports > 0, "old native result resumes reporting in the original scope");
let nextOpened = 0;
current = createAiMusicConsumer({ scope, storage, list: async () => [requests[0], { id: "33333333-3333-4333-8333-333333333333", song_id: "345" }], report: async request => { if (request === requests[0].id) throw Object.assign(Error("replaced"), { code: "music_ai_request_superseded" }); }, open: async () => { nextOpened++; return { opened: true }; } });
await current.drain(); assert.equal(nextOpened, 1, "a terminal old result must not block the next song");

let metadata = 0;
const token = scope.begin("external");
const input = { scope, token, resourceType: "song", resourceId: "123", request: async () => metadata++ };
assert.deepEqual(await launchExternalMusic({ ...input, open: async () => ({ opened: false }) }), { opened: false }); assert.equal(metadata, 0, "cancelled native dialog must not confirm a launch");
await assert.rejects(launchExternalMusic({ ...input, open: async () => ({}) }), { code: "music_external_receipt_invalid" });
const opened = await launchExternalMusic({ ...input, open: async () => ({ opened: true }), request: async () => { throw Object.assign(Error("fixture server unavailable"), { code: "fixture_metadata_failed", status: 503 }); } });
assert.equal(opened.opened, true); assert.match(externalMusicFeedback(opened), /已交给网易云打开/); assert.match(externalMusicFeedback(opened), /fixture_metadata_failed/); assert.match(externalMusicFeedback(opened), /不会自动重复打开/);
scope.cancel(token); let staleOpens = 0; await assert.rejects(launchExternalMusic({ ...input, open: async () => staleOpens++ }), { code: "music_scope_changed" }); assert.equal(staleOpens, 0);

globalThis.window = { open: () => null };
await assert.rejects(openNeteasePlayback("song", "123"), { code: "music_popup_blocked" }); await assert.rejects(playNeteaseSilent("song", "123"), { code: "music_popup_blocked" });
const popup = { opener: {}, location: {}, close() {} }; window.open = () => popup;
assert.equal((await openNeteasePlayback("playlist", "123")).opened, true); assert.equal(popup.opener, null); assert.equal(popup.location.href, "https://music.163.com/#/playlist?id=123");
const app = fs.readFileSync(new URL("../src/App.jsx", import.meta.url), "utf8");
assert.doesNotMatch(app, /drainAiPlayRequests|nowPlayingPollRef/);
assert.match(app, /createAiMusicConsumer[\s\S]*consumer\.drain\(\)[\s\S]*consumer\.cancel\(\)/);
assert.match(app, /notificationAccess\.granted\]/, "notification recognition resumes after permission changes");
console.log("Music delivery: scoped polling, serial consumption, result-only retry/recovery, cancellation, truthful external receipts and blocked popup passed");
