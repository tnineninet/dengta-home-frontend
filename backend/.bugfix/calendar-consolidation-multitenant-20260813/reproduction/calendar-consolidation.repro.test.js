const assert = require("node:assert/strict");
const {
    runCalendarConsolidation
} = require("../../../services/calendar-consolidation");

const now = Date.parse("2026-08-13T00:00:00.000Z");
const rows = [];
for (const tenant of [
    { user_id: "user-a", companion_id: "companion-a" },
    { user_id: "user-b", companion_id: "companion-b" }
]) {
    for (let index = 0; index < 7; index += 1) {
        rows.push({
            id: `${tenant.user_id}-day-${index}`,
            ...tenant,
            period_type: "day",
            period_start: new Date(now - (10 - index) * 86400000).toISOString(),
            period_end: new Date(now - (9 - index) * 86400000).toISOString(),
            superseded: false,
            summary: `${tenant.user_id} summary ${index}`
        });
    }
}

const inserted = [];
const superseded = [];
let selectedColumns = [];
const database = {
    from() {
        return {
            select(columns) {
                selectedColumns = columns.split(",").map((column) => column.trim());
                return this;
            },
            eq() {
                return this;
            },
            order() {
                return this;
            },
            async limit() {
                return {
                    data: rows.map((row) => Object.fromEntries(
                        selectedColumns.map((column) => [column, row[column]])
                    )),
                    error: null
                };
            },
            async insert(row) {
                inserted.push(row);
                return { error: null };
            },
            update() {
                return this;
            },
            async in(column, ids) {
                superseded.push(...ids);
                return { error: null };
            }
        };
    }
};

(async () => {
    await runCalendarConsolidation({
        database,
        force: true,
        now: () => now,
        logger: { info() {}, error() {} }
    });
    assert.equal(inserted.length, 2, "each tenant must produce its own week summary");
    assert.deepEqual(
        inserted.map((row) => [row.user_id, row.companion_id]),
        [
            ["user-a", "companion-a"],
            ["user-b", "companion-b"]
        ]
    );
    assert.equal(superseded.length, 14);
})().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
