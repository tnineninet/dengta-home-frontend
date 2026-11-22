import { useState } from "react";
import { createRoot } from "react-dom/client";
import TakeoutAssistant, { TakeoutTaskCard } from "../src/TakeoutAssistant.jsx";
import TakeoutLoginPanel from "../src/TakeoutLoginPanel.jsx";
import { updateTakeoutTask } from "../src/takeout-assistant.js";

const scope = "synthetic-takeout-preview";
const query = new URLSearchParams(location.search);
const fixture = query.get("state") || "idle";
const loginRead = async () => ({ status: "ready", loggedIn: true, hasCookie: true });
const appEvents = { addListener: async () => ({ remove() {} }) };
const readyTask = { scope, commandId: "preview-order", action: "order", status: "awaiting_payment", completed: ["search", "menu", "order"], shop: "示例 · 暖暖小厨房", product: "番茄鸡蛋饭", total: 28.5,
  shops: [{ name: "示例 · 暖暖小厨房", meta: "示例 · 暖暖小厨房 | 4.9 | 分 | 起送¥20 | 30分钟" }],
  products: [{ name: "番茄鸡蛋饭", price: 23, available: true }, { name: "紫菜蛋花汤", price: 5, available: true }, { name: "售罄的小菜", price: null, available: false }],
  lines: [{ name: "番茄鸡蛋饭", quantity: 1 }],
  message: "已经准备好，请核对商品与金额后亲自付款。" };
export function TakeoutPreview() {
  const [open, setOpen] = useState(true);
  const [task, setTask] = useState(fixture === "ready" ? readyTask : fixture === "error" ? { scope, status: "manual_review", action: "order", completed: ["search", "menu"], message: "无法确认购物车总额，请在平台里核对；没有重复加购。", code: "takeout_cart_unverified" } : null);
  const start = async () => {
    const command = { id: "fixture-search", command: { action: "search", requirement: "示例饭菜" } };
    setTask(previous => updateTakeoutTask(previous, { scope, type: "start", command }));
    return { ok: true };
  };
  return <main className="preview-chat">
    <header><strong>小灯</strong><span>灯塔 · 聊天中的外卖助手</span><button type="button" onClick={() => setOpen(true)}>打开外卖助手</button></header>
    <p className="preview-badge">本地虚构交互预览 · 不访问外卖平台，不会创建订单</p>
    <div className="preview-dialogue"><p className="preview-user">今天有点累，不知道吃什么。</p><p>我们找点热乎的吧。我来帮你看看菜单，你只管挑喜欢的。</p></div>
    <div className="preview-bottom"><TakeoutTaskCard task={task} onOpen={() => setOpen(true)} /><div>说点什么… <span>＋</span></div></div>
    <TakeoutAssistant scope={scope} open={open} onClose={() => setOpen(false)} aiName="小灯" task={task}
      available={fixture !== "web"} onStart={start} onStop={() => setTask(current => ({ ...current, status: "manual_review", pausedByUser: true, message: "示例：自动操作已暂停，平台页面保持打开。" }))}
      onReview={() => { globalThis.__previewReviewClicks = (globalThis.__previewReviewClicks || 0) + 1; }}
      loginPanel={<TakeoutLoginPanel scope={scope} available readLogin={loginRead} openLogin={async () => ({ ok: true })} appEvents={appEvents} />} />
  </main>;
}
const style = document.createElement("style");
style.textContent = `*{box-sizing:border-box}body{margin:0;font-family:system-ui,"Microsoft Yahei",sans-serif;background:#ece7de;color:#473d35}button,input,textarea,select{font-family:inherit}.preview-chat{min-height:100dvh;max-width:900px;margin:auto;background:linear-gradient(#e6e5da,#efe0d0);position:relative}.preview-chat>header{display:flex;align-items:center;gap:15px;padding:25px;background:#faf8f2}.preview-chat>header>span{font-size:12px;color:#8f8172}.preview-chat>header>button{margin-left:auto;border:1px solid #d6c3ad;border-radius:12px;padding:10px;background:#fffaf2;color:#745e48}.preview-badge{font-size:11px;color:#927c62;padding:5px 24px}.preview-dialogue{padding:36px 28px;display:grid;gap:30px}.preview-dialogue>p{background:#fffaf1;border:1px solid #ddccba;border-radius:18px;padding:20px;font-size:15px;max-width:70%;line-height:1.7;margin:0}.preview-dialogue>.preview-user{justify-self:end;background:#e2d6c3}.preview-bottom{position:absolute;bottom:24px;left:24px;right:24px}.preview-bottom>div{padding:18px;border-radius:25px;background:#fff8ee;border:1px solid #cfbaa2;font-size:14px;color:#9f8e7c}.preview-bottom>div>span{float:right}@media(max-width:600px){.preview-chat>header{padding:18px}.preview-chat>header>span{display:none}.preview-dialogue{padding:28px 20px}.preview-dialogue>p{max-width:85%;font-size:13px}}`;
document.head.append(style);
createRoot(document.getElementById("root")).render(<TakeoutPreview />);
