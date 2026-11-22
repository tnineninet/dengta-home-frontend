function registerToolSensitiveText(serialized, addSensitiveText) {
    let complete = addSensitiveText(serialized) !== false;
    let parsed;
    try {
        parsed = JSON.parse(String(serialized || ""));
    } catch {
        return !String(serialized || "").trim();
    }
    let count = 0;
    const registered = new Set();
    function visit(value, depth = 0) {
        if (depth > 5) {
            complete = false;
            return;
        }
        if (typeof value === "string") {
            const normalized = value.trim();
            if (!normalized || registered.has(normalized)) return;
            if (count >= 200) {
                complete = false;
                return;
            }
            registered.add(normalized);
            count += 1;
            if (addSensitiveText(value) === false || Array.from(normalized).length > 1200) {
                complete = false;
            }
        } else if (Array.isArray(value)) {
            if (value.length > 50) complete = false;
            for (const item of value.slice(0, 50)) visit(item, depth + 1);
        } else if (value && typeof value === "object") {
            const items = Object.values(value);
            if (items.length > 50) complete = false;
            for (const item of items.slice(0, 50)) visit(item, depth + 1);
        }
    }
    visit(parsed);
    return complete;
}

module.exports = { registerToolSensitiveText };
