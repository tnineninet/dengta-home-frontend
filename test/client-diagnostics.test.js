import test from "node:test";
import assert from "node:assert/strict";
import {
  buildAiFixDiagnosticBundle,
  clearBreadcrumbs,
  createTraceId,
  extractSafeClientLocation,
  readBreadcrumbs,
  recordBreadcrumb,
  sanitizeDiagnosticRoute,
  sanitizeTraceId,
} from "../src/client-diagnostics.js";
import {
  clearOperationFailures,
  readOperationFailures,
  recordOperationFailure,
  summarizeOperationFailures,
} from "../src/operation-diagnostics.js";

const scope = "test-diag-scope-a";

test("trace IDs, route redaction, and safe client locations scrub secrets and IDs", () => {
  const id = createTraceId();
  assert.match(id, /^dt-[a-z0-9]+-[a-f0-9]{8}$/);
  assert.equal(sanitizeTraceId(id), id);
  assert.equal(sanitizeTraceId("Bearer sk-not-safe-secret"), "");
  assert.equal(
    sanitizeDiagnosticRoute("/api/v2/takeout/123e4567-e89b-12d3-a456-426614174000/result?secret=abc"),
    "/api/v2/takeout/:id/result",
  );
  assert.equal(
    extractSafeClientLocation("https://www.dengtahome.com/assets/TakeoutAssistant-Ab12.js?v=1", 42, 7),
    "assets/TakeoutAssistant-Ab12.js:42:7",
  );
});

test("breadcrumbs and operation failures correlate by traceId and build secret-free AI fix bundle", () => {
  clearOperationFailures(scope);
  clearBreadcrumbs(scope);
  const traceId = createTraceId();
  recordBreadcrumb(scope, {
    kind: "api",
    target: "POST /api/v2/takeout/:id/result",
    detail: "HTTP 502 sk-secret-value-1234567890",
    status: 502,
    durationMs: 412,
    traceId,
    ok: false,
  });
  recordOperationFailure(scope, "/api/v2/takeout/123/result", {
    status: 502,
    code: "takeout_result_sync_failed",
    trace_id: traceId,
    error_fingerprint: "DTF-AABBCCDDEEFF",
    error_location: "services/takeout-channel.js:230:11",
    duration_ms: 412,
  });

  const failures = readOperationFailures(scope);
  assert.equal(failures.length, 1);
  assert.equal(failures[0].code, "DT-TAKEOUT");
  assert.equal(failures[0].traceId, traceId);
  assert.equal(failures[0].fingerprint, "DTF-AABBCCDDEEFF");
  assert.equal(failures[0].location, "services/takeout-channel.js:230:11");

  const summary = summarizeOperationFailures(scope);
  assert.equal(summary.total, 1);
  assert.equal(summary.avgDurationMs, 412);
  assert.equal(summary.latestTraceId, traceId);

  const crumbs = readBreadcrumbs(scope);
  assert.equal(crumbs.length, 1);
  assert.ok(!crumbs[0].detail.includes("sk-secret-value"));
  assert.ok(crumbs[0].detail.includes("[REDACTED]"));

  const bundle = buildAiFixDiagnosticBundle({
    localEntry: failures[0],
    breadcrumbs: crumbs,
    summary,
  });
  assert.ok(bundle.markdown.includes(traceId));
  assert.ok(bundle.markdown.includes("DTF-AABBCCDDEEFF"));
  assert.ok(bundle.markdown.includes("services/takeout-channel.js:230:11"));
  assert.ok(!bundle.markdown.includes("sk-secret-value"));

  clearOperationFailures(scope);
  clearBreadcrumbs(scope);
});
