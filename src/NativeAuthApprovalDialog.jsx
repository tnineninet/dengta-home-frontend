import { useEffect, useRef } from "react";

export default function NativeAuthApprovalDialog({ approval, onDecision }) {
  const dialog = useRef(null), cancel = useRef(null);
  useEffect(() => {
    const element = dialog.current, previous = globalThis.document?.activeElement;
    try {
      if (typeof element?.showModal !== "function") throw new Error("dialog_unavailable");
      element.showModal();
      cancel.current?.focus();
    } catch { onDecision(approval.id, false); }
    return () => {
      if (element?.open) element.close();
      if (previous?.isConnected) previous.focus?.();
    };
  }, [approval.id, onDecision]);
  return (
    <dialog ref={dialog} className="native-auth-approval" data-native-auth-approval="true"
      aria-labelledby="native-auth-approval-title" onCancel={event => { event.preventDefault(); onDecision(approval.id, false); }}>
      <section>
        <h2 id="native-auth-approval-title">{approval.recovery ? "确认这次邮件密码重置" : "确认这次邮件登录"}</h2>
        <p>将使用账号：<strong>{approval.email}</strong></p>
        {approval.hasCurrentUser && <p>当前账号：{approval.currentEmail || "已登录账号"}。继续后会使用上述邮件账号。</p>}
        <p>请核对邮箱。如果这不是你发起的操作，请取消。</p>
        <div className="native-auth-approval-actions">
          <button ref={cancel} type="button" onClick={() => onDecision(approval.id, false)}>取消，保留当前状态</button>
          <button type="button" onClick={() => onDecision(approval.id, true)}>确认使用此账号</button>
        </div>
      </section>
    </dialog>
  );
}
