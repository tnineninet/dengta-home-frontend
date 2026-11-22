import { createRoot } from "react-dom/client";
import { SurpriseMapContent } from "../src/SurpriseMap.jsx";
import "../src/index.css";

const privateLetters = [{ id: "11111111-1111-4111-8111-111111111111", title: "写给今天的你", place_label: "海边的那张长椅", claimed: false, area: { latitude: 24.44, longitude: 118.07, radius_m: 300 } }];
const publicLetters = [{ id: "22222222-2222-4222-8222-222222222222", title: "给路过这里的你", place_label: "灯塔广场", claimed: false, author_alias: "晚风的旅人", source: "ai", contents: ["letter"], area: { latitude: 24.45, longitude: 118.08, radius_m: 2000 } }];
const claims = new Map();
const scenario = new URLSearchParams(location.search).get("state");
const capture = new URLSearchParams(location.search).get("capture") === "1";
const page = letters => ({ ok: true, letters, page: { has_more: false, next_offset: null } });
const request = async (path, options) => {
  const pathname = new URL(path, location.origin).pathname;
  if (scenario === "loading" && !options?.method) return new Promise(() => {});
  if (scenario === "error" && pathname.endsWith("/public") && !options?.method) throw Object.assign(Error("Fixture"), { code: "request_timeout" });
  if (pathname.endsWith("/draft")) {
    const draft = { title: "在海风里等你", body: "如果今天走得有点累，就在这儿歇一歇。\n\n你不必着急，我陪你看一会儿海。等风吹过，把这一刻放进信箱，留给下一次路过的你。" };
    return options.body?.audience === "public" ? { ok: true, audience: "public", draft } : { draft };
  }
  if (pathname.endsWith("/claim")) {
    const letter = [...privateLetters, ...publicLetters].find(item => pathname.includes(item.id));
    const kind = pathname.includes("/public/") ? "public" : "private";
    const opened = { ...letter, kind, claimed: true, body: "这是一封虚构预览来信。\n\n愿你抬头时，正好有一片很轻的云。即使今天没有发生什么大事，你依然值得收到一封信。\n\n海风在这里等你，我也是。", claimed_at: new Date().toISOString() };
    claims.set(`${kind}:${letter.id}`, opened); return { ok: true, letter: opened };
  }
  if (options?.method === "POST" && pathname.endsWith("/letters")) {
    const letter = { id: crypto.randomUUID(), title: options.body.title, place_label: options.body.place_label, area: { latitude: 24.44, longitude: 118.07, radius_m: 300 } };
    privateLetters.push(letter); return { ok: true, letter, published: false };
  }
  if (options?.method === "POST") {
    const publication = { id: crypto.randomUUID(), title: options.body.public_title, public_place: options.body.public_place, owned: true, area: { latitude: Number(options.body.public_latitude), longitude: Number(options.body.public_longitude), radius_m: 2000 } };
    publicLetters.push(publication); return { ok: true, publication };
  }
  if (options?.method === "DELETE") { const id = pathname.split("/").at(-1), index = publicLetters.findIndex(letter => letter.id === id); if (index !== -1) publicLetters.splice(index, 1); claims.delete(`public:${id}`); return { ok: true, id, state: "withdrawn" }; }
  if (scenario === "empty") return page([]);
  if (pathname.endsWith("/collection")) return page([...claims.values()]);
  const kind = pathname.endsWith("/public") ? "public" : "private";
  return page((kind === "public" ? publicLetters : privateLetters).map(letter => claims.get(`${kind}:${letter.id}`) || letter));
};
createRoot(document.getElementById("root")).render(<>{!capture && <p style={{ padding: "10px 16px", margin: 0, background: "#fff3d8", color: "#70502e", fontSize: 12 }}>本地虚构预览 · 不获取真实定位、不调用模型、不上传内容</p>}<SurpriseMapContent request={request} isCurrent={() => true} aiName="小灯" locatePosition={async () => ({ latitude: 24.44, longitude: 118.07, accuracy: 8, captured_at: new Date().toISOString() })} /></>);
