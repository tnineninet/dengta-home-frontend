const express = require("express");
const { requireRequestScope } = require("../services/request-scope");
const {
    VisionProviderError,
    publicProfile,
    readProfile,
    saveProfile,
    testProfile
} = require("../services/vision-provider-center");

function routeError(error, next) {
    if (error instanceof VisionProviderError) return next(error);
    next(error);
}

function createVisionProviderRouter() {
    const router = express.Router();
    router.use((req, res, next) => {
        try {
            requireRequestScope(req);
            res.set("Cache-Control", "private, no-store");
            next();
        } catch (error) {
            next(error);
        }
    });

    router.get("/", async (req, res, next) => {
        try {
            const scope = requireRequestScope(req);
            const row = await readProfile(scope.db);
            res.json({ ok: true, profile: publicProfile(row) });
        } catch (error) {
            routeError(error, next);
        }
    });

    router.put("/", async (req, res, next) => {
        try {
            const scope = requireRequestScope(req);
            const profile = await saveProfile(scope.db, req.body || {});
            res.json({ ok: true, profile });
        } catch (error) {
            routeError(error, next);
        }
    });

    router.post("/test", async (req, res, next) => {
        try {
            const scope = requireRequestScope(req);
            res.json(await testProfile(scope.db));
        } catch (error) {
            routeError(error, next);
        }
    });

    return router;
}

module.exports = { createVisionProviderRouter };
