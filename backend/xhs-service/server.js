"use strict";

// 小红书服务:扫码登录(旧协议被风控封锁,用无头 Chrome 浏览器登录)
// + xhs-api CLI 读操作 + Puppeteer 页面点击写操作(点赞/评论/关注)。
// 仅供学习交流;写操作有封号风险,需用户确认。

const express = require("express");
const fs = require("fs");
const { execFile } = require("child_process");
const puppeteer = require("puppeteer-core");

const PORT = Number(process.env.PORT || 8080);
const SERVICE_TOKEN = String(process.env.XHS_SERVICE_TOKEN || "change-me");
const COOKIE_FILE = process.env.XHS_COOKIE_FILE || "/data/cookies.json";
const PROFILE_DIR = process.env.XHS_CHROME_PROFILE || "/data/chrome-profile";
const CHROME_PATH = process.env.XHS_CHROME_PATH || "/usr/bin/chromium";

const app = express();
app.use(express.json({ limit: "1mb" }));

// ---------- 鉴权 + 限速 ----------
function auth(req, res, next) {
  const token = String(req.get("x-api-key") || "");
  if (token !== SERVICE_TOKEN) {
    return res.status(401).json({ error: "unauthorized", message: "服务令牌不正确。" });
  }
  next();
}
const windows = new Map();
function rateLimit(kind, perMinute) {
  return (req, res, next) => {
    const key = (req.ip || "local") + ":" + kind;
    const now = Date.now();
    const win = windows.get(key) || { start: now, count: 0 };
    if (now - win.start > 60000) {
      win.start = now;
      win.count = 0;
    }
    win.count += 1;
    windows.set(key, win);
    if (win.count > perMinute) {
      return res.status(429).json({ error: "rate_limited", message: "操作太频繁,稍后再试。" });
    }
    next();
  };
}

// ---------- xhs-api CLI ----------
function readCookies() {
  try {
    const raw = JSON.parse(fs.readFileSync(COOKIE_FILE, "utf8"));
    return String(raw.cookies || raw.Cookies || "").trim();
  } catch {
    return "";
  }
}
function runXhs(args, { timeoutMs = 60000 } = {}) {
  return new Promise((resolve, reject) => {
    const cookies = readCookies();
    const env = { ...process.env, XHS_COOKIES: cookies };
    execFile("xhs-api", args, { env, timeout: timeoutMs, maxBuffer: 4 * 1024 * 1024 }, (error, stdout, stderr) => {
      if (error) {
        let detail = String(stderr || "").trim();
        try { detail = JSON.parse(detail).message || detail; } catch { /* keep raw */ }
        return reject(Object.assign(new Error(detail || error.message), { code: "cli_error" }));
      }
      try {
        resolve(JSON.parse(stdout));
      } catch {
        reject(Object.assign(new Error("解析 xhs-api 输出失败。"), { code: "parse_error" }));
      }
    });
  });
}

// ---------- 浏览器 ----------
let browserPromise = null;
function getBrowser() {
  if (!browserPromise) {
    browserPromise = puppeteer.launch({
      executablePath: CHROME_PATH,
      headless: "new",
      userDataDir: PROFILE_DIR,
      args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage", "--lang=zh-CN"]
    }).catch((error) => { browserPromise = null; throw error; });
  }
  return browserPromise;
}

// ---------- 登录会话 ----------
const loginSessions = new Map();
function startLoginWatcher(sessionId, page) {
  loginSessions.set(sessionId, { status: "pending", startedAt: Date.now(), cookieOk: false });
  const timer = setInterval(async () => {
    const session = loginSessions.get(sessionId);
    if (!session) return clearInterval(timer);
    try {
      const cookies = await page.cookies();
      const webSession = cookies.find((c) => c.name === "web_session");
      if (webSession?.value) {
        const all = cookies.map((c) => c.name + "=" + c.value).join("; ");
        fs.writeFileSync(COOKIE_FILE, JSON.stringify({ cookies: all }, null, 2), { mode: 0o600 });
        session.status = "done";
        session.cookieOk = true;
        clearInterval(timer);
        await page.close().catch(() => {});
      } else if (Date.now() - session.startedAt > 5 * 60 * 1000) {
        session.status = "expired";
        clearInterval(timer);
        await page.close().catch(() => {});
      }
    } catch {
      // 页面关闭等异常按 pending 处理。
    }
  }, 2000);
}

// ---------- 通用无头浏览(灯塔内置浏览器:手机用户零负担,全部在服务器执行) ----------

// 抓取网页正文与截图。
app.get("/browse", auth, rateLimit("browse", 20), async (req, res, next) => {
    try {
        const url = String(req.query.url || "").trim();
        if (!/^https?:\/\//i.test(url)) {
            return res.status(400).json({ error: "url_invalid", message: "请提供 http(s):// 链接。" });
        }
        const wantScreenshot = req.query.screenshot === "1";
        const browser = await getBrowser();
        const page = await browser.newPage();
        await page.setUserAgent(
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36"
        );
        await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45000 });
        await new Promise((r) => setTimeout(r, 2500));
        const text = await page.evaluate(() => {
            const clone = document.body ? document.body.cloneNode(true) : null;
            if (!clone) return "";
            clone.querySelectorAll("script,style,noscript").forEach((node) => node.remove());
            return (clone.innerText || "").replace(/\n{3,}/g, "\n\n").trim().slice(0, 12000);
        });
        const title = await page.title();
        let screenshot = "";
        if (wantScreenshot) {
            screenshot = await page.screenshot({ encoding: "base64", type: "jpeg", quality: 70, fullPage: false });
        }
        await page.close().catch(() => {});
        res.json({ url, title: String(title || "").slice(0, 200), text, screenshot: screenshot ? "data:image/jpeg;base64," + screenshot : "" });
    } catch (error) {
        next(error);
    }
});

// 无头搜索(必应国际版,无需密钥;中国网络环境下服务器须能访问 bing.com)。
app.get("/search", auth, rateLimit("search", 20), async (req, res, next) => {
    try {
        const query = String(req.query.q || "").trim().slice(0, 200);
        if (!query) {
            return res.status(400).json({ error: "query_required", message: "缺少搜索关键词。" });
        }
        const browser = await getBrowser();
        const page = await browser.newPage();
        await page.setUserAgent(
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36"
        );
        await page.goto("https://www.bing.com/search?q=" + encodeURIComponent(query) + "&setlang=zh-hans&count=10", {
            waitUntil: "domcontentloaded",
            timeout: 45000
        });
        await new Promise((r) => setTimeout(r, 2500));
        const results = await page.evaluate(() =>
            Array.from(document.querySelectorAll("li.b_algo"))
                .slice(0, 10)
                .map((item) => ({
                    title: (item.querySelector("h2")?.innerText || "").trim().slice(0, 160),
                    url: item.querySelector("h2 a")?.href || "",
                    snippet: (item.querySelector(".b_caption p, .b_caption")?.innerText || "").trim().slice(0, 300)
                }))
                .filter((row) => row.title && row.url)
        );
        await page.close().catch(() => {});
        res.json({ query, results });
    } catch (error) {
        next(error);
    }
});

// ---------- 端点 ----------
app.get("/health", (req, res) => res.json({ ok: true, cookie: Boolean(readCookies()) }));

app.post("/login/start", auth, rateLimit("login", 3), async (req, res, next) => {
  try {
    const browser = await getBrowser();
    const page = await browser.newPage();
    await page.setUserAgent(
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36"
    );
    await page.goto("https://www.xiaohongshu.com/explore", { waitUntil: "domcontentloaded", timeout: 45000 });
    await page.waitForSelector("img.qrcode-img, img[class*='qrcode'], img[class*='qr']", { timeout: 20000 }).catch(() => {});
    await new Promise((r) => setTimeout(r, 2000));
    const shot = await page.screenshot({ encoding: "base64", type: "png" });
    const sessionId = require("crypto").randomUUID();
    startLoginWatcher(sessionId, page);
    res.json({ session: sessionId, qr: "data:image/png;base64," + shot, expires_in: 300 });
  } catch (error) {
    next(error);
  }
});

app.get("/login/status", auth, (req, res) => {
  const session = loginSessions.get(String(req.query.session || ""));
  if (!session) return res.status(404).json({ error: "session_missing", message: "登录会话不存在或已过期。" });
  res.json({ status: session.status, cookie_ok: session.cookieOk });
});

// 退出登录:清除本地 cookie 并关闭浏览器 profile
app.delete("/logout", auth, async (req, res, next) => {
  try {
    if (browserPromise) {
      try { await (await browserPromise).close(); } catch { /* 忽略 */ }
      browserPromise = null;
    }
    try { fs.unlinkSync(COOKIE_FILE); } catch { /* 忽略 */ }
    res.json({ ok: true, message: "已退出登录。" });
  } catch (error) {
    next(error);
  }
});

app.get("/me", auth, rateLimit("me", 10), async (req, res, next) => {
  try {
    const info = await runXhs(["verify"]);
    res.json({ cookie_ok: true, info });
  } catch (error) {
    res.status(401).json({ error: "cookie_expired", message: "登录态无效,请重新扫码登录。" });
  }
});

app.get("/search", auth, rateLimit("read", 30), async (req, res, next) => {
  try {
    const keyword = String(req.query.keyword || "").trim().slice(0, 60);
    if (!keyword) return res.status(400).json({ error: "keyword_required", message: "缺少搜索关键词。" });
    const page = Math.max(1, Math.min(10, Number(req.query.page) || 1));
    const sort = String(req.query.sort || "1");
    const result = await runXhs(["search", keyword, "--page", String(page), "--sort", sort, "--json"]);
    res.json({ items: result.items || [], has_more: result.has_more === true, search_id: result.search_id || "" });
  } catch (error) {
    next(error);
  }
});

app.get("/notes/:id/comments", auth, rateLimit("read", 30), async (req, res, next) => {
  try {
    const id = String(req.params.id || "").slice(0, 80);
    const result = await runXhs(["comments", id, "--json"]);
    res.json({ comments: result.items || [] });
  } catch (error) {
    next(error);
  }
});

app.post("/notes/:id/like", auth, rateLimit("write", 5), async (req, res, next) => {
  try {
    const id = String(req.params.id || "").slice(0, 80);
    const browser = await getBrowser();
    const page = await browser.newPage();
    await page.goto("https://www.xiaohongshu.com/explore/" + id, { waitUntil: "domcontentloaded", timeout: 45000 });
    await new Promise((r) => setTimeout(r, 2500));
    const clicked = await page.evaluate(() => {
      const candidates = Array.from(document.querySelectorAll("[class*='like'], button")).filter((el) => {
        const text = (el.innerText || el.getAttribute("aria-label") || "").trim();
        return text === "赞" || /点赞/.test(text) || (el.className && typeof el.className === "string" && /like/i.test(el.className));
      });
      if (!candidates.length) return false;
      candidates[0].click();
      return true;
    });
    await page.close().catch(() => {});
    res.json({ ok: clicked, note: clicked ? "已点赞。" : "页面上没有找到点赞按钮(可能需要先确认登录态)。" });
  } catch (error) {
    next(error);
  }
});

app.post("/notes/:id/comment", auth, rateLimit("write", 5), async (req, res, next) => {
  try {
    const id = String(req.params.id || "").slice(0, 80);
    const content = String(req.body?.content || "").trim().slice(0, 200);
    if (!content) return res.status(400).json({ error: "content_required", message: "评论内容不能为空。" });
    const browser = await getBrowser();
    const page = await browser.newPage();
    await page.goto("https://www.xiaohongshu.com/explore/" + id, { waitUntil: "domcontentloaded", timeout: 45000 });
    await new Promise((r) => setTimeout(r, 2500));
    const posted = await page.evaluate((text) => {
      const box = document.querySelector("[contenteditable='true'], textarea");
      if (!box) return { ok: false, reason: "no_comment_box" };
      box.focus();
      if (box.tagName === "TEXTAREA") box.value = text;
      else box.innerText = text;
      box.dispatchEvent(new Event("input", { bubbles: true }));
      return { ok: true, reason: "typed" };
    }, content);
    await new Promise((r) => setTimeout(r, 800));
    if (posted.ok) {
      await page.evaluate(() => {
        const buttons = Array.from(document.querySelectorAll("button, [role='button']")).filter((el) => /发布|发送|评论/.test((el.innerText || "").trim()));
        if (buttons.length) buttons[buttons.length - 1].click();
      });
    }
    await page.close().catch(() => {});
    res.json({ ok: posted.ok, detail: posted.reason === "typed" ? "已填写评论框(发布按钮已尝试点击)。" : "页面没有找到评论输入框。" });
  } catch (error) {
    next(error);
  }
});

app.post("/users/:uid/follow", auth, rateLimit("write", 5), async (req, res, next) => {
  try {
    const uid = String(req.params.uid || "").slice(0, 80);
    const browser = await getBrowser();
    const page = await browser.newPage();
    await page.goto("https://www.xiaohongshu.com/user/profile/" + uid, { waitUntil: "domcontentloaded", timeout: 45000 });
    await new Promise((r) => setTimeout(r, 2500));
    const clicked = await page.evaluate(() => {
      const buttons = Array.from(document.querySelectorAll("button, [role='button']")).filter((el) => /关注/.test((el.innerText || "").trim()));
      if (!buttons.length) return false;
      buttons[0].click();
      return true;
    });
    await page.close().catch(() => {});
    res.json({ ok: clicked, note: clicked ? "已点击关注。" : "页面没有找到关注按钮。" });
  } catch (error) {
    next(error);
  }
});

app.use((error, req, res, next) => {
  console.error("xhs-service error:", error?.message || String(error));
  res.status(502).json({ error: error?.code || "upstream_error", message: String(error?.message || "小红书服务暂时失败。").slice(0, 200) });
});

app.listen(PORT, () => {
  console.log("xhs-service listening on :" + PORT + " cookie=" + Boolean(readCookies()));
});
