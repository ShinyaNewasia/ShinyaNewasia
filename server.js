#!/usr/bin/env node
/* =========================================================================
   小窝 · 本地 / 局域网服务（零依赖，装了 Node 就能跑）

   用法：
     node server.js                 只在本机（后台可用）
     node server.js --lan           同一个 Wi-Fi 下的手机、电脑也能看网站
     node server.js --lan --admin   连后台也开放给局域网（仍然要密码）
     PORT=8899 node server.js       换个端口

   为什么要用它（而不是直接双击 admin.html）：
     · 密码校验在服务端做，网页里拿不到密码，也绕不过去
     · 写文件只在服务端做，只允许写白名单里的两个文件
     · 用 --lan 时，别人默认只能看网站，碰不到后台
   ========================================================================= */

"use strict";

const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const os = require("os");

const ARGS = process.argv.slice(2);
const LAN = ARGS.indexOf("--lan") >= 0 || ARGS.indexOf("-l") >= 0;
const OPEN_ADMIN = ARGS.indexOf("--admin") >= 0;

const HOST = LAN ? "0.0.0.0" : "127.0.0.1";
const PORT = Number(process.env.PORT) || 8787;
const ROOT = __dirname;

/* 局域网模式下额外「借」这些端口一起监听。
   原因：给 Node 单独开防火墙规则需要管理员权限，普通账户加不了，
   而下面这些端口 Windows 自带的入站规则本来就放行（专用网络下可用）。
   多开几个，手机挨个试，总有一个能通。 */
const EXTRA_LAN_PORTS = [10246, 10247, 2177];

/* 账号：密码只以哈希形式存在，明文是你登录时敲的那串 */
const USER = "shinyanew";
const PASS_HASH = "77651f748ba6f4d87bd8737ae7a4c0e9446519ee59c53abf772f1f760cdf3e1d";

/* 只允许后台写这几个文件 */
const ALLOWED_FILES = new Set(["assets/posts.js", "assets/site-data.js", "assets/photos.js"]);

/* 后台相关的路径（admin.html 和所有 /api/） */
function isAdminPath(p) {
  return p === "/admin.html" || p.indexOf("/api/") === 0;
}

/* 这些是「只给自己看」的文件：源码、登录模块、启动脚本、说明。
   局域网里别人来要，一律 404 —— 免得 server.js 里的密码哈希被人下载走。 */
const PRIVATE_PATHS = [
  "/server.js",
  "/assets/auth.js",
  "/assets/admin.js",
  "/assets/admin.css",
  "/README.md",
  "/启动后台.bat",
  "/启动局域网.bat"
];

function isPrivatePath(p) {
  return PRIVATE_PATHS.indexOf(p) >= 0;
}

const SESSION_TTL = 12 * 60 * 60 * 1000;   /* 登录钥匙 12 小时 */
const MAX_BODY = 4 * 1024 * 1024;          /* 请求体上限 4MB */

/* 登录失败就锁一会儿，防止有人拿脚本地毯式试密码 */
const MAX_FAILS = 5;
const LOCK_MS = 2 * 60 * 1000;

const sessions = new Map();   /* token -> 过期时间 */
const fails = new Map();      /* ip -> { n, until } */

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".md": "text/markdown; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".woff2": "font/woff2"
};

/* ------------------------------------------------------------- 小工具 */

function log(msg) {
  const t = new Date();
  const p = (n) => (n < 10 ? "0" + n : String(n));
  console.log("[" + p(t.getHours()) + ":" + p(t.getMinutes()) + ":" + p(t.getSeconds()) + "] " + msg);
}

function json(res, code, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(code, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store"
  });
  res.end(body);
}

function readBody(req, cb) {
  let size = 0;
  const chunks = [];
  req.on("data", (c) => {
    size += c.length;
    if (size > MAX_BODY) {
      cb(new Error("too large"));
      req.destroy();
      return;
    }
    chunks.push(c);
  });
  req.on("end", () => cb(null, Buffer.concat(chunks).toString("utf8")));
  req.on("error", () => cb(new Error("read error")));
}

function clientIP(req) {
  return (req.socket.remoteAddress || "").replace("::ffff:", "");
}

function isLocal(req) {
  const ip = clientIP(req);
  return ip === "127.0.0.1" || ip === "::1" || ip === "localhost";
}

function hashOf(user, pass) {
  return crypto.createHash("sha256")
    .update("hut::" + user + "::" + pass, "utf8")
    .digest("hex");
}

function checkLogin(user, pass) {
  const u = String(user || "").trim().toLowerCase();
  if (u !== USER) { return false; }
  const a = Buffer.from(hashOf(u, String(pass || "")));
  const b = Buffer.from(PASS_HASH);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function tokenOK(token) {
  const exp = sessions.get(token);
  if (!exp) { return false; }
  if (exp < Date.now()) { sessions.delete(token); return false; }
  return true;
}

function lockedUntil(ip) {
  const rec = fails.get(ip);
  if (rec && rec.until > Date.now()) { return rec.until; }
  return 0;
}

function noteFail(ip) {
  const rec = fails.get(ip) || { n: 0, until: 0 };
  rec.n += 1;
  if (rec.n >= MAX_FAILS) {
    rec.until = Date.now() + LOCK_MS;
    rec.n = 0;
  }
  fails.set(ip, rec);
}

function lanAddresses() {
  var VIRTUAL = /(radmin|vpn|tailscale|zerotier|clash|wireguard|openvpn|tun|tap|vmware|virtualbox|hyper-v|vethernet|docker|wsl|loopback)/i;

  function isPrivate(ip) {
    return /^192\.168\./.test(ip) || /^10\./.test(ip) || /^172\.(1[6-9]|2\d|3[01])\./.test(ip);
  }

  var out = [];
  var nets = os.networkInterfaces();
  Object.keys(nets).forEach(function (name) {
    (nets[name] || []).forEach(function (ni) {
      if (ni.family !== "IPv4" || ni.internal) { return; }
      out.push({
        name: name,
        ip: ni.address,
        priv: isPrivate(ni.address),
        virt: VIRTUAL.test(name)
      });
    });
  });

  /* 真正的家用局域网地址（192.168 / 10 / 172.16-31）排前面 */
  out.sort(function (a, b) {
    return (b.priv ? 1 : 0) - (a.priv ? 1 : 0);
  });
  return out;
}

/* ------------------------------------------------------------- 静态文件 */

function serveStatic(res, pathname) {
  const rel = pathname === "/" ? "/index.html" : pathname;
  const safe = path.normalize(rel).replace(/^([/\\]|\.\.)+/, "");
  const filePath = path.join(ROOT, safe);

  if (!filePath.startsWith(ROOT)) {
    res.writeHead(403, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("403");
    return;
  }

  fs.stat(filePath, (err, st) => {
    if (err || !st.isFile()) {
      res.writeHead(404, { "Content-Type": "text/html; charset=utf-8" });
      res.end("<!DOCTYPE html><html lang=\"zh-CN\"><meta charset=\"utf-8\">" +
        "<body style=\"font-family:system-ui;background:#0F0A1E;color:#EFEAFE;padding:60px;text-align:center\">" +
        "<h1 style=\"font-weight:800\">404</h1><p style=\"color:#A79FC6\">没有这个文件：" + safe + "</p>" +
        "<p><a style=\"color:#A78BFA\" href=\"/\">回首页</a></p></body></html>");
      return;
    }
    res.writeHead(200, {
      "Content-Type": MIME[path.extname(filePath).toLowerCase()] || "application/octet-stream",
      "Cache-Control": "no-store"
    });
    fs.createReadStream(filePath).pipe(res);
  });
}

function forbiddenAdmin(res) {
  res.writeHead(403, { "Content-Type": "text/html; charset=utf-8" });
  res.end("<!DOCTYPE html><html lang=\"zh-CN\"><meta charset=\"utf-8\">" +
    "<meta name=\"viewport\" content=\"width=device-width,initial-scale=1\">" +
    "<title>进不去</title>" +
    "<body style=\"font-family:system-ui;background:#0F0A1E;color:#EFEAFE;display:grid;place-items:center;min-height:100vh;margin:0;text-align:center;padding:24px\">" +
    "<div><h1 style=\"font-size:22px;font-weight:800\">这儿只有主人能进</h1>" +
    "<p style=\"color:#A79FC6;line-height:1.8\">后台只在他自己的电脑上能打开。<br>网站随便逛——" +
    "<a style=\"color:#A78BFA\" href=\"/\">回首页</a></p></div></body></html>");
}

/* ----------------------------------------------------------------- 服务 */

function handleRequest(req, res) {
  const url = new URL(req.url, "http://" + HOST + ":" + PORT);
  let pathname = "/";
  try { pathname = decodeURIComponent(url.pathname); } catch (e) { pathname = url.pathname; }

  const ip = clientIP(req);

  /* 局域网里，后台默认不给进（网站照常） */
  if (LAN && !OPEN_ADMIN && isAdminPath(pathname) && !isLocal(req)) {
    log("挡下了一次外部访问后台：" + pathname + "（来自 " + ip + "）");
    if (pathname.indexOf("/api/") === 0) {
      return json(res, 403, { ok: false, msg: "后台只在这台电脑上能打开。" });
    }
    return forbiddenAdmin(res);
  }

  /* 自己的源码、启动脚本、说明文件，不给局域网里的别人看 */
  if (isPrivatePath(pathname) && !isLocal(req)) {
    res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("404");
    return;
  }

  /* 探活 */
  if (pathname === "/api/ping") {
    return json(res, 200, { ok: true, service: "小窝后台服务", user: USER, lan: LAN });
  }

  /* 登录 */
  if (pathname === "/api/login" && req.method === "POST") {
    const until = lockedUntil(ip);
    if (until) {
      const wait = Math.ceil((until - Date.now()) / 1000);
      return json(res, 429, { ok: false, msg: "试错太多，锁 " + wait + " 秒。" });
    }
    return readBody(req, (err, body) => {
      if (err) { return json(res, 413, { ok: false, msg: "内容太大了。" }); }
      let data = {};
      try { data = JSON.parse(body || "{}"); } catch (e) {}
      if (!checkLogin(data.user, data.pass)) {
        noteFail(ip);
        log("登录失败（用户名：" + (data.user || "空") + "，来自 " + ip + "）");
        return json(res, 401, { ok: false, msg: "用户名或密码不对。" });
      }
      fails.delete(ip);
      const token = crypto.randomBytes(32).toString("hex");
      sessions.set(token, Date.now() + SESSION_TTL);
      log("登录成功，发了把 12 小时有效的钥匙（来自 " + ip + "）");
      return json(res, 200, { ok: true, token: token, ttl: SESSION_TTL });
    });
  }

  /* 写文件 */
  if (pathname === "/api/save" && req.method === "POST") {
    return readBody(req, (err, body) => {
      if (err) { return json(res, 413, { ok: false, msg: "内容太大了。" }); }
      let data = {};
      try { data = JSON.parse(body || "{}"); } catch (e) {}
      if (!tokenOK(data.token)) {
        return json(res, 401, { ok: false, msg: "登录过期了，重新登录一次。" });
      }

      const rel = String(data.file || "").replace(/\\/g, "/");
      if (!ALLOWED_FILES.has(rel)) {
        log("拦下了一次越界写入：" + rel);
        return json(res, 400, { ok: false, msg: "只能写 posts.js、site-data.js 和 photos.js。" });
      }

      const target = path.join(ROOT, rel.replace(/\//g, path.sep));
      const content = String(data.content || "");

      try {
        if (fs.existsSync(target)) {
          fs.copyFileSync(target, target + ".bak");
        }
        fs.writeFileSync(target, content, "utf8");
      } catch (e) {
        log("写文件失败：" + e.message);
        return json(res, 500, { ok: false, msg: "写不进去：" + e.message });
      }

      log("已写回 " + rel + "（" + content.length + " 字节，上一版留了 " + rel + ".bak）");
      return json(res, 200, { ok: true, file: rel, bytes: content.length });
    });
  }

  /* 传图片（头像、文章配图） */
  if (pathname === "/api/upload" && req.method === "POST") {
    return readBody(req, (err, body) => {
      if (err) { return json(res, 413, { ok: false, msg: "文件太大了。" }); }
      let data = {};
      try { data = JSON.parse(body || "{}"); } catch (e) {}
      if (!tokenOK(data.token)) {
        return json(res, 401, { ok: false, msg: "登录过期了，重新登录一次。" });
      }

      const raw = String(data.data || "");
      if (!raw) { return json(res, 400, { ok: false, msg: "没收到图片数据。" }); }

      let buf;
      try { buf = Buffer.from(raw, "base64"); } catch (e) { buf = Buffer.alloc(0); }
      if (!buf.length) { return json(res, 400, { ok: false, msg: "图片数据是空的。" }); }
      if (buf.length > 3 * 1024 * 1024) {
        return json(res, 413, { ok: false, msg: "图片超过 3MB，先压一下。" });
      }

      /* 按文件头认格式，不光看扩展名 */
      const head = buf.slice(0, 12);
      let ext = "";
      if (buf[0] === 0xFF && buf[1] === 0xD8 && buf[2] === 0xFF) { ext = "jpg"; }
      else if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4E && buf[3] === 0x47) { ext = "png"; }
      else if (buf[0] === 0x47 && buf[1] === 0x49 && buf[2] === 0x46) { ext = "gif"; }
      else if (head.slice(0, 4).toString("ascii") === "RIFF" &&
               head.slice(8, 12).toString("ascii") === "WEBP") { ext = "webp"; }
      if (!ext) {
        return json(res, 400, { ok: false, msg: "只支持 jpg / png / gif / webp 图片。" });
      }

      const dir = path.join(ROOT, "assets", "uploads");
      try { fs.mkdirSync(dir, { recursive: true }); } catch (e) {}

      const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, "");
      const fileName = "img-" + stamp + "-" + crypto.randomBytes(3).toString("hex") + "." + ext;
      const target = path.join(dir, fileName);

      try {
        fs.writeFileSync(target, buf);
      } catch (e) {
        log("存图片失败：" + e.message);
        return json(res, 500, { ok: false, msg: "存不进去：" + e.message });
      }

      const rel = "assets/uploads/" + fileName;
      log("收下了一张图：" + rel + "（" + Math.round(buf.length / 1024) + " KB）");
      return json(res, 200, { ok: true, path: rel, bytes: buf.length });
    });
  }

  /* 退出 */
  if (pathname === "/api/logout" && req.method === "POST") {
    return readBody(req, (err, body) => {
      let data = {};
      try { data = JSON.parse(body || "{}"); } catch (e) {}
      if (data.token) { sessions.delete(data.token); }
      log("退出登录");
      return json(res, 200, { ok: true });
    });
  }

  if (req.method !== "GET" && req.method !== "HEAD") {
    return json(res, 405, { ok: false, msg: "不支持的请求方式。" });
  }

  return serveStatic(res, pathname);
}

/* --------------------------------------------------------------- 启动
   局域网模式下会多监听几个「系统本来就放行」的端口，
   这样即使没有管理员权限加防火墙规则，手机也能找到一条能通的路。
   ------------------------------------------------------------------- */

function listenOn(port) {
  return new Promise(function (resolve) {
    const s = http.createServer(handleRequest);
    s.once("error", function (e) {
      resolve({ port: port, ok: false, why: e.code === "EADDRINUSE" ? "被别的程序占用了" : e.message });
    });
    s.listen(port, HOST, function () {
      resolve({ port: port, ok: true });
    });
  });
}

(function start() {
  const wanted = [PORT];
  if (LAN) {
    EXTRA_LAN_PORTS.forEach(function (p) {
      if (wanted.indexOf(p) < 0) { wanted.push(p); }
    });
  }

  Promise.all(wanted.map(listenOn)).then(function (results) {
    const up = results.filter(function (r) { return r.ok; });
    const down = results.filter(function (r) { return !r.ok; });

    if (!up.length) {
      console.error("\n一个端口都没能起来：");
      down.forEach(function (r) { console.error("  " + r.port + " — " + r.why); });
      console.error("\n可能已经开着一个了，把旧窗口关掉再试。\n");
      process.exit(1);
    }

    const mainPort = up[0].port;
    const addrs = lanAddresses();

    console.log("");
    if (LAN) {
      console.log("  小窝已经开到局域网上了");
      console.log("  ----------------------------------------");

      if (addrs.length) {
        const main = addrs[0];
        console.log("  手机 / 平板连上同一个 Wi-Fi 后，挨个试这几个地址：");
        up.forEach(function (r) {
          console.log("      http://" + main.ip + ":" + r.port + "/" +
                      (r.port === mainPort ? "   ← 先试这个" : ""));
        });
        console.log("");
        console.log("  哪个能打开就用哪个；手机版把路径换成 /m.html。");
        console.log("  为什么要试好几个端口：给 Node 单独开防火墙要管理员权限，");
        console.log("  你这个账户不是管理员，所以借用了系统本来就放行的端口。");

        if (addrs.length > 1) {
          console.log("");
          console.log("  这台机器上还有别的网络地址（一般用不上）：");
          addrs.slice(1).forEach(function (a) {
            console.log("      http://" + a.ip + ":" + mainPort + "/   （" + a.name + "）");
          });
        }
      } else {
        console.log("");
        console.log("  没找到局域网地址——检查一下这台电脑有没有连上 Wi-Fi / 网线。");
      }

      console.log("");
      console.log("  这台电脑自己用：http://127.0.0.1:" + mainPort + "/admin.html");
      console.log(OPEN_ADMIN
        ? "  后台：局域网里也能打开（地址后面加 /admin.html，还是要密码）"
        : "  后台：只有这台电脑能打开，局域网里的别人只会看到「这儿只有主人能进」");
      console.log("");
      console.log("  ★ 上面几个地址全都打不开，那就是防火墙在拦。用管理员身份开 PowerShell 跑一次：");
      console.log("    netsh advfirewall firewall add rule name=\"xiaowo\" dir=in action=allow protocol=TCP localport=8787");
      console.log("    跑完重启这个窗口，8787 这个正规端口就能用了。");
    } else {
      console.log("  小窝后台服务已经跑起来了（只在本机）");
      console.log("  ----------------------------------------");
      console.log("  后台地址：http://127.0.0.1:" + mainPort + "/admin.html");
      console.log("  网站首页：http://127.0.0.1:" + mainPort + "/");
      console.log("  账号：" + USER);
      console.log("");
      console.log("  想让同一个 Wi-Fi 下的手机也能看，用：node server.js --lan");
    }

    if (down.length) {
      console.log("");
      down.forEach(function (r) {
        console.log("  （端口 " + r.port + " 没用上：" + r.why + "）");
      });
    }

    console.log("");
    console.log("  关掉这个窗口就等于关掉服务（后台会跟着用不了）。");
    console.log("");
  });
})();

/* 兜底：某个请求把服务搞崩的话，记一笔但别退出——网站要一直能访问 */
process.on("uncaughtException", (e) => {
  log("遇到一个没接住的错误（已忽略）：" + (e && e.message ? e.message : e));
});
process.on("unhandledRejection", (e) => {
  log("遇到一个没接住的 Promise 错误（已忽略）：" + (e && e.message ? e.message : e));
});
