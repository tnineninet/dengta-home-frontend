// 客户端切后台/被系统挂起后，服务器可能仍把这一轮跑完。
// 回到前台时按 client_message_id 找回已经提交的 assistant 消息。
export function findRecoveredAssistant(messages, clientMessageId) {
    if (!clientMessageId) return null;
    return (Array.isArray(messages) ? messages : []).find(
        (item) =>
            item?.role === "assistant" &&
            item?.tool_calls?.reply_to_client_message_id === clientMessageId
    ) || null;
}

export function shouldRecoverPendingChat(pending, activeSessionId = "") {
    return Boolean(
        pending?.clientMessageId &&
        pending?.sessionId &&
        pending.sessionId === activeSessionId &&
        (pending.generationInProgress === true || pending.userMessageCommitted === true)
    );
}
