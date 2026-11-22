"use strict";

const express = require("express");
const { randomUUID } = require("node:crypto");
const { requireRequestScope } = require("./request-scope");

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const TABLE = Object.freeze({ letters: "surprise_map_letters", claims: "surprise_map_claims", publications: "surprise_map_publications" });
const PUBLIC_COLUMNS = "id,public_title,public_text,public_place,author_alias,source,public_latitude,public_longitude,claim_radius_m,created_at,state";
// 公开署名只用于区分"是谁留下的一点温柔"，不含账号或伴侣标识。
const ALIAS_OPENERS = ["安静的", "晚风的", "远路的", "拾光的", "海边的", "慢走的", "写信的", "路过的", "星光下的", "清晨的"];
const ALIAS_NAMES = ["旅人", "信使", "灯塔", "拾贝人", "邮差", "散步者", "赶路人", "看海的人"];
function authorAlias(userId, companionId) {
    // 同一账号+伴侣的公开信使用同一个笔名：可以按"作者"归类，但无法反推出账号或伴侣 ID。
    let hash = 2166136261;
    for (const character of String(userId || "") + "\u0000" + String(companionId || "")) hash = Math.imul(hash ^ character.charCodeAt(0), 16777619) >>> 0;
    return ALIAS_OPENERS[hash % ALIAS_OPENERS.length] + ALIAS_NAMES[(hash >>> 8) % ALIAS_NAMES.length];
}
const messages = Object.freeze({
    surprise_map_invalid_request: "藏宝地图参数无效，请检查必填内容和长度。",
    surprise_map_viewport_invalid: "地图范围无效，请使用西、南、东、北四个边界（最多两位小数）后重试。",
    surprise_map_request_conflict: "这次留信请求已用于另一份内容，请刷新核对后重新开始。",
    surprise_map_not_found: "没有找到这封来信，可能已撤回或不属于当前空间。",
    surprise_map_location_invalid: "请手动获取本次位置后再试，坐标必须有效。",
    surprise_map_location_stale: "本次位置已过期，请重新点击定位。",
    surprise_map_location_inaccurate: "本次定位误差过大，请到开阔处重新定位。",
    surprise_map_out_of_range: "还没有走进信件范围，请靠近后重新定位领取。",
    surprise_map_publication_confirmation_required: "请单独确认公开文案和公共地点后再发布。",
    surprise_map_publication_exists: "这封信已有公开版本；撤回后请创建一封新信再发布。",
    surprise_map_schema_required: "藏宝地图等待服务器数据库更新，内容尚未保存。",
    surprise_map_storage_unavailable: "藏宝地图暂时无法保存或读取，请稍后重试。",
    surprise_map_draft_unavailable: "当前尚未接入账号模型的写信功能，可以先手动写信。",
    surprise_map_draft_failed: "这次没有收到有效的写信结果，请重试或手动写信。",
    surprise_map_public_unavailable: "公共藏宝地图尚未配置，可以使用私人来信。"
});
function fault(status, code) { return Object.assign(new Error(messages[code] || "藏宝地图请求未完成。"), { status, code }); }
function input(value, allowed) {
    if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).some(key => !allowed.includes(key))) throw fault(400, "surprise_map_invalid_request");
    return value;
}
function text(value, maximum, optional = false) {
    if (optional && value === undefined) return "";
    if (typeof value !== "string" || !value.trim() || value.length > maximum) throw fault(400, "surprise_map_invalid_request");
    return value;
}
function coordinate(value, maximum) {
    if (typeof value !== "number" || !Number.isFinite(value) || Math.abs(value) > maximum) throw fault(400, "surprise_map_location_invalid");
    return value;
}
function distanceMeters(a, b) {
    const rad = Math.PI / 180, lat = (b.latitude - a.latitude) * rad, lon = (b.longitude - a.longitude) * rad;
    const h = Math.sin(lat / 2) ** 2 + Math.cos(a.latitude * rad) * Math.cos(b.latitude * rad) * Math.sin(lon / 2) ** 2;
    return 12742000 * Math.asin(Math.sqrt(Math.min(1, Math.max(0, h))));
}
function verifyPosition(value, target, now) {
    input(value, ["latitude", "longitude", "accuracy", "captured_at"]);
    const latitude = coordinate(value.latitude, 90), longitude = coordinate(value.longitude, 180);
    if (typeof value.accuracy !== "number" || !Number.isFinite(value.accuracy) || value.accuracy < 0 || value.accuracy > 100) throw fault(400, "surprise_map_location_inaccurate");
    const captured = typeof value.captured_at === "string" ? Date.parse(value.captured_at) : NaN;
    if (!Number.isFinite(captured) || now - captured > 120000 || captured - now > 30000) throw fault(400, "surprise_map_location_stale");
    if (distanceMeters({ latitude, longitude }, target) + value.accuracy > target.radius_m) throw fault(409, "surprise_map_out_of_range");
}
async function result(query) {
    const response = await query;
    if (response?.error) throw response.error;
    return response?.data;
}
function privateCard(row, claim, publication) {
    return { id: row.id, title: row.title, hint: row.hint, place_label: row.hint, state: claim ? "opened" : "sealed", claimed: Boolean(claim),
        area: { latitude: row.area_latitude, longitude: row.area_longitude, radius_m: row.area_radius_m }, created_at: row.created_at,
        ...(claim ? { body: row.body, claimed_at: claim.claimed_at } : {}),
        ...(publication ? { publication: { id: publication.id, state: publication.state } } : {}) };
}
function publicCard(row, claim) {
    return { id: row.id, title: row.public_title, place_label: row.public_place, hint: "这里藏着一封公开的来信", state: claim ? "opened" : "sealed", claimed: Boolean(claim),
        author_alias: row.author_alias || "路过的旅人", source: row.source === "ai" ? "ai" : "human", contents: ["letter"],
        // Rounding the public anchor to 0.01 degrees can move it by up to 787 m.
        area: { latitude: row.public_latitude, longitude: row.public_longitude, radius_m: Math.max(2000, Number(row.claim_radius_m || 0) + 800) }, created_at: row.created_at,
        ...(claim ? { body: row.public_text, claimed_at: claim.claimed_at } : {}) };
}
function mapPage(query, { defaultLimit = 40, allowed = [] } = {}) {
    const integer = (value, fallback, maximum) => {
        if (value === undefined) return fallback;
        if (typeof value !== "string" || !/^\d{1,9}$/u.test(value)) throw fault(400, "surprise_map_invalid_request");
        const number = Number(value);
        if (!Number.isSafeInteger(number) || number > maximum) throw fault(400, "surprise_map_invalid_request");
        return number;
    };
    const offset = integer(query.offset, 0, 100000000), limit = integer(query.limit, defaultLimit, 100);
    if (limit < 1 || Object.keys(query).some(key => !["offset", "limit", ...allowed].includes(key))) throw fault(400, "surprise_map_invalid_request");
    return { offset, limit };
}
function publicAuthor(value) {
    if (value === undefined) return "";
    if (typeof value !== "string" || value.length > 40) throw fault(400, "surprise_map_invalid_request");
    const author = value.trim();
    if (!author) return "";
    if (author.length < 2 || /[\u0000-\u001f\u007f]/u.test(author)) throw fault(400, "surprise_map_invalid_request");
    return author;
}

function publicViewport(value) {
    if (value === undefined) return null;
    if (typeof value !== "string" || value.length > 40) throw fault(400, "surprise_map_viewport_invalid");
    const parts = value.split(",");
    if (parts.length !== 4 || parts.some(part => !/^-?\d{1,3}(?:\.\d{1,2})?$/u.test(part))) throw fault(400, "surprise_map_viewport_invalid");
    const [west, south, east, north] = parts.map(Number);
    const span = east > west ? east - west : 360 - west + east;
    if (Math.abs(west) > 180 || Math.abs(east) > 180 || Math.abs(south) > 90 || Math.abs(north) > 90 || south >= north || west === east || span <= 0) throw fault(400, "surprise_map_viewport_invalid");
    return { west, south, east, north, wraps_dateline: west > east };
}
function filterViewport(query, viewport) {
    if (!viewport) return query;
    const { west, south, east, north } = viewport;
    query = query.gte("public_latitude", south).lte("public_latitude", north);
    if (west === -180 && east === 180) return query;
    // Both signed representations of the date line refer to the same meridian.
    if (west > east || west === -180 || east === 180) return query.or(`public_longitude.gte.${west === -180 ? 180 : west},public_longitude.lte.${east === 180 ? -180 : east}`);
    return query.gte("public_longitude", west).lte("public_longitude", east);
}
async function claimRecord(database, column, id) {
    return result(database.from(TABLE.claims).select("id,claimed_at,letter_id,publication_id").eq(column, id).maybeSingle());
}
async function saveClaim(scope, column, id, now) {
    try {
        return { claim: await result(scope.db.from(TABLE.claims).insert({ id: randomUUID(), user_id: scope.userId, companion_id: scope.companionId,
            [column]: id, claimed_at: new Date(now).toISOString() }).select("id,claimed_at,letter_id,publication_id").single()), already: false };
    } catch (error) {
        if (error.code !== "23505") throw error;
        const claim = await claimRecord(scope.db, column, id);
        if (!claim) throw error;
        return { claim, already: true };
    }
}
function createSurpriseMapRouter({ publicationDatabase, draftLetter, publicDraftLetter, now = Date.now, random = Math.random } = {}) {
    const router = express.Router();
    const route = handler => async (req, res) => {
        try { await handler(req, res); }
        catch (error) {
            const code = messages[error?.code] ? error.code
                : ["42P01", "PGRST205"].includes(error?.code) ? "surprise_map_schema_required" : "surprise_map_storage_unavailable";
            res.status(messages[error?.code] ? error.status || 400 : 503).json({ ok: false, code, message: messages[code] });
        }
    };
    router.use((req, res, next) => {
        try { req.surpriseScope = requireRequestScope(req); res.set("Cache-Control", "private, no-store"); next(); }
        catch { res.status(401).json({ ok: false, code: "authentication_required", message: "请先登录 DengTa Home。" }); }
    });
    const publishedDatabase = () => {
        if (!publicationDatabase?.from) throw fault(503, "surprise_map_public_unavailable");
        return publicationDatabase;
    };
    const ownLetter = async (scope, id) => {
        if (!UUID.test(id)) throw fault(404, "surprise_map_not_found");
        const row = await result(scope.db.from(TABLE.letters).select("*").eq("id", id).maybeSingle());
        if (!row) throw fault(404, "surprise_map_not_found");
        return row;
    };
    const publication = async id => {
        if (!UUID.test(id)) throw fault(404, "surprise_map_not_found");
        const row = await result(publishedDatabase().from(TABLE.publications).select("*").eq("id", id).eq("state", "published").maybeSingle());
        if (!row) throw fault(404, "surprise_map_not_found");
        return row;
    };
    router.post("/draft", route(async (req, res) => {
        const body = input(req.body || {}, ["place_label", "mood", "audience"]);
        const place = text(body.place_label, 160), mood = text(body.mood, 200, true);
        const audience = body.audience === undefined ? "private" : body.audience;
        if (!["private", "public"].includes(audience)) throw fault(400, "surprise_map_invalid_request");
        const generator = audience === "public" ? publicDraftLetter : draftLetter;
        if (typeof generator !== "function") throw fault(503, "surprise_map_draft_unavailable");
        let draft;
        try { draft = await generator(req.surpriseScope, { place_label: place, mood }); }
        catch (error) { throw fault(error?.code === "surprise_map_draft_unavailable" ? 503 : 502,
            error?.code === "surprise_map_draft_unavailable" ? "surprise_map_draft_unavailable" : "surprise_map_draft_failed"); }
        try { res.json({ ok: true, audience,
            draft: { title: text(draft?.title, 160), body: text(draft?.body, audience === "public" ? 2000 : 16000) }, saved: false, published: false }); }
        catch { throw fault(502, "surprise_map_draft_failed"); }
    }));
    router.post("/letters", route(async (req, res) => {
        const scope = req.surpriseScope, body = input(req.body || {}, ["title", "body", "hint", "place_label", "latitude", "longitude", "radius_m", "accuracy", "captured_at", "client_request_id"]);
        const title = text(body.title, 160), content = text(body.body, 16000), hint = text(body.place_label || body.hint || "走到这片范围附近，看看给你留了什么", 240);
        const latitude = coordinate(body.latitude, 90), longitude = coordinate(body.longitude, 180), radius = body.radius_m === undefined ? 200 : body.radius_m;
        if (!Number.isInteger(radius) || radius < 50 || radius > 5000) throw fault(400, "surprise_map_invalid_request");
        if (!UUID.test(body.client_request_id || "")) throw fault(400, "surprise_map_invalid_request");
        const existing = await result(scope.db.from(TABLE.letters).select("*").eq("client_request_id", body.client_request_id).maybeSingle());
        if (existing) {
            if (existing.title !== title || existing.body !== content || existing.hint !== hint || existing.radius_m !== radius || existing.latitude !== latitude || existing.longitude !== longitude) throw fault(409, "surprise_map_request_conflict");
            res.json({ ok: true, letter: privateCard(existing), published: false, replayed: true }); return;
        }
        verifyPosition({ latitude, longitude, accuracy: body.accuracy, captured_at: body.captured_at }, { latitude, longitude, radius_m: 5000 }, Number(now()));
        const areaRadius = Math.max(300, radius * 3), angle = random() * Math.PI * 2, offset = random() * areaRadius / 2;
        const areaLatitude = Math.max(-90, Math.min(90, latitude + offset * Math.cos(angle) / 111320));
        const areaLongitude = ((longitude + offset * Math.sin(angle) / (111320 * Math.max(0.01, Math.cos(latitude * Math.PI / 180))) + 540) % 360) - 180;
        let row;
        try { row = await result(scope.db.from(TABLE.letters).insert({ id: randomUUID(), client_request_id: body.client_request_id, user_id: scope.userId, companion_id: scope.companionId,
            title, body: content, hint, latitude, longitude, radius_m: radius, area_latitude: areaLatitude, area_longitude: areaLongitude,
            area_radius_m: areaRadius, created_at: new Date(Number(now())).toISOString() }).select("*").single()); }
        catch (error) {
            if (error.code !== "23505") throw error;
            row = await result(scope.db.from(TABLE.letters).select("*").eq("client_request_id", body.client_request_id).maybeSingle());
            if (!row) throw error;
        }
        if (row.title !== title || row.body !== content || row.hint !== hint || row.radius_m !== radius || row.latitude !== latitude || row.longitude !== longitude) throw fault(409, "surprise_map_request_conflict");
        res.status(201).json({ ok: true, letter: privateCard(row), published: false });
    }));
    router.get("/letters", route(async (req, res) => {
        const db = req.surpriseScope.db, rows = await result(db.from(TABLE.letters).select("*").order("created_at", { ascending: false }).limit(200)) || [];
        if (!rows.length) { res.json({ ok: true, letters: [] }); return; }
        const ids = rows.map(row => row.id);
        const claims = await result(db.from(TABLE.claims).select("letter_id,claimed_at").in("letter_id", ids)) || [];
        const publications = await result(db.from(TABLE.publications).select("id,letter_id,state").in("letter_id", ids)) || [];
        const claimed = new Map(claims.map(row => [row.letter_id, row])), published = new Map(publications.map(row => [row.letter_id, row]));
        res.json({ ok: true, letters: rows.map(row => privateCard(row, claimed.get(row.id), published.get(row.id))) });
    }));
    router.get("/collection", route(async (req, res) => {
        const scope = req.surpriseScope, { offset, limit } = mapPage(req.query);
        const claims = await result(scope.db.from(TABLE.claims).select("id,letter_id,publication_id,claimed_at")
            .order("claimed_at", { ascending: false }).order("id", { ascending: false }).range(offset, offset + limit)) || [];
        const pageClaims = claims.slice(0, limit), privateIds = pageClaims.map(claim => claim.letter_id).filter(Boolean), publicIds = pageClaims.map(claim => claim.publication_id).filter(Boolean);
        const [privateRows, publicRows] = await Promise.all([
            privateIds.length ? result(scope.db.from(TABLE.letters).select("*").in("id", privateIds)) : [],
            publicIds.length ? result(publishedDatabase().from(TABLE.publications).select(PUBLIC_COLUMNS).in("id", publicIds)) : [],
        ]);
        const privateById = new Map((privateRows || []).map(row => [row.id, row])), publicById = new Map((publicRows || []).map(row => [row.id, row]));
        const letters = pageClaims.map(claim => {
            const kind = claim.letter_id ? "private" : "public", id = claim.letter_id || claim.publication_id;
            const row = (kind === "private" ? privateById : publicById).get(id);
            if (!row || (kind === "public" && row.state !== "published")) return { id, kind, title: "这封来信已不可查看", state: "unavailable",
                claimed: true, claimed_at: claim.claimed_at, unavailable: true, unavailable_reason: row?.state === "withdrawn" ? "withdrawn" : "not_found" };
            return { ...(kind === "private" ? privateCard(row, claim) : publicCard(row, claim)), kind, unavailable: false };
        });
        const hasMore = claims.length > limit;
        res.json({ ok: true, letters, page: { offset, limit, has_more: hasMore, next_offset: hasMore ? offset + limit : null } });
    }));
    router.post("/letters/:id/claim", route(async (req, res) => {
        const scope = req.surpriseScope, row = await ownLetter(scope, req.params.id), previous = await claimRecord(scope.db, "letter_id", row.id);
        if (previous) { res.json({ ok: true, already: true, letter: privateCard(row, previous) }); return; }
        verifyPosition(req.body || {}, row, Number(now()));
        const saved = await saveClaim(scope, "letter_id", row.id, Number(now()));
        res.json({ ok: true, already: saved.already, letter: privateCard(row, saved.claim) });
    }));
    router.post("/letters/:id/publish", route(async (req, res) => {
        const scope = req.surpriseScope, row = await ownLetter(scope, req.params.id);
        const body = input(req.body || {}, ["confirm_publication", "public_title", "public_text", "public_place", "public_latitude", "public_longitude", "source"]);
        if (body.confirm_publication !== true) throw fault(400, "surprise_map_publication_confirmation_required");
        const title = text(body.public_title, 160), content = text(body.public_text, 16000), place = text(body.public_place, 160);
        const source = body.source === undefined ? "human" : body.source;
        if (!["ai", "human"].includes(source)) throw fault(400, "surprise_map_invalid_request");
        const latitude = coordinate(body.public_latitude, 90), longitude = coordinate(body.public_longitude, 180);
        const snapshot = { public_title: title, public_text: content, public_place: place, author_alias: authorAlias(row.user_id, row.companion_id), source,
            public_latitude: Math.round(latitude * 100) / 100, public_longitude: Math.round(longitude * 100) / 100,
            claim_latitude: latitude, claim_longitude: longitude, claim_radius_m: row.radius_m };
        const replay = existing => {
            if (existing.state !== "published" || Object.keys(snapshot).some(key => existing[key] !== snapshot[key])) throw fault(409, "surprise_map_publication_exists");
            res.json({ ok: true, publication: publicCard(existing), replayed: true });
        };
        const existing = await result(scope.db.from(TABLE.publications).select("*").eq("letter_id", row.id).maybeSingle());
        if (existing) { replay(existing); return; }
        let published;
        try {
            published = await result(scope.db.from(TABLE.publications).insert({ id: randomUUID(), user_id: scope.userId, companion_id: scope.companionId,
                letter_id: row.id, ...snapshot, state: "published", created_at: new Date(Number(now())).toISOString() }).select("*").single());
        } catch (error) {
            if (error.code !== "23505") throw error;
            const concurrent = await result(scope.db.from(TABLE.publications).select("*").eq("letter_id", row.id).maybeSingle());
            if (!concurrent) throw error;
            replay(concurrent); return;
        }
        res.status(201).json({ ok: true, publication: publicCard(published) });
    }));
    router.get("/public", route(async (req, res) => {
        const { offset, limit } = mapPage(req.query, { defaultLimit: 100, allowed: ["bbox", "author"] });
        const viewport = publicViewport(req.query.bbox), author = publicAuthor(req.query.author);
        const base = publishedDatabase().from(TABLE.publications).select(PUBLIC_COLUMNS).eq("state", "published");
        const matches = await result(filterViewport(author ? base.eq("author_alias", author) : base, viewport)
            .order("created_at", { ascending: false }).order("id", { ascending: false }).range(offset, offset + limit)) || [];
        const rows = matches.slice(0, limit), hasMore = matches.length > limit;
        const claims = rows.length ? await result(req.surpriseScope.db.from(TABLE.claims).select("publication_id,claimed_at").in("publication_id", rows.map(row => row.id))) || [] : [];
        const claimed = new Map(claims.map(row => [row.publication_id, row]));
        const ownedRows = rows.length ? await result(req.surpriseScope.db.from(TABLE.publications).select("id").in("id", rows.map(row => row.id))) || [] : [];
        const owned = new Set(ownedRows.map(row => row.id));
        res.json({ ok: true, letters: rows.map(row => ({ ...publicCard(row, claimed.get(row.id)), owned: owned.has(row.id) })),
            page: { offset, limit, has_more: hasMore, next_offset: hasMore ? offset + limit : null }, viewport, author });
    }));
    router.post("/public/:id/claim", route(async (req, res) => {
        const scope = req.surpriseScope, row = await publication(req.params.id), previous = await claimRecord(scope.db, "publication_id", row.id);
        if (previous) { res.json({ ok: true, already: true, letter: publicCard(row, previous) }); return; }
        verifyPosition(req.body || {}, { latitude: row.claim_latitude, longitude: row.claim_longitude, radius_m: row.claim_radius_m }, Number(now()));
        const saved = await saveClaim(scope, "publication_id", row.id, Number(now()));
        res.json({ ok: true, already: saved.already, letter: publicCard(row, saved.claim) });
    }));
    router.delete("/public/:id", route(async (req, res) => {
        if (!UUID.test(req.params.id)) throw fault(404, "surprise_map_not_found");
        const row = await result(req.surpriseScope.db.from(TABLE.publications).update({ state: "withdrawn", withdrawn_at: new Date(Number(now())).toISOString() }).eq("id", req.params.id).select("id").maybeSingle());
        if (!row) throw fault(404, "surprise_map_not_found");
        res.json({ ok: true, id: row.id, state: "withdrawn" });
    }));
    return router;
}

module.exports = { createSurpriseMapRouter, distanceMeters };
