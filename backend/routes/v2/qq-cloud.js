const express = require("express");
const { requireRequestScope } = require("../../services/request-scope");

function createQQCloudRouter(service) {
    const router = express.Router();
    const handle = (action) => async (req, res, next) => {
        res.set("Cache-Control", "private, no-store");
        try {
            res.json(await action(requireRequestScope(req)));
        } catch (error) {
            next(error);
        }
    };
    router.get("/", handle(service.status));
    router.post("/start", handle(service.begin));
    router.post("/pair-code", handle(service.resetPairCode));
    router.delete("/", handle(service.disconnect));
    return router;
}

module.exports = { createQQCloudRouter };
