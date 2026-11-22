"use strict";

function normalizedLabel(value) {
    return String(value ?? "").replace(/\s+/g, " ").trim().toLocaleLowerCase("en-US");
}

function isVerifiedTakeoutCheckout(result, command = {}, { allowNotes = false } = {}) {
    const quantity = Number(command.quantity);
    const product = command.product_name || command.requirement;
    const budget = command.budget_max === null || command.budget_max === undefined || command.budget_max === "" ? null : Number(command.budget_max);
    if (!Number.isInteger(quantity) || quantity < 1 || quantity > 20) return false;
    if (!allowNotes && String(command.note ?? "").trim()) return false;
    if (budget !== null && (!Number.isFinite(budget) || budget <= 0 || budget > 100000)) return false;
    return Boolean(
        command.action === "order" && result?.ok !== false &&
        result?.status === "ready_for_payment" && result.paymentSubmitted === false &&
        Number.isFinite(result.total) && result.total > 0 &&
        (budget === null || result.total <= budget) &&
        result.items === quantity && Array.isArray(result.lines) && result.lines.length === 1 &&
        normalizedLabel(product) && normalizedLabel(result.lines[0]?.name) === normalizedLabel(product) &&
        Number.isInteger(result.lines[0]?.quantity) && result.lines[0].quantity === quantity
    );
}

module.exports = { isVerifiedTakeoutCheckout };
