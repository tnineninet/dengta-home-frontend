const { createHash } = require("node:crypto");
const { describeImage } = require("./vision-describe");
const {
    isProviderBoundaryResidue
} = require("./persistent-memory-filter");

function imageSha256(buffer) {
    if (!Buffer.isBuffer(buffer) || buffer.length === 0) return "";
    return createHash("sha256").update(buffer).digest("hex");
}

function isMissingImageDescriptionTable(error) {
    return (
        error?.code === "42P01" ||
        error?.code === "PGRST205" ||
        /image_descriptions.*does not exist|could not find.*image_descriptions/i.test(
            String(error?.message || "")
        )
    );
}

function createImageDescriptionStore({
    database,
    vision = null,
    describe = describeImage,
    now = () => new Date()
} = {}) {
    async function readBySha(sha256) {
        if (!database || typeof database.from !== "function") return null;
        let result;
        try {
            result = await database
                .from("image_descriptions")
                .select("description, source, model, mime_type, byte_size")
                .eq("sha256", sha256)
                .maybeSingle();
        } catch {
            return null;
        }
        const data = result?.data || null;
        if (result?.error) {
            // The cache is an optimization. Missing table, RLS/permission
            // problems, gateway errors and timeouts must never break chat or
            // Moments; callers fall back to a direct description.
            return null;
        }
        if (data?.description && isProviderBoundaryResidue(data.description)) {
            return null;
        }
        return data || null;
    }

    async function getOrCreate({ buffer, mimeType, model = "" } = {}) {
        const bytes = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer || []);
        const sha256 = imageSha256(bytes);
        if (!sha256) {
            return { description: "", sha256: "", cached: false };
        }
        const existing = await readBySha(sha256);
        if (existing?.description) {
            return {
                description: String(existing.description),
                sha256,
                cached: true,
                source: existing.source || "vision",
                model: existing.model || ""
            };
        }
        if (!vision?.apiKey || !vision?.baseUrl || !vision?.model) {
            return { description: "", sha256, cached: false };
        }
        let description = "";
        try {
            description = await describe(
                bytes,
                String(mimeType || "image/jpeg"),
                vision
            );
        } catch {
            return { description: "", sha256, cached: false, failed: true };
        }
        description = String(description || "").trim().slice(0, 8000);
        if (!description || isProviderBoundaryResidue(description)) {
            // A provider refusal is not an image description and must never
            // enter the shared cache or a later prompt.
            return { description: "", sha256, cached: false, refused: true };
        }
        const timestamp = new Date(now()).toISOString();
        let insertError = null;
        try {
            const inserted = await database
                .from("image_descriptions")
                .insert({
                    sha256,
                    mime_type: String(mimeType || "image/jpeg").slice(0, 100),
                    byte_size: Math.max(1, bytes.length),
                    description,
                    source: "vision",
                    model: String(vision.model || model || "").slice(0, 160),
                    created_at: timestamp,
                    updated_at: timestamp
                })
                .select("id")
                .maybeSingle();
            insertError = inserted.error || null;
        } catch (error) {
            insertError = error;
        }
        if (insertError && insertError.code !== "23505") {
            // Keep the freshly generated description for this turn but do
            // not fail the request because the cache is unavailable.
            return {
                description,
                sha256,
                cached: false,
                source: "vision",
                model: vision.model || ""
            };
        }
        if (insertError?.code === "23505") {
            const concurrent = await readBySha(sha256);
            if (concurrent?.description) {
                return {
                    description: String(concurrent.description),
                    sha256,
                    cached: true,
                    source: concurrent.source || "vision",
                    model: concurrent.model || ""
                };
            }
        }
        return {
            description,
            sha256,
            cached: false,
            source: "vision",
            model: vision.model || ""
        };
    }

    return { getOrCreate, readBySha };
}

module.exports = {
    createImageDescriptionStore,
    imageSha256,
    isMissingImageDescriptionTable
};
