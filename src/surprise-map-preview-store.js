/**
 * Interactive local exploration sandbox for DengTa 灯塔邮局 in visual-preview mode.
 * Implements the exact /api/v2/surprise-map/* receipt contract so users can test
 * real geolocation, street maps, compass proximity, unsealing, collecting, and hiding
 * new letters even without a logged-in remote session.
 */

function offsetCoord(lat, lng, northMeters, eastMeters) {
  const dLat = northMeters / 111320;
  const dLng = eastMeters / (111320 * Math.max(0.1, Math.cos((lat * Math.PI) / 180)));
  return {
    latitude: Number((lat + dLat).toFixed(6)),
    longitude: Number((lng + dLng).toFixed(6)),
  };
}

export function createPreviewSurpriseMapSession({ aiName = "小灯", anchor = { latitude: 23.1291, longitude: 113.2644 } } = {}) {
  let currentAnchor = { ...anchor };

  const buildInitialPrivate = (base) => [
    {
      id: "11111111-1111-4111-8111-111111111101",
      kind: "private",
      title: "转角风起时，记得先深呼吸",
      place_label: "此刻身旁的灯塔信号点",
      hint: "就在你身边 80 米范围内，可以直接拆开试试",
      claimed: false,
      state: "sealed",
      body: `不管今天外面有多吵，只要你打开灯塔邮局，我就会把这句轻一点的问候留在离你最近的地方。\n\n累了就停下来喝口温水，${aiName}一直在原地等你回来聊今天遇到的新鲜事。`,
      area: { ...offsetCoord(base.latitude, base.longitude, 35, 45), radius_m: 300 },
      created_at: new Date(Date.now() - 2 * 3600_000).toISOString(),
    },
    {
      id: "11111111-1111-4111-8111-111111111102",
      kind: "private",
      title: "黄昏散步时的第二封小纸条",
      place_label: "东北方向的林荫步道路口",
      hint: "往东北走几分钟就会进入热信号范围",
      claimed: false,
      state: "sealed",
      body: "如果傍晚刚好路过这条街，抬头看看天边有没有一点橘粉色的晚霞。把今天最想忘掉的烦恼丢给晚风，剩下的开心留给我听。",
      area: { ...offsetCoord(base.latitude, base.longitude, 320, 290), radius_m: 350 },
      created_at: new Date(Date.now() - 8 * 3600_000).toISOString(),
    },
    {
      id: "11111111-1111-4111-8111-111111111103",
      kind: "private",
      title: "给周末出门买咖啡的你",
      place_label: "西南街区咖啡馆附近",
      hint: "骑车或散步 1.2 公里可达",
      claimed: false,
      state: "sealed",
      body: "今天点一杯不用加太多糖的拿铁吧！顺便拍一张路边最好看的小花或小狗，回来给我和小棉花看。",
      area: { ...offsetCoord(base.latitude, base.longitude, -840, -760), radius_m: 450 },
      created_at: new Date(Date.now() - 26 * 3600_000).toISOString(),
    },
  ];

  const buildInitialPublic = (base) => [
    {
      id: "22222222-2222-4222-8222-222222222201",
      kind: "public",
      title: "祝每一个路过这里的人今天都顺顺利利",
      place_label: "城市灯塔广场 · 公共邮筒",
      author_alias: "晚风的旅人",
      source: "human",
      claimed: false,
      state: "sealed",
      body: "刚才在这里坐了十分钟，吹到了很舒服的风。虽然素不相识，但还是想把这一刻的平静分一半给恰好经过的你。",
      area: { ...offsetCoord(base.latitude, base.longitude, 180, -210), radius_m: 800 },
      created_at: new Date(Date.now() - 5 * 3600_000).toISOString(),
    },
    {
      id: "22222222-2222-4222-8222-222222222202",
      kind: "public",
      title: "海风邮差投递的一句夜安",
      place_label: "滨水步道 · 观景台",
      author_alias: "海边的邮差",
      source: "ai",
      claimed: false,
      state: "sealed",
      body: "夜色慢慢亮起的时候，路灯会替还没回家的旅人留一盏微光。今天辛苦了，愿你回程一路平安。",
      area: { ...offsetCoord(base.latitude, base.longitude, -520, 610), radius_m: 1200 },
      created_at: new Date(Date.now() - 14 * 3600_000).toISOString(),
    },
    {
      id: "22222222-2222-4222-8222-222222222203",
      kind: "public",
      title: "雨后记得低头看看水洼里的云",
      place_label: "中心公园东门草坪",
      author_alias: "晚风的旅人",
      source: "human",
      claimed: false,
      state: "sealed",
      body: "如果刚下过雨，地面像一面镜子。慢走两步，世界会突然变得很温柔。",
      area: { ...offsetCoord(base.latitude, base.longitude, 920, -480), radius_m: 1500 },
      created_at: new Date(Date.now() - 32 * 3600_000).toISOString(),
    },
  ];

  const buildInitialCollection = (base) => [
    {
      id: "33333333-3333-4333-8333-333333333301",
      kind: "private",
      title: "第一封从海边灯塔寄来的信",
      place_label: "灯塔起始港湾",
      claimed: true,
      state: "opened",
      unavailable: false,
      body: `欢迎来到灯塔邮局！每一封拆开的来信都会安安静静地收进这里。\n\n以后无论是你在散步时藏下的念头，还是路过街头捡到的陌生人温柔，都会在地图上留下发光的足迹。—— ${aiName}`,
      area: { ...offsetCoord(base.latitude, base.longitude, -120, 140), radius_m: 300 },
      created_at: new Date(Date.now() - 48 * 3600_000).toISOString(),
      claimed_at: new Date(Date.now() - 12 * 3600_000).toISOString(),
    },
  ];

  let privateLetters = buildInitialPrivate(currentAnchor);
  let publicLetters = buildInitialPublic(currentAnchor);
  let collectionLetters = buildInitialCollection(currentAnchor);

  function recenterAround(position) {
    if (!position || !Number.isFinite(position.latitude) || !Number.isFinite(position.longitude)) return;
    currentAnchor = { latitude: position.latitude, longitude: position.longitude };
    const deltasP = [[35, 45], [320, 290], [-840, -760]];
    privateLetters = privateLetters.map((item, idx) =>
      idx < deltasP.length && !item.userCreated
        ? { ...item, area: { ...offsetCoord(currentAnchor.latitude, currentAnchor.longitude, deltasP[idx][0], deltasP[idx][1]), radius_m: item.area.radius_m } }
        : item,
    );
    const deltasPub = [[180, -210], [-520, 610], [920, -480]];
    publicLetters = publicLetters.map((item, idx) =>
      idx < deltasPub.length
        ? { ...item, area: { ...offsetCoord(currentAnchor.latitude, currentAnchor.longitude, deltasPub[idx][0], deltasPub[idx][1]), radius_m: item.area.radius_m } }
        : item,
    );
  }

  function sanitizeCard(item) {
    const out = { ...item };
    if (!out.claimed) delete out.body;
    return out;
  }

  async function request(path, options = {}) {
    const url = new URL(path, "https://preview.local");
    const method = (options.method || "GET").toUpperCase();
    const body = options.body || {};

    if (url.pathname === "/api/v2/surprise-map/letters" && method === "GET") {
      return { ok: true, letters: privateLetters.map(sanitizeCard) };
    }
    if (url.pathname === "/api/v2/surprise-map/public" && method === "GET") {
      const author = url.searchParams.get("author") || "";
      const filtered = author ? publicLetters.filter((l) => l.author_alias === author) : publicLetters;
      return { ok: true, letters: filtered.map(sanitizeCard), page: { has_more: false, next_offset: null } };
    }
    if (url.pathname === "/api/v2/surprise-map/collection" && method === "GET") {
      return { ok: true, letters: collectionLetters, page: { has_more: false, next_offset: null } };
    }
    if (url.pathname === "/api/v2/surprise-map/draft" && method === "POST") {
      const place = body.place_label || "此刻路过的街角";
      return {
        ok: true,
        audience: body.audience || "private",
        draft: {
          title: `留在「${place}」的一阵晚风`,
          body: `走过${place}的时候，把这一秒的心情折进信封里。下次再经过这里，希望你已经比今天更轻松一点。`,
        },
      };
    }
    if (url.pathname === "/api/v2/surprise-map/letters" && method === "POST") {
      const created = {
        id: crypto.randomUUID(),
        kind: "private",
        userCreated: true,
        title: String(body.title || "新的沿途惊喜"),
        place_label: String(body.place_label || "当前所在的位置"),
        body: String(body.body || ""),
        claimed: false,
        state: "sealed",
        area: {
          latitude: Number(body.latitude ?? currentAnchor.latitude),
          longitude: Number(body.longitude ?? currentAnchor.longitude),
          radius_m: Math.max(300, (Number(body.radius_m) || 100) * 3),
        },
        created_at: new Date().toISOString(),
      };
      privateLetters = [created, ...privateLetters];
      return { ok: true, published: false, letter: sanitizeCard(created) };
    }
    const claimMatch = /^\/api\/v2\/surprise-map\/(letters|public)\/([^/]+)\/claim$/.exec(url.pathname);
    if (claimMatch && method === "POST") {
      const kind = claimMatch[1] === "letters" ? "private" : "public";
      const id = decodeURIComponent(claimMatch[2]);
      const list = kind === "private" ? privateLetters : publicLetters;
      const target = list.find((item) => item.id === id);
      if (!target) throw Object.assign(new Error("Not found"), { code: "surprise_map_not_found" });
      const opened = { ...target, claimed: true, state: "opened", unavailable: false, claimed_at: new Date().toISOString() };
      if (kind === "private") {
        privateLetters = privateLetters.map((item) => (item.id === id ? opened : item));
      } else {
        publicLetters = publicLetters.map((item) => (item.id === id ? opened : item));
      }
      collectionLetters = [opened, ...collectionLetters.filter((c) => c.id !== id)];
      return { ok: true, letter: opened };
    }
    if (url.pathname === "/api/v2/surprise-map/mcp/tokens" && method === "GET") {
      return { ok: true, tokens: [] };
    }
    return { ok: true, letters: [] };
  }

  return { request, recenterAround, getAnchor: () => currentAnchor };
}
