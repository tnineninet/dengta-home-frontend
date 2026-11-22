const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const { randomUUID } = require("node:crypto");
const express = require("express");
const { PGlite } = require("@electric-sql/pglite");
const { createRequestScope } = require("../services/request-scope");
const { createSurpriseMapRouter } = require("../services/surprise-map");
const { generateSurpriseMapDraft } = require("../services/surprise-map-draft");
const userA = "11111111-1111-4111-8111-111111111111", userB = "22222222-2222-4222-8222-222222222222";
const companionA = "33333333-3333-4333-8333-333333333333", companionB = "44444444-4444-4444-8444-444444444444", companionC = "55555555-5555-4555-8555-555555555555";
const time = Date.parse("2026-10-16T00:00:00Z");
const sql = fs.readFileSync(require.resolve("../supabase/062_surprise_map.sql"), "utf8");

function client(db) {
    const safe = value => { assert.match(value, /^[a-z_]+$/u); return `"${value}"`; };
    return { from(table) {
        const filters = [], params = [], ordering = []; let action = "select", payload, columns = "*", limit = "", one = false;
        const bind = value => { params.push(value); return `$${params.length}`; };
        const query = {
            select(value = "*") { columns = value; return query; },
            insert(value) { action = "insert"; payload = value; return query; },
            update(value) { action = "update"; payload = value; return query; },
            eq(key, value) { filters.push([key, "eq", value]); return query; },
            gte(key, value) { filters.push([key, "gte", value]); return query; },
            lte(key, value) { filters.push([key, "lte", value]); return query; },
            or(value) {
                const terms = value.split(",").map(term => {
                    const match = /^([a-z_]+)\.(gte|lte)\.(-?\d+(?:\.\d+)?)$/u.exec(term);
                    assert.ok(match, "fixture supports only numeric viewport OR filters");
                    return [match[1], match[2], Number(match[3])];
                });
                filters.push(["", "or", terms]); return query;
            },
            in(key, value) { filters.push([key, "in", value]); return query; },
            order(key, options) { ordering.push(`${safe(key)} ${options?.ascending === false ? "desc" : "asc"}`); return query; },
            limit(value) { assert.ok(Number.isInteger(value) && value >= 0); limit = ` limit ${value}`; return query; },
            range(start, end) { assert.ok(Number.isInteger(start) && start >= 0 && Number.isInteger(end) && end >= start); limit = ` limit ${end - start + 1} offset ${start}`; return query; },
            single() { one = true; return query; }, maybeSingle() { one = true; return query; },
            then(resolve, reject) {
                const run = async () => {
                    try {
                        const projection = columns === "*" ? "*" : columns.split(",").map(key => safe(key.trim())).join(",");
                        let command;
                        if (action === "insert") {
                            const keys = Object.keys(payload);
                            command = `insert into ${safe(table)} (${keys.map(safe).join(",")}) values (${keys.map(key => bind(payload[key])).join(",")}) returning ${projection}`;
                        } else {
                            const change = action === "update" ? Object.entries(payload).map(([key, value]) => `${safe(key)}=${bind(value)}`).join(",") : "";
                            const comparison = (key, op, value) => `${safe(key)} ${{ eq: "=", gte: ">=", lte: "<=" }[op]} ${bind(value)}`;
                            const where = filters.map(([key, op, value]) => op === "in" ? `${safe(key)} in (${value.map(bind).join(",")})`
                                : op === "or" ? `(${value.map(term => comparison(...term)).join(" or ")})` : comparison(key, op, value)).join(" and ");
                            command = action === "select" ? `select ${projection} from ${safe(table)}` : `update ${safe(table)} set ${change}`;
                            command += where ? ` where ${where}` : "";
                            command += action === "select" ? (ordering.length ? ` order by ${ordering.join(",")}` : "") + limit : ` returning ${projection}`;
                        }
                        const data = (await db.query(command, params)).rows;
                        return { data: one ? data[0] || null : data, error: null };
                    } catch (error) { return { data: null, error }; }
                };
                return run().then(resolve, reject);
            },
        };
        return query;
    } };
}

test("actual map router and SQL isolate private letters, public snapshots and individual claims", { timeout: 30000 }, async () => {
    const db = new PGlite(); let server;
    try {
        await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
          create table companions(user_id uuid not null, id uuid not null, primary key(user_id,id));
          insert into companions values ('${userA}','${companionA}'),('${userB}','${companionB}'),('${userA}','${companionC}');`);
        await db.exec(sql); await db.exec(sql);
        for (const role of ["anon", "authenticated"]) {
            await db.exec(`set role ${role}`);
            for (const table of ["surprise_map_letters", "surprise_map_claims", "surprise_map_publications"]) {
                await assert.rejects(db.query(`select * from ${table}`), error => error.code === "42501");
            }
            await db.exec("reset role");
        }
        const raw = client(db);
        const scope = (user, companion) => createRequestScope({ adminSupabase: raw, user: { id: user }, profile: { id: user, role: "member", status: "active" },
            companions: [{ id: companion, user_id: user, status: "active" }], companion: { id: companion, user_id: user, status: "active" } });
        const scopes = { A: scope(userA, companionA), B: scope(userB, companionB), C: scope(userA, companionC) };
        const app = express(); app.use(express.json()); app.use((req, res, next) => { req.scope = scopes[req.get("x-fixture")]; next(); });
        app.use(createSurpriseMapRouter({ publicationDatabase: raw, now: () => time, random: () => .5,
            draftLetter: async () => ({ title: "虚构来信", body: "星星在等你" }) }));
        server = await new Promise(resolve => { const value = app.listen(0, "127.0.0.1", () => resolve(value)); });
        const call = async (method, path, body, who = "A") => {
            const response = await fetch(`http://127.0.0.1:${server.address().port}${path}`, { method, headers: { "Content-Type": "application/json", "x-fixture": who }, body: body === undefined ? undefined : JSON.stringify(body) });
            return { status: response.status, cache: response.headers.get("cache-control"), ...(await response.json()) };
        };
        assert.equal((await call("GET", "/letters", undefined, "unknown")).status, 401);
        const position = { latitude: 0, longitude: 0, accuracy: 5, captured_at: new Date(time).toISOString() };
        const create = { ...position, title: "虚构私信", body: "PRIVATE_FICTIONAL_BODY", place_label: "虚构公共公园", radius_m: 100, client_request_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" };
        const made = await call("POST", "/letters", create); assert.equal(made.status, 201);
        assert.equal(made.cache, "private, no-store");
        const id = made.letter.id;
        assert.equal(made.letter.body, undefined); assert.equal(made.letter.latitude, undefined);
        assert.equal((await call("POST", "/letters", create)).replayed, true);
        assert.equal((await call("POST", "/letters", { ...create, body: "different" })).status, 409);
        assert.equal((await call("POST", "/letters", { ...create, latitude: 1, longitude: 1 })).status, 409);
        assert.equal((await db.query("select count(*)::int as total from surprise_map_letters")).rows[0].total, 1);
        for (const who of ["B", "C"]) {
            assert.deepEqual((await call("GET", "/letters", undefined, who)).letters, []);
            assert.equal((await call("POST", `/letters/${id}/claim`, position, who)).status, 404);
            assert.equal((await call("POST", `/letters/${id}/publish`, {}, who)).status, 404);
        }
        const sealed = await call("GET", "/letters");
        assert.doesNotMatch(JSON.stringify(sealed), /PRIVATE_FICTIONAL_BODY|client_request_id/);
        assert.equal(sealed.letters[0].latitude, undefined); assert.equal(sealed.letters[0].longitude, undefined);
        assert.notDeepEqual(sealed.letters[0].area, { latitude: 0, longitude: 0, radius_m: 100 });
        assert.equal((await call("POST", `/letters/${id}/claim`, { ...position, longitude: 1 })).code, "surprise_map_out_of_range");
        assert.equal((await call("POST", `/letters/${id}/claim`, { ...position, accuracy: 200 })).code, "surprise_map_location_inaccurate");
        assert.equal((await call("POST", `/letters/${id}/claim`, { ...position, captured_at: new Date(time - 130000).toISOString() })).code, "surprise_map_location_stale");
        assert.equal((await call("POST", `/letters/${id}/claim`, position)).letter.body, create.body);
        assert.equal((await call("POST", `/letters/${id}/claim`, {})).already, true);
        const publication = { public_title: "路过的问候", public_text: "PUBLIC_FICTIONAL_BODY", public_place: "虚构广场", public_latitude: 0, public_longitude: 0 };
        assert.equal((await call("POST", `/letters/${id}/publish`, publication)).status, 400);
        const concurrentPublications = await Promise.all(Array.from({ length: 2 }, () => call("POST", `/letters/${id}/publish`, { ...publication, confirm_publication: true })));
        assert.deepEqual(concurrentPublications.map(value => value.status).sort(), [200, 201]);
        const published = concurrentPublications.find(value => value.status === 201);
        assert.equal(published.status, 201); const pubId = published.publication.id;
        const shared = await call("GET", "/public", undefined, "B");
        assert.equal(shared.cache, "private, no-store");
        assert.equal(shared.letters[0].owned, false);
        assert.doesNotMatch(JSON.stringify(shared), /PRIVATE_FICTIONAL_BODY|PUBLIC_FICTIONAL_BODY|user_id|companion_id|claim_latitude|claim_longitude/);
        assert.equal((await call("GET", "/public")).letters[0].owned, true);
        const concurrentClaims = await Promise.all(Array.from({ length: 2 }, () => call("POST", `/public/${pubId}/claim`, position, "B")));
        assert.ok(concurrentClaims.every(value => value.letter.body === publication.public_text));
        assert.deepEqual(concurrentClaims.map(value => value.already).sort(), [false, true]);
        assert.equal((await call("POST", `/public/${pubId}/claim`, position, "C")).already, false);
        assert.equal((await call("POST", `/public/${pubId}/claim`, {}, "B")).already, true);
        const reopened = await call("GET", "/public", undefined, "B");
        assert.equal(reopened.letters[0].claimed, true);
        assert.equal(reopened.letters[0].body, publication.public_text, "claimed public letters remain readable after refreshing");
        assert.equal((await call("GET", "/public")).letters[0].body, undefined, "one account's claim must not unlock another account");
        const replayedPublication = await call("POST", `/letters/${id}/publish`, { ...publication, confirm_publication: true });
        assert.equal(replayedPublication.status, 200);
        assert.equal(replayedPublication.replayed, true);
        assert.equal(replayedPublication.publication.id, pubId);
        assert.equal((await call("POST", `/letters/${id}/publish`, { ...publication, public_text: "DIFFERENT_SNAPSHOT", confirm_publication: true })).code, "surprise_map_publication_exists");
        assert.equal((await db.query("select count(*)::int as total from surprise_map_claims")).rows[0].total, 3);
        assert.equal((await call("DELETE", `/public/${pubId}`, undefined, "B")).status, 404);
        assert.equal((await call("DELETE", `/public/${pubId}`)).status, 200);
        assert.deepEqual((await call("GET", "/public", undefined, "B")).letters, []);
        assert.equal((await call("POST", `/public/${pubId}/claim`, {}, "B")).status, 404);
        assert.equal((await call("POST", `/letters/${id}/publish`, { ...publication, confirm_publication: true })).code, "surprise_map_publication_exists", "a withdrawn snapshot cannot be silently republished by retry");
        const draft = await call("POST", "/draft", { place_label: "虚构公园", mood: "开心" });
        assert.equal(draft.draft.body, "星星在等你"); assert.equal(draft.saved, false); assert.equal(draft.published, false);
        assert.equal((await db.query("select count(*)::int as total from surprise_map_letters")).rows[0].total, 1);
    } finally { if (server) await new Promise(resolve => server.close(resolve)); await db.close(); }
});

test("claimed collection paginates outside the public feed and redacts withdrawn snapshots per account and companion", { timeout: 30000 }, async () => {
    const db = new PGlite(); let server;
    try {
        await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
            create table companions(user_id uuid not null, id uuid not null, primary key(user_id,id));
            insert into companions values ('${userA}','${companionA}'),('${userB}','${companionB}'),('${userA}','${companionC}');`);
        await db.exec(sql);
        await db.exec(`insert into surprise_map_letters (user_id,companion_id,client_request_id,title,body,hint,latitude,longitude,radius_m,area_latitude,area_longitude,area_radius_m,created_at)
            select '${userB}','${companionB}',gen_random_uuid(),'PUBLIC_TITLE_'||i,'PRIVATE_BODY_B','公园入口',0.0049,0.0049,5000,0,0,15000,
                '2026-10-16T00:00:00Z'::timestamptz - i * interval '1 minute' from generate_series(1,121) i;
            insert into surprise_map_publications (user_id,companion_id,letter_id,public_title,public_text,public_place,public_latitude,public_longitude,claim_latitude,claim_longitude,claim_radius_m,created_at)
            select user_id,companion_id,id,title,'PUBLIC_BODY_'||title,'公园入口',0,0,latitude,longitude,radius_m,created_at from surprise_map_letters;
            insert into surprise_map_claims (user_id,companion_id,publication_id,claimed_at)
            select '${userA}','${companionA}',id,created_at from surprise_map_publications;
            insert into surprise_map_letters (id,user_id,companion_id,client_request_id,title,body,hint,latitude,longitude,radius_m,area_latitude,area_longitude,area_radius_m)
            values ('66666666-6666-4666-8666-666666666666','${userA}','${companionA}',gen_random_uuid(),'私人收藏','PRIVATE_BODY_A','街角',0,0,100,0,0,300);
            insert into surprise_map_claims (user_id,companion_id,letter_id) values ('${userA}','${companionA}','66666666-6666-4666-8666-666666666666');`);
        const raw = client(db), scopes = {};
        for (const [key, user, companion] of [["A", userA, companionA], ["B", userB, companionB], ["C", userA, companionC]]) scopes[key] = createRequestScope({
            adminSupabase: raw, user: { id: user }, profile: { id: user, role: "member", status: "active" },
            companions: [{ id: companion, user_id: user, status: "active" }], companion: { id: companion, user_id: user, status: "active" },
        });
        const app = express(); app.use(express.json()); app.use((req, res, next) => { req.scope = scopes[req.get("x-fixture")]; next(); });
        app.use(createSurpriseMapRouter({ publicationDatabase: raw, now: () => time }));
        server = await new Promise(resolve => { const value = app.listen(0, "127.0.0.1", () => resolve(value)); });
        const call = async (path, who = "A", method = "GET") => {
            const response = await fetch(`http://127.0.0.1:${server.address().port}${path}`, { method, headers: { "x-fixture": who } });
            return { status: response.status, ...(await response.json()) };
        };
        const feed = await call("/public"), oldest = (await db.query("select id from surprise_map_publications order by created_at asc limit 1")).rows[0].id;
        assert.equal(feed.letters.length, 100); assert.ok(!feed.letters.some(letter => letter.id === oldest));
        assert.equal(feed.letters[0].area.radius_m, 5800, "public coarse area covers large claim radii and rounding offset");
        const gathered = []; let offset = 0;
        do {
            const page = await call(`/collection?offset=${offset}&limit=40`);
            assert.equal(page.status, 200); assert.ok(page.letters.length <= 40);
            gathered.push(...page.letters); offset = page.page.next_offset;
        } while (offset !== null);
        assert.equal(gathered.length, 122); assert.equal(new Set(gathered.map(letter => `${letter.kind}:${letter.id}`)).size, 122);
        assert.equal(gathered.find(letter => letter.id === oldest).body, "PUBLIC_BODY_PUBLIC_TITLE_121");
        assert.equal(gathered.find(letter => letter.kind === "private").body, "PRIVATE_BODY_A");
        assert.doesNotMatch(JSON.stringify(gathered), /PRIVATE_BODY_B|user_id|companion_id|claim_latitude|claim_longitude/);
        for (const who of ["B", "C"]) assert.deepEqual((await call("/collection", who)).letters, []);
        assert.equal((await call("/collection", "unknown")).status, 401);
        for (const query of ["limit=0", "limit=101", "offset=-1", "offset=1.2", "limit=1&limit=2", "user_id=other"]) assert.equal((await call(`/collection?${query}`)).status, 400);
        assert.equal((await call(`/public/${oldest}`, "B", "DELETE")).status, 200);
        const after = await call("/collection?offset=120&limit=40"), unavailable = after.letters.find(letter => letter.id === oldest);
        assert.equal(unavailable.state, "unavailable"); assert.equal(unavailable.unavailable_reason, "withdrawn");
        assert.equal(unavailable.body, undefined); assert.equal(unavailable.area, undefined); assert.equal(unavailable.claimed, true);
        assert.doesNotMatch(JSON.stringify(unavailable), /PUBLIC_BODY_|PUBLIC_TITLE_121|latitude|longitude/);
        const columns = (await db.query("select column_name from information_schema.columns where table_name='surprise_map_claims' order by ordinal_position")).rows.map(row => row.column_name);
        assert.deepEqual(columns, ["id", "user_id", "companion_id", "letter_id", "publication_id", "claimed_at"], "claim receipts do not retain recipient GPS or trajectories");
    } finally { if (server) await new Promise(resolve => server.close(resolve)); await db.close(); }
});

test("public viewport queries coarse anchors before pagination, including both sides of the date line", { timeout: 30000 }, async () => {
    const db = new PGlite(); let server;
    try {
        await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
            create table companions(user_id uuid not null, id uuid not null, primary key(user_id,id));
            insert into companions values ('${userA}','${companionA}'),('${userB}','${companionB}'),('${userA}','${companionC}');`);
        await db.exec(sql);
        const points = [
            ...Array.from({ length: 105 }, (_, index) => ({ label: `global-${index}`, latitude: 60, longitude: 60, age: index })),
            ...Array.from({ length: 3 }, (_, index) => ({ label: `near-${index}`, latitude: 56.78, longitude: 12.34, claimLatitude: -30, claimLongitude: -30, age: 1000 })),
            { label: "outside-north", latitude: 56.80, longitude: 12.34, age: 1001 },
            { label: "claim-only-near", latitude: 60, longitude: 60, claimLatitude: 56.78, claimLongitude: 12.34, age: 1002 },
            { label: "withdrawn", latitude: 56.78, longitude: 12.34, state: "withdrawn", age: 1003 },
            { label: "date-east", latitude: 10, longitude: 179.99, age: 1004 },
            { label: "date-west", latitude: 10, longitude: -179.99, age: 1005 },
            { label: "date-positive", latitude: 10, longitude: 180, age: 1006 },
            { label: "date-negative", latitude: 10, longitude: -180, age: 1007 },
            { label: "outside-date", latitude: 10, longitude: 170, age: 1008 },
        ].map(point => ({ ...point, id: randomUUID(), letterId: randomUUID() }));
        for (const point of points) {
            const timestamp = new Date(time - point.age * 60000).toISOString();
            await db.query(`insert into surprise_map_letters (id,user_id,companion_id,client_request_id,title,body,hint,latitude,longitude,radius_m,area_latitude,area_longitude,area_radius_m,created_at)
                values ($1,$2,$3,$1,$4,'PRIVATE_AUTHOR_BODY','街角',0,0,100,0,0,300,$5)`, [point.letterId, userB, companionB, point.label, timestamp]);
            await db.query(`insert into surprise_map_publications (id,user_id,companion_id,letter_id,public_title,public_text,public_place,public_latitude,public_longitude,claim_latitude,claim_longitude,claim_radius_m,state,created_at)
                values ($1,$2,$3,$4,$5,$6,'街角',$7,$8,$9,$10,100,$11,$12)`, [point.id, userB, companionB, point.letterId, point.label, `PUBLIC_BODY_${point.label}`,
                point.latitude, point.longitude, point.claimLatitude ?? point.latitude, point.claimLongitude ?? point.longitude, point.state || "published", timestamp]);
        }
        const opened = points.find(point => point.label === "near-0");
        await db.query("insert into surprise_map_claims (user_id,companion_id,publication_id) values ($1,$2,$3)", [userA, companionA, opened.id]);
        const raw = client(db), scopes = {};
        for (const [key, user, companion] of [["A", userA, companionA], ["B", userB, companionB], ["C", userA, companionC]]) scopes[key] = createRequestScope({
            adminSupabase: raw, user: { id: user }, profile: { id: user, role: "member", status: "active" },
            companions: [{ id: companion, user_id: user, status: "active" }], companion: { id: companion, user_id: user, status: "active" },
        });
        const app = express(); app.use((req, res, next) => { req.scope = scopes[req.get("x-fixture")]; next(); });
        app.use(createSurpriseMapRouter({ publicationDatabase: raw, now: () => time }));
        server = await new Promise(resolve => { const value = app.listen(0, "127.0.0.1", () => resolve(value)); });
        const call = async (query = "", who = "A") => {
            const response = await fetch(`http://127.0.0.1:${server.address().port}/public${query ? `?${query}` : ""}`, { headers: { "x-fixture": who } });
            return { status: response.status, ...(await response.json()) };
        };
        const global = await call();
        assert.equal(global.letters.length, 100); assert.equal(global.page.has_more, true); assert.equal(global.viewport, null);
        assert.ok(!global.letters.some(letter => letter.id === opened.id), "an older nearby letter is outside the old global latest-100 feed");
        const near = await call("bbox=12.33,56.77,12.35,56.79&limit=2");
        assert.equal(near.status, 200); assert.equal(near.letters.length, 2); assert.equal(near.page.next_offset, 2);
        assert.deepEqual(near.viewport, { west: 12.33, south: 56.77, east: 12.35, north: 56.79, wraps_dateline: false });
        const last = await call("bbox=12.33,56.77,12.35,56.79&limit=2&offset=2"), gathered = [...near.letters, ...last.letters];
        assert.equal(last.page.has_more, false); assert.equal(last.page.next_offset, null);
        assert.deepEqual(gathered.map(letter => letter.title).sort(), ["near-0", "near-1", "near-2"], "only coarse public anchors determine visibility");
        assert.equal(gathered.find(letter => letter.id === opened.id).body, "PUBLIC_BODY_near-0");
        assert.ok(gathered.filter(letter => letter.id !== opened.id).every(letter => letter.body === undefined));
        assert.doesNotMatch(JSON.stringify(gathered), /PRIVATE_AUTHOR_BODY|user_id|companion_id|claim_latitude|claim_longitude|letter_id/);
        for (const who of ["B", "C"]) {
            const other = await call("bbox=12.33,56.77,12.35,56.79", who);
            assert.ok(other.letters.every(letter => letter.body === undefined && letter.claimed === false));
            assert.ok(other.letters.every(letter => letter.owned === (who === "B")));
        }
        const titles = async bbox => (await call(`bbox=${bbox}`)).letters.map(letter => letter.title).sort();
        assert.deepEqual(await titles("179.98,9,-179.98,11"), ["date-east", "date-negative", "date-positive", "date-west"]);
        assert.deepEqual(await titles("179.98,9,180,11"), ["date-east", "date-negative", "date-positive"]);
        assert.deepEqual(await titles("-180,9,-179.98,11"), ["date-negative", "date-positive", "date-west"]);
        assert.deepEqual(await titles("170,9,179.98,11"), ["outside-date"]);
        assert.equal((await call("bbox=-180,-90,180,90&limit=1")).page.has_more, true);
        assert.deepEqual((await call("bbox=0,0,1,1")).letters, []);
        const all = []; let offset = 0;
        do {
            const page = await call(`limit=37&offset=${offset}`); all.push(...page.letters); offset = page.page.next_offset;
        } while (offset !== null);
        assert.equal(all.length, points.length - 1); assert.equal(new Set(all.map(letter => letter.id)).size, all.length);
        const invalid = ["", "0,0,1", "0,0,1,1,2", "181,0,1,1", "0,-91,1,1", "0,0,1,91", "0,1,1,1", "0,2,1,1", "1,0,1,1", "180,0,-180,1", "0.001,0,1,1", "NaN,0,1,1", "Infinity,0,1,1", "1e1,0,11,1", "0,0,1,1);drop table x"];
        for (const bbox of invalid) {
            const response = await call(`bbox=${encodeURIComponent(bbox)}`); assert.equal(response.status, 400, bbox); assert.equal(response.code, "surprise_map_viewport_invalid");
        }
        assert.equal((await call("bbox=0,0,1,1&bbox=0,0,1,1")).code, "surprise_map_viewport_invalid");
        for (const query of ["bbox[]=0,0,1,1", "limit=0", "limit=101", "offset=-1", "user_id=another"]) assert.equal((await call(query)).status, 400);
    } finally { if (server) await new Promise(resolve => server.close(resolve)); await db.close(); }
});

test("map drafting uses scoped settings and unchanged confirmed memories and performs no write", async () => {
    const settings = { unified_system_prompt: "FICTIONAL_PERSONA", user_details: "FICTIONAL_DETAILS", model: "fixture-model", max_tokens: 5000 };
    const memories = [{ summary: "FICTIONAL_MEMORY", created_at: "2026-10-16", updated_at: "2026-10-16" }];
    const original = JSON.stringify({ settings, memories }); let received;
    const query = { select() { return query; }, eq() { return query; }, order() { return query; }, limit: async () => ({ data: memories }) };
    const database = { from(table) { assert.equal(table, "memories"); return query; } };
    const value = await generateSurpriseMapDraft({ db: database }, { place_label: "虚构公园", mood: "平静" }, {
        getSettings: async db => { assert.equal(db, database); return settings; },
        generateReply: async input => { received = input; return { mode: "custom", text: '{"title":"风来的时候","body":"愿你有一个好心情。"}' }; },
    });
    assert.equal(value.title, "风来的时候"); assert.equal(received.settings.unified_system_prompt, settings.unified_system_prompt);
    assert.equal(received.settings.user_details, settings.user_details); assert.deepEqual(received.memories, memories);
    assert.equal(JSON.stringify({ settings, memories }), original);
    await assert.rejects(generateSurpriseMapDraft({ db: database }, { place_label: "虚构公园" }, {
        getSettings: async () => settings, generateReply: async () => ({ mode: "placeholder", text: "anything" }),
    }), error => error.code === "surprise_map_draft_unavailable");
});

test("draft failures distinguish unavailable configuration without exposing upstream details", async () => {
    const raw = { from() { throw new Error("Unexpected storage access"); } };
    const scope = createRequestScope({ adminSupabase: raw, user: { id: userA }, profile: { id: userA, role: "member", status: "active" },
        companions: [{ id: companionA, user_id: userA, status: "active" }], companion: { id: companionA, user_id: userA, status: "active" } });
    const app = express(); app.use(express.json()); app.use((req, res, next) => { req.scope = scope; next(); });
    app.use(createSurpriseMapRouter({ draftLetter: async (received, options) => {
        assert.equal(received, scope);
        throw Object.assign(new Error("FICTIONAL_UPSTREAM_PRIVATE_DETAIL"), { code: options.mood === "unavailable" ? "surprise_map_draft_unavailable" : "provider_private_failure" });
    } }));
    const server = await new Promise(resolve => { const value = app.listen(0, "127.0.0.1", () => resolve(value)); });
    try {
        for (const [mood, status, code] of [["unavailable", 503, "surprise_map_draft_unavailable"], ["failure", 502, "surprise_map_draft_failed"]]) {
            const response = await fetch(`http://127.0.0.1:${server.address().port}/draft`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ place_label: "虚构公园", mood }) });
            assert.equal(response.status, status);
            const value = await response.json(); assert.equal(value.code, code);
            assert.doesNotMatch(JSON.stringify(value), /FICTIONAL_UPSTREAM_PRIVATE_DETAIL|provider_private_failure/);
        }
    } finally { await new Promise(resolve => server.close(resolve)); }
});
test("public letters carry a stable pseudonym and AI source without tenant identifiers", { timeout: 30000 }, async () => {
    const db = new PGlite(); let server;
    const publicDraftCalls = [], privateDraftCalls = [];
    try {
        await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
            create table companions(user_id uuid not null, id uuid not null, primary key(user_id,id));
            insert into companions values ('${userA}','${companionA}'),('${userB}','${companionB}'),('${userA}','${companionC}');`);
        await db.exec(sql);
        const raw = client(db);
        const scope = (user, companion) => createRequestScope({ adminSupabase: raw, user: { id: user }, profile: { id: user, role: "member", status: "active" },
            companions: [{ id: companion, user_id: user, status: "active" }], companion: { id: companion, user_id: user, status: "active" } });
        const scopes = { A: scope(userA, companionA), B: scope(userB, companionB) };
        const app = express(); app.use(express.json()); app.use((req, res, next) => { req.scope = scopes[req.get("x-fixture")]; next(); });
        app.use(createSurpriseMapRouter({ publicationDatabase: raw, now: () => time, random: () => .5,
            draftLetter: async () => { privateDraftCalls.push(1); return { title: "私人草稿", body: "只给彼此" }; },
            publicDraftLetter: async (actualScope, input) => { publicDraftCalls.push(input); return { title: "AI 公开标题", body: "AI 公开正文", audience: "public" }; } }));
        server = await new Promise(resolve => { const value = app.listen(0, "127.0.0.1", () => resolve(value)); });
        const call = async (method, path, body, who = "A") => {
            const response = await fetch(`http://127.0.0.1:${server.address().port}${path}`, { method, headers: { "Content-Type": "application/json", "x-fixture": who }, body: body === undefined ? undefined : JSON.stringify(body) });
            return { status: response.status, ...(await response.json()) };
        };
        const position = { latitude: 0, longitude: 0, accuracy: 5, captured_at: new Date(time).toISOString() };
        const create = async requestId => (await call("POST", "/letters", { ...position, title: "私人标题", body: "PRIVATE_BODY", place_label: "虚构公园", radius_m: 100, client_request_id: requestId })).letter.id;
        const first = await create("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa");
        const publication = { public_title: "给路过的人", public_text: "PUBLIC_BODY", public_place: "虚构广场", public_latitude: 0, public_longitude: 0, confirm_publication: true, source: "ai" };
        const made = await call("POST", `/letters/${first}/publish`, publication); assert.equal(made.status, 201);
        assert.equal(made.publication.source, "ai");
        assert.match(made.publication.author_alias, /^[^\s]{2,40}$/u);
        assert.deepEqual(made.publication.contents, ["letter"]);
        const shared = await call("GET", "/public", undefined, "B");
        const card = shared.letters[0];
        assert.equal(card.author_alias, made.publication.author_alias);
        assert.equal((await call("GET", "/public", undefined, "B")).letters[0].author_alias, card.author_alias, "alias is stable across reads");
        const serialized = JSON.stringify(shared);
        assert.doesNotMatch(serialized, new RegExp(userA + "|" + companionA, "i"));
        assert.doesNotMatch(serialized, /PRIVATE_BODY|PUBLIC_BODY|claim_latitude|claim_longitude|user_id|companion_id|client_request_id/);
        assert.equal(card.latitude, undefined); assert.equal(card.longitude, undefined);
        const second = await create("bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb");
        assert.equal((await call("POST", `/letters/${second}/publish`, { ...publication, source: "robot" })).status, 400);
        assert.equal((await call("POST", `/letters/${second}/publish`, { ...publication, source: "human" })).status, 201);
        const sameAuthor = (await call("GET", "/public", undefined, "B")).letters.filter(item => item.place_label === "虚构广场");
        assert.equal(sameAuthor.length, 2);
        assert.equal(new Set(sameAuthor.map(item => item.author_alias)).size, 1, "same account and companion keep one pseudonym");
        const authorB = (await call("POST", "/letters", { ...position, title: "B 标题", body: "B_BODY", place_label: "B 公园", radius_m: 100, client_request_id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc" }, "B")).letter.id;
        assert.equal((await call("POST", `/letters/${authorB}/publish`, { ...publication, public_title: "B 公开", public_text: "B_PUBLIC", public_place: "B 公园", source: "human" }, "B")).status, 201);
        const otherAuthor = (await call("GET", "/public", undefined, "A")).letters.find(item => item.place_label === "B 公园");
        assert.ok(otherAuthor);
        assert.notEqual(otherAuthor.author_alias, made.publication.author_alias, "different accounts do not share a pseudonym");
        const aliasA = made.publication.author_alias;
        const byAuthorA = await call("GET", "/public?author=" + encodeURIComponent(aliasA), undefined, "B");
        assert.equal(byAuthorA.author, aliasA);
        assert.equal(byAuthorA.letters.length, 2);
        assert.ok(byAuthorA.letters.every(item => item.author_alias === aliasA));
        const byAuthorB = await call("GET", "/public?author=" + encodeURIComponent(otherAuthor.author_alias), undefined, "A");
        assert.equal(byAuthorB.letters.length, 1);
        assert.equal(byAuthorB.letters[0].place_label, "B 公园");
        assert.deepEqual((await call("GET", "/public?author=" + encodeURIComponent("不存在的旅人"), undefined, "A")).letters, []);
        assert.equal((await call("GET", "/public?author=" + encodeURIComponent("x".repeat(41)), undefined, "A")).status, 400);
        const draft = await call("POST", "/draft", { place_label: "虚构公园", audience: "public" });
        assert.equal(draft.audience, "public"); assert.equal(draft.draft.title, "AI 公开标题");
        assert.equal(publicDraftCalls.length, 1); assert.equal(privateDraftCalls.length, 0);
        assert.equal((await call("POST", "/draft", { place_label: "虚构公园" })).audience, "private");
        assert.equal(privateDraftCalls.length, 1);
        assert.equal((await call("POST", "/draft", { place_label: "虚构公园", audience: "strangers" })).status, 400);
    } finally { if (server) await new Promise(resolve => server.close(resolve)); await db.close(); }
});

test("public drafting is unavailable when no public generator is configured", { timeout: 30000 }, async () => {
    const db = new PGlite(); let server;
    try {
        await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
            create table companions(user_id uuid not null, id uuid not null, primary key(user_id,id));
            insert into companions values ('${userA}','${companionA}');`);
        await db.exec(sql);
        const raw = client(db);
        const scopes = { A: createRequestScope({ adminSupabase: raw, user: { id: userA }, profile: { id: userA, role: "member", status: "active" },
            companions: [{ id: companionA, user_id: userA, status: "active" }], companion: { id: companionA, user_id: userA, status: "active" } }) };
        const app = express(); app.use(express.json()); app.use((req, res, next) => { req.scope = scopes[req.get("x-fixture")]; next(); });
        app.use(createSurpriseMapRouter({ publicationDatabase: raw, now: () => time }));
        server = await new Promise(resolve => { const value = app.listen(0, "127.0.0.1", () => resolve(value)); });
        const response = await fetch(`http://127.0.0.1:${server.address().port}/draft`, { method: "POST", headers: { "Content-Type": "application/json", "x-fixture": "A" }, body: JSON.stringify({ place_label: "虚构公园", audience: "public" }) });
        assert.equal(response.status, 503);
        assert.equal((await response.json()).code, "surprise_map_draft_unavailable");
    } finally { if (server) await new Promise(resolve => server.close(resolve)); await db.close(); }
});
