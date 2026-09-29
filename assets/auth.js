/* =========================================================================
   小窝 · 后台登录
   密码不存明文，只存哈希（sha256("hut::用户名::密码")）。
   注意：这是纯网页的验证，能挡住随手点进来的人，挡不住会改代码的人。
   要真正只有你能进，用文件夹里的 server.js 启动本地服务，
   那样密码校验和写文件都在服务端完成。
   ========================================================================= */

window.HUT_AUTH = (function () {
  "use strict";

  var USER = "shinyanew";
  var PASS_HASH = "77651f748ba6f4d87bd8737ae7a4c0e9446519ee59c53abf772f1f760cdf3e1d";
  var SESSION_KEY = "hut-session";
  var SESSION_DAYS = 7;
  var MAX_TRIES = 5;
  var LOCK_MS = 30000;

  var mem = { session: null, tries: 0, lockedUntil: 0 };

  /* ------------------------------------------- SHA-256（纯 JS 实现）
     file:// 下有时拿不到 Web Crypto，所以自己算，行为稳定。 */

  function sha256hex(msg) {
    function rrot(x, n) { return (x >>> n) | (x << (32 - n)); }

    var K = [
      0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
      0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
      0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
      0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
      0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
      0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
      0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
      0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2
    ];
    var H = [
      0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a,
      0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19
    ];

    /* 先转成 UTF-8 字节 */
    var bytes = [];
    var s = "";
    try { s = unescape(encodeURIComponent(String(msg))); }
    catch (e) { s = String(msg); }
    for (var i = 0; i < s.length; i++) { bytes.push(s.charCodeAt(i) & 0xff); }

    var bitLen = bytes.length * 8;
    bytes.push(0x80);
    while (bytes.length % 64 !== 56) { bytes.push(0); }

    var hi = Math.floor(bitLen / 4294967296);
    var lo = bitLen >>> 0;
    bytes.push((hi >>> 24) & 255, (hi >>> 16) & 255, (hi >>> 8) & 255, hi & 255);
    bytes.push((lo >>> 24) & 255, (lo >>> 16) & 255, (lo >>> 8) & 255, lo & 255);

    for (var off = 0; off < bytes.length; off += 64) {
      var w = new Array(64);
      for (i = 0; i < 16; i++) {
        var j = off + i * 4;
        w[i] = (bytes[j] << 24) | (bytes[j + 1] << 16) | (bytes[j + 2] << 8) | bytes[j + 3];
      }
      for (i = 16; i < 64; i++) {
        var x = w[i - 15], y = w[i - 2];
        var s0 = rrot(x, 7) ^ rrot(x, 18) ^ (x >>> 3);
        var s1 = rrot(y, 17) ^ rrot(y, 19) ^ (y >>> 10);
        w[i] = (w[i - 16] + s0 + w[i - 7] + s1) | 0;
      }

      var a = H[0], b = H[1], c = H[2], d = H[3], e = H[4], f = H[5], g = H[6], h = H[7];

      for (i = 0; i < 64; i++) {
        var S1 = rrot(e, 6) ^ rrot(e, 11) ^ rrot(e, 25);
        var ch = (e & f) ^ (~e & g);
        var t1 = (h + S1 + ch + K[i] + w[i]) | 0;
        var S0 = rrot(a, 2) ^ rrot(a, 13) ^ rrot(a, 22);
        var maj = (a & b) ^ (a & c) ^ (b & c);
        var t2 = (S0 + maj) | 0;
        h = g; g = f; f = e; e = (d + t1) | 0;
        d = c; c = b; b = a; a = (t1 + t2) | 0;
      }

      H[0] = (H[0] + a) | 0; H[1] = (H[1] + b) | 0; H[2] = (H[2] + c) | 0; H[3] = (H[3] + d) | 0;
      H[4] = (H[4] + e) | 0; H[5] = (H[5] + f) | 0; H[6] = (H[6] + g) | 0; H[7] = (H[7] + h) | 0;
    }

    return H.map(function (n) {
      return ("00000000" + (n >>> 0).toString(16)).slice(-8);
    }).join("");
  }

  function passHash(user, pass) {
    return sha256hex("hut::" + user + "::" + pass);
  }

  /* --------------------------------------------- 存储（用不了就跳过） */

  function lsGet(k) { try { return window.localStorage.getItem(k); } catch (e) { return null; } }
  function lsSet(k, v) { try { window.localStorage.setItem(k, v); return true; } catch (e) { return false; } }
  function lsDel(k) { try { window.localStorage.removeItem(k); } catch (e) {} }

  /* -------------------------------------------------------- 会话 */

  function saveSession(remember, token) {
    var data = {
      u: USER,
      exp: Date.now() + SESSION_DAYS * 86400000,
      token: token || ""
    };
    mem.session = data;
    if (remember) { lsSet(SESSION_KEY, JSON.stringify(data)); }
    return data;
  }

  function loadSession() {
    if (mem.session && mem.session.exp > Date.now()) { return mem.session; }
    var raw = lsGet(SESSION_KEY);
    if (!raw) { return null; }
    try {
      var d = JSON.parse(raw);
      if (d && d.u === USER && d.exp > Date.now()) {
        mem.session = d;
        return d;
      }
    } catch (e) {}
    lsDel(SESSION_KEY);
    return null;
  }

  function clearSession() {
    mem.session = null;
    lsDel(SESSION_KEY);
  }

  /* ------------------------------------------------------ 登录校验 */

  function locked() { return mem.lockedUntil > Date.now(); }
  function lockLeft() { return Math.max(0, Math.ceil((mem.lockedUntil - Date.now()) / 1000)); }

  function login(user, pass) {
    if (locked()) {
      return Promise.resolve({ ok: false, msg: "试错太多，等 " + lockLeft() + " 秒再试。" });
    }
    var u = String(user || "").trim().toLowerCase();
    var p = String(pass || "");
    if (!u || !p) {
      return Promise.resolve({ ok: false, msg: "用户名和密码都要填。" });
    }

    var ok = (u === USER) && (passHash(u, p) === PASS_HASH);

    if (!ok) {
      mem.tries += 1;
      if (mem.tries >= MAX_TRIES) {
        mem.tries = 0;
        mem.lockedUntil = Date.now() + LOCK_MS;
        return Promise.resolve({ ok: false, msg: "错太多次了，锁 " + (LOCK_MS / 1000) + " 秒。" });
      }
      return Promise.resolve({ ok: false, msg: "用户名或密码不对。" + (MAX_TRIES - mem.tries) + " 次之后就锁。" });
    }

    mem.tries = 0;
    return Promise.resolve({ ok: true });
  }

  return {
    user: USER,
    login: login,
    loadSession: loadSession,
    saveSession: saveSession,
    clearSession: clearSession,
    locked: locked,
    lockLeft: lockLeft,
    sha256hex: sha256hex
  };
})();
