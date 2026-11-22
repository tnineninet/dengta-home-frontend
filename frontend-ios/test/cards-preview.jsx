/* eslint-disable react-refresh/only-export-components */
import { createRoot } from "react-dom/client";
import "../src/index.css";
import "../src/auth.css";
import AchievementGuide from "../src/AchievementGuide.jsx";
import { TakeoutTaskCard } from "../src/TakeoutAssistant.jsx";

if (new URLSearchParams(location.search).get("night") === "1") {
  document.documentElement.dataset.dengtaAppearance = "night";
}

const task = {
  scope: "preview",
  status: "awaiting_payment",
  action: "order",
  completed: ["search", "menu", "order"],
  message: "已经准备好，请核对后亲自付款",
  shop: "虚构小馆",
  product: "番茄鸡蛋饭 · 加一份青菜",
  requirement: "想吃热乎的一人食",
  total: 28.5,
  lines: [{ name: "番茄鸡蛋饭", quantity: 1 }],
};

function Preview() {
  return (
    <main style={{ width: "100%", maxWidth: 390, margin: "0 auto", padding: 12, boxSizing: "border-box", display: "grid", gap: 18 }}>
      <AchievementGuide
        storageKey={null}
        achievements={[{ code: "first_chat", title: "初次相遇", unlocked: true }]}
        startExpanded
        onAction={() => {}}
        onClaim={async () => ({})}
      />
      <TakeoutTaskCard task={task} onOpen={() => {}} />
      <TakeoutTaskCard task={{ ...task, status: "manual_review", total: null, product: "" }} onOpen={() => {}} />
    </main>
  );
}

createRoot(document.getElementById("root")).render(<Preview />);
