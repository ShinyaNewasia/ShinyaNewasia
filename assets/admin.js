/* =========================================================================
   小窝 · 后台脚本
   登录 -> 编辑 -> 生成 posts.js / site-data.js -> 写回文件
   写回有两条路：
     · 服务端模式（用 server.js 启动的）：POST 给本地服务，它校验密码并写文件
     · 本地文件模式（直接双击 admin.html）：浏览器文件接口，不行就下载
   ========================================================================= */

(function () {
  "use strict";

  var $ = function (s, el) { return (el || document).querySelector(s); };
  var $$ = function (s, el) {
    return Array.prototype.slice.call((el || document).querySelectorAll(s));
  };

  function clone(o) { return JSON.parse(JSON.stringify(o)); }

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  function debounce(fn, ms) {
    var t;
    return function () {
      var args = arguments, self = this;
      clearTimeout(t);
      t = setTimeout(function () { fn.apply(self, args); }, ms);
    };
  }

  function pad2(n) { return n < 10 ? "0" + n : String(n); }
  function today() {
    var d = new Date();
    return d.getFullYear() + "-" + pad2(d.getMonth() + 1) + "-" + pad2(d.getDate());
  }

  /* ------------------------------------------------------------ 数据 */

  var draft = {
    site: clone(window.SITE || {}),
    posts: clone(window.POSTS || [])
  };
  var dirty = { site: false, posts: false };
  var mdCache = {};
  var curIdx = 0;

  function getPath(obj, path) {
    return path.split(".").reduce(function (o, k) { return o == null ? undefined : o[k]; }, obj);
  }
  function setPath(obj, path, value) {
    var parts = path.split(".");
    var last = parts.pop();
    var target = parts.reduce(function (o, k) {
      if (o[k] == null) { o[k] = {}; }
      return o[k];
    }, obj);
    target[last] = value;
  }

  /* ============================================================ Markdown */

  function inlineMd(s) {
    s = esc(s);
    s = s.replace(/`([^`]+)`/g, "<code>$1</code>");
    /* 图片必须放在链接前面处理，否则 ![..](..) 会被当成链接 */
    s = s.replace(/!\[([^\]]*)\]\(([^)\s]+)\)/g, '<img alt="$1" src="$2">');
    s = s.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
    s = s.replace(/(^|[^*])\*([^*\s][^*]*)\*/g, "$1<em>$2</em>");
    s = s.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, '<a href="$2">$1</a>');
    return s;
  }

  /* 视频：本地文件用 <video>，B 站 / YouTube 自动换成正儿八经的嵌入地址 */
  function videoHTML(url, caption) {
    var src = String(url || "");
    var embed = false;

    var bv = src.match(/bilibili\.com\/video\/(BV[0-9A-Za-z]+)/);
    if (bv) {
      src = "https://player.bilibili.com/player.html?bvid=" + bv[1] + "&high_quality=1&danmaku=0";
      embed = true;
    }

    var yt = src.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/)([A-Za-z0-9_-]{6,})/);
    if (yt) {
      src = "https://www.youtube.com/embed/" + yt[1];
      embed = true;
    }

    if (/^https?:\/\/(player\.bilibili\.com|www\.youtube\.com\/embed|player\.vimeo\.com)/.test(src)) {
      embed = true;
    }

    var body = embed
      ? '<div class="video-embed"><iframe src="' + esc(src) +
        '" allowfullscreen loading="lazy" referrerpolicy="no-referrer"></iframe></div>'
      : '<video controls preload="metadata" src="' + esc(src) + '"></video>';

    return caption
      ? "<figure>" + body + "<figcaption>" + esc(caption) + "</figcaption></figure>"
      : body;
  }

  function mdToHtml(md) {
    var lines = String(md || "").replace(/\r\n/g, "\n").split("\n");
    var out = [], para = [], ul = [], ol = [], quote = [], code = [];
    var inCode = false;

    function flushPara() {
      if (para.length) { out.push("<p>" + inlineMd(para.join(" ")) + "</p>"); para = []; }
    }
    function flushUl() {
      if (ul.length) { out.push("<ul>" + ul.map(function (x) { return "<li>" + x + "</li>"; }).join("") + "</ul>"); ul = []; }
    }
    function flushOl() {
      if (ol.length) { out.push("<ol>" + ol.map(function (x) { return "<li>" + x + "</li>"; }).join("") + "</ol>"); ol = []; }
    }
    function flushQuote() {
      if (quote.length) { out.push("<blockquote><p>" + inlineMd(quote.join(" ")) + "</p></blockquote>"); quote = []; }
    }
    function flushAll() { flushPara(); flushUl(); flushOl(); flushQuote(); }

    lines.forEach(function (line) {
      if (/^```/.test(line.trim())) {
        if (inCode) {
          out.push("<pre><code>" + esc(code.join("\n")) + "</code></pre>");
          code = []; inCode = false;
        } else {
          flushAll(); inCode = true;
        }
        return;
      }
      if (inCode) { code.push(line); return; }
      if (!line.trim()) { flushAll(); return; }

      /* 单独一行写 !video[说明](地址) 就是一段视频 */
      var vid = line.match(/^!video\[([^\]]*)\]\(([^)\s]+)\)$/);
      if (vid) {
        flushAll();
        out.push(videoHTML(vid[2], vid[1]));
        return;
      }

      /* 单独一行写 ![说明](地址) 就是一张带图注的大图 */
      var pic = line.match(/^!\[([^\]]*)\]\(([^)\s]+)\)$/);
      if (pic) {
        flushAll();
        out.push(pic[1]
          ? '<figure><img alt="' + esc(pic[1]) + '" src="' + esc(pic[2]) +
            '"><figcaption>' + esc(pic[1]) + "</figcaption></figure>"
          : '<img alt="" src="' + esc(pic[2]) + '">');
        return;
      }

      var h = line.match(/^(#{1,4})\s+(.*)$/);
      if (h) {
        flushAll();
        var lvl = h[1].length;
        out.push("<h" + lvl + ">" + inlineMd(h[2]) + "</h" + lvl + ">");
        return;
      }

      if (/^(-{3,}|\*{3,}|_{3,})$/.test(line.trim())) { flushAll(); out.push("<hr>"); return; }
      if (/^>\s?/.test(line)) { flushPara(); flushUl(); flushOl(); quote.push(line.replace(/^>\s?/, "")); return; }

      var mUl = line.match(/^\s*[-*+]\s+(.*)$/);
      if (mUl) { flushPara(); flushOl(); flushQuote(); ul.push(inlineMd(mUl[1])); return; }

      var mOl = line.match(/^\s*\d+[.)]\s+(.*)$/);
      if (mOl) { flushPara(); flushUl(); flushQuote(); ol.push(inlineMd(mOl[1])); return; }

      flushUl(); flushOl(); flushQuote();
      para.push(line.trim());
    });

    if (inCode && code.length) { out.push("<pre><code>" + esc(code.join("\n")) + "</code></pre>"); }
    flushAll();
    return out.join("\n");
  }

  function decodeEnt(s) {
    return String(s)
      .replace(/&lt;/g, "<").replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"').replace(/&#39;/g, "'")
      .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&");
  }

  function htmlToMd(html) {
    var s = String(html || "");

    s = s.replace(/<pre[^>]*><code[^>]*>([\s\S]*?)<\/code><\/pre>/gi, function (m, c) {
      return "\n```\n" + decodeEnt(c).replace(/\s+$/, "") + "\n```\n";
    });

    /* 图（figure 里那张） */
    s = s.replace(/<figure>([\s\S]*?)<\/figure>/gi, function (m, inner) {
      var img = inner.match(/<img[^>]*src="([^"]*)"[^>]*>/i);
      if (!img) { return inner; }
      var cap = inner.match(/<figcaption[^>]*>([\s\S]*?)<\/figcaption>/i);
      var alt = cap ? cap[1].replace(/<[^>]+>/g, "").trim() : "";
      return "\n![" + alt + "](" + img[1] + ")\n";
    });
    /* 视频：嵌入的 iframe 和本地文件两种 */
    s = s.replace(/<div class="video-embed">[\s\S]*?<iframe[^>]*src="([^"]*)"[\s\S]*?<\/div>/gi,
      "\n!video[]($1)\n");
    s = s.replace(/<video[^>]*src="([^"]*)"[^>]*>[\s\S]*?<\/video>/gi, "\n!video[]($1)\n");
    /* 剩下的行内图 */
    s = s.replace(/<img[^>]*alt="([^"]*)"[^>]*src="([^"]*)"[^>]*>/gi, "\n![$1]($2)\n");
    s = s.replace(/<img[^>]*src="([^"]*)"[^>]*>/gi, "\n![]($1)\n");

    s = s.replace(/<h2[^>]*>([\s\S]*?)<\/h2>/gi, "\n## $1\n");
    s = s.replace(/<h3[^>]*>([\s\S]*?)<\/h3>/gi, "\n### $1\n");
    s = s.replace(/<h4[^>]*>([\s\S]*?)<\/h4>/gi, "\n#### $1\n");
    s = s.replace(/<blockquote[^>]*>([\s\S]*?)<\/blockquote>/gi, function (m, inner) {
      return "\n> " + inner.replace(/<\/?p[^>]*>/gi, "").trim() + "\n";
    });
    s = s.replace(/<ol[^>]*>([\s\S]*?)<\/ol>/gi, function (m, inner) {
      var n = 0;
      return "\n" + inner.replace(/<li[^>]*>([\s\S]*?)<\/li>/gi, function (m2, li) {
        n += 1;
        return n + ". " + li + "\n";
      }) + "\n";
    });
    s = s.replace(/<li[^>]*>([\s\S]*?)<\/li>/gi, "- $1\n");
    s = s.replace(/<\/?(ul|ol)[^>]*>/gi, "\n");
    s = s.replace(/<p[^>]*>([\s\S]*?)<\/p>/gi, "\n$1\n");
    s = s.replace(/<strong[^>]*>([\s\S]*?)<\/strong>/gi, "**$1**");
    s = s.replace(/<b[^>]*>([\s\S]*?)<\/b>/gi, "**$1**");
    s = s.replace(/<em[^>]*>([\s\S]*?)<\/em>/gi, "*$1*");
    s = s.replace(/<code[^>]*>([\s\S]*?)<\/code>/gi, "`$1`");
    s = s.replace(/<a[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi, "[$2]($1)");
    s = s.replace(/<hr\s*\/?>/gi, "\n---\n");
    s = s.replace(/<br\s*\/?>/gi, "\n");
    s = s.replace(/<[^>]+>/g, "");
    s = decodeEnt(s);
    s = s.replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n");
    return s.trim();
  }

  /* ========================================================== 生成源码 */

  function jsValue(v, depth) {
    var pad = new Array(depth + 1).join("  ");
    var pad2 = new Array(depth + 2).join("  ");

    if (v == null) { return "null"; }
    if (typeof v === "number" || typeof v === "boolean") { return String(v); }
    if (typeof v === "string") {
      if (v.indexOf("\n") >= 0) {
        return "`" + v.replace(/\\/g, "\\\\").replace(/`/g, "\\`").replace(/\$\{/g, "\\${") + "`";
      }
      return JSON.stringify(v);
    }
    if (Array.isArray(v)) {
      if (!v.length) { return "[]"; }
      return "[\n" + v.map(function (x) { return pad2 + jsValue(x, depth + 1); }).join(",\n") + "\n" + pad + "]";
    }
    var keys = Object.keys(v);
    if (!keys.length) { return "{}"; }
    return "{\n" + keys.map(function (k) {
      return pad2 + JSON.stringify(k) + ": " + jsValue(v[k], depth + 1);
    }).join(",\n") + "\n" + pad + "}";
  }

  function buildPosts() {
    return "/* 小窝 · 文章数据\n" +
           "   加一篇：复制一整段 { ... } 改一改，或者打开 admin.html 用后台写。\n" +
           "   slug 只能用英文小写和横杠，date 写 YYYY-MM-DD，body 写 HTML。 */\n\n" +
           "window.POSTS = " + jsValue(draft.posts, 0) + ";\n";
  }

  function buildSite() {
    return "/* 小窝 · 站点内容\n" +
           "   首页文字、侧栏、随手记、关于页、收藏夹都在这里。\n" +
           "   也可以在 admin.html 里可视化地改。 */\n\n" +
           "window.SITE = " + jsValue(draft.site, 0) + ";\n";
  }

  /* ========================================================== 写文件 */

  var handles = {};

  function download(name, text) {
    var blob = new Blob([text], { type: "text/javascript;charset=utf-8" });
    var url = URL.createObjectURL(blob);
    var a = document.createElement("a");
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.parentNode.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(url); }, 3000);
  }

  function writeFile(name, text) {
    if (!window.showSaveFilePicker) {
      download(name, text);
      return Promise.resolve("downloaded");
    }
    var getHandle = handles[name]
      ? Promise.resolve(handles[name])
      : window.showSaveFilePicker({
          suggestedName: name,
          types: [{ description: "JavaScript", accept: { "text/javascript": [".js"] } }]
        }).then(function (h) { handles[name] = h; return h; });

    return getHandle.then(function (handle) {
      return handle.createWritable();
    }).then(function (w) {
      return w.write(text).then(function () { return w.close(); });
    }).then(function () {
      return "saved";
    }).catch(function (err) {
      if (err && err.name === "AbortError") { return "abort"; }
      download(name, text);
      return "downloaded";
    });
  }

  /* ============================================================ 提示 */

  var toastEl = $("#toast");
  var toastTimer = null;
  function toast(msg) {
    if (!toastEl) { return; }
    toastEl.textContent = msg;
    toastEl.hidden = false;
    requestAnimationFrame(function () { toastEl.classList.add("show"); });
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () {
      toastEl.classList.remove("show");
      setTimeout(function () { toastEl.hidden = true; }, 400);
    }, 3400);
  }

  var statusEl = $("#status");
  function updateStatus() {
    if (!statusEl) { return; }
    var d = dirty.site || dirty.posts;
    statusEl.textContent = d ? "有改动未保存" : "已同步";
    statusEl.classList.toggle("dirty", d);
  }

  /* ============================================================ 草稿 */

  var DRAFT_KEY = "hut-admin-draft";

  function clearDraft() {
    try { localStorage.removeItem(DRAFT_KEY); } catch (e) {}
  }

  var saveDraft = debounce(function () {
    try { localStorage.setItem(DRAFT_KEY, JSON.stringify(draft)); } catch (e) {}
  }, 400);

  function markDirty(which) {
    dirty[which] = true;
    updateStatus();
    saveDraft();
  }

  function checkDraft() {
    var raw = null;
    try { raw = localStorage.getItem(DRAFT_KEY); } catch (e) {}
    if (!raw) { return; }
    var parsed;
    try { parsed = JSON.parse(raw); } catch (e) { return; }
    if (!parsed || !parsed.site || !parsed.posts) { return; }
    if (JSON.stringify(parsed) === JSON.stringify(draft)) { return; }

    var bar = $("#draft-bar");
    if (!bar) { return; }
    bar.hidden = false;

    var restore = $("#draft-restore");
    var discard = $("#draft-discard");
    if (restore) {
      restore.addEventListener("click", function () {
        draft = parsed;
        mdCache = {};
        dirty = { site: true, posts: true };
        bar.hidden = true;
        renderAll();
        renderTagManager();
        updateStatus();
        toast("已恢复上次的改动，记得点保存");
      });
    }
    if (discard) {
      discard.addEventListener("click", function () {
        clearDraft();
        bar.hidden = true;
      });
    }
  }

  /* ======================================================== 面板切换 */

  var TABS = ["panel-posts", "panel-tags", "panel-photos", "panel-site", "panel-side",
              "panel-about", "panel-shelf", "panel-export"];

  function showPanel(id) {
    $$(".tab").forEach(function (t) {
      t.setAttribute("aria-pressed", t.dataset.panel === id ? "true" : "false");
    });
    TABS.forEach(function (pid) {
      var p = $("#" + pid);
      if (p) { p.hidden = pid !== id; }
    });
    try { localStorage.setItem("hut-admin-tab", id); } catch (e) {}
  }

  $$(".tab").forEach(function (t) {
    t.addEventListener("click", function () { showPanel(t.dataset.panel); });
  });

  /* ==================================================== 通用字段渲染 */

  var SCHEMA = {
    "panel-site": [
      { key: "avatar", label: "头像", type: "avatar", hint: "挑一张图片传上来，或者直接填图片地址；留空就用名字的第一个字" },
      { key: "brand", label: "站名（左上角和页脚）", type: "text" },
      { key: "author", label: "你的名字 / 昵称", type: "text" },
      { key: "tagline", label: "一句话简介", type: "text" },
      { key: "eyebrow", label: "首页左上角小标", type: "text", hint: "比如 INDEX · 宿州，年份会自动接在后面" },
      { key: "heroTitle", label: "首页大标题", type: "textarea", hint: "可以写 <b>要突出的话</b>，<br> 是换行" },
      { key: "heroText", label: "首页介绍段落", type: "textarea", hint: "可以写 <strong>加粗</strong>" },
      { key: "facts", label: "首页那几个小标签", type: "lines", hint: "一行一个" },
      { key: "houseNote", label: "侧栏「这间屋子」那段话", type: "textarea" }
    ],
    "panel-side": [
      { key: "now", label: "侧栏「现在」", type: "list", cols: "100px 1fr",
        fields: [["k", "名称"], ["v", "内容"]] },
      { key: "gear", label: "侧栏「桌上的东西」", type: "list", cols: "1fr 1fr",
        fields: [["name", "名称"], ["note", "备注"]] },
      { key: "notes", label: "随手记", type: "list", cols: "130px 1fr",
        fields: [["date", "日期"], ["text", "内容"]] }
    ],
    "panel-about": [
      { key: "about.paragraphs", label: "自我介绍", type: "lines", hint: "一行一段，可以写 <strong>加粗</strong>" },
      { key: "about.timeline", label: "时间线", type: "list", cols: "110px 1fr",
        fields: [["when", "时间"], ["text", "内容"]] },
      { key: "about.contacts", label: "联系方式", type: "list", cols: "120px 1fr",
        fields: [["label", "名称"], ["value", "内容"]] }
    ]
  };

  function fieldHTML(f) {
    var head = "<span>" + esc(f.label) + "</span>";
    var hint = f.hint ? '<p class="hint">' + esc(f.hint) + "</p>" : "";

    if (f.type === "avatar") {
      return '<div class="field" data-field="' + f.key + '">' + head + hint +
        '<div class="avatar-row">' +
          '<div class="avatar-preview" data-avatar-preview></div>' +
          '<div class="avatar-actions">' +
            '<button class="btn tiny" type="button" data-avatar-pick>选一张图片</button>' +
            '<button class="btn tiny ghost" type="button" data-avatar-clear>去掉</button>' +
            '<input type="file" accept="image/*" hidden data-avatar-file>' +
          "</div>" +
        "</div>" +
        '<input type="text" data-path="' + f.key + '" placeholder="assets/uploads/xxx.jpg">' +
      "</div>";
    }

    if (f.type === "lines") {
      return '<label class="field" data-field="' + f.key + '">' + head + hint +
             '<textarea data-path="' + f.key + '" data-type="lines" style="min-height:150px"></textarea></label>';
    }
    if (f.type === "textarea") {
      return '<label class="field" data-field="' + f.key + '">' + head + hint +
             '<textarea data-path="' + f.key + '" style="min-height:110px"></textarea></label>';
    }
    if (f.type === "list") {
      return '<div class="field" data-field="' + f.key + '">' + head + hint +
             '<div class="rows" data-rows="' + f.key + '" data-cols="' + (f.cols || "1fr 2fr") + '"></div>' +
             '<button class="add-row" type="button" data-add-row="' + f.key + '">＋ 加一条</button></div>';
    }
    return '<label class="field" data-field="' + f.key + '">' + head + hint +
           '<input type="text" data-path="' + f.key + '"></label>';
  }

  function listFieldsOf(key) {
    var all = (SCHEMA["panel-site"] || []).concat(SCHEMA["panel-side"] || [], SCHEMA["panel-about"] || []);
    for (var i = 0; i < all.length; i++) {
      if (all[i].key === key && all[i].type === "list") { return all[i]; }
    }
    return null;
  }

  function renderRows(rowHost) {
    var key = rowHost.dataset.rows;
    var f = listFieldsOf(key);
    if (!f) { return; }
    var arr = getPath(draft.site, key) || [];

    rowHost.innerHTML = arr.map(function (item, i) {
      return '<div class="row-item" style="--cols:' + rowHost.dataset.cols + '">' +
        f.fields.map(function (fl) {
          return '<input type="text" data-idx="' + i + '" data-sub="' + fl[0] + '" ' +
                 'placeholder="' + esc(fl[1]) + '" value="' + esc(item[fl[0]] || "") + '">';
        }).join("") +
        '<button class="row-del" type="button" data-del-row="' + i + '" aria-label="删掉这一条">×</button>' +
      "</div>";
    }).join("");
  }

  function renderPanel(id) {
    var host = $("#" + id);
    if (!host) { return; }
    var schema = SCHEMA[id] || [];
    host.innerHTML = schema.map(fieldHTML).join("");

    $$("[data-path]", host).forEach(function (input) {
      var path = input.dataset.path;
      var val = getPath(draft.site, path);
      if (input.dataset.type === "lines") {
        input.value = (val || []).join("\n");
      } else {
        input.value = val == null ? "" : val;
      }
      input.addEventListener("input", function () {
        if (input.dataset.type === "lines") {
          setPath(draft.site, path, input.value.split("\n").map(function (s) {
            return s.trim();
          }).filter(function (s) { return s !== ""; }));
        } else {
          setPath(draft.site, path, input.value);
        }
        markDirty("site");
      });
    });

    $$("[data-rows]", host).forEach(function (rowHost) {
      var key = rowHost.dataset.rows;
      renderRows(rowHost);

      rowHost.addEventListener("input", function (e) {
        var inp = e.target.closest ? e.target.closest("input[data-sub]") : null;
        if (!inp) { return; }
        var arr = getPath(draft.site, key) || [];
        var item = arr[+inp.dataset.idx];
        if (item) {
          item[inp.dataset.sub] = inp.value;
          markDirty("site");
        }
      });

      rowHost.addEventListener("click", function (e) {
        var del = e.target.closest ? e.target.closest("[data-del-row]") : null;
        if (!del) { return; }
        var arr = getPath(draft.site, key) || [];
        arr.splice(+del.dataset.delRow, 1);
        setPath(draft.site, key, arr);
        renderRows(rowHost);
        markDirty("site");
      });
    });

    $$("[data-add-row]", host).forEach(function (btn) {
      btn.addEventListener("click", function () {
        var key = btn.dataset.addRow;
        var f = listFieldsOf(key);
        if (!f) { return; }
        var arr = getPath(draft.site, key) || [];
        var blank = {};
        f.fields.forEach(function (fl) { blank[fl[0]] = ""; });
        arr.push(blank);
        setPath(draft.site, key, arr);
        var rowHost = $('[data-rows="' + key + '"]', host);
        if (rowHost) { renderRows(rowHost); }
        markDirty("site");
      });
    });

    /* 头像那块：预览 + 上传 */
    var avPreview = $("[data-avatar-preview]", host);
    if (avPreview) { setupAvatar(host, avPreview); }
  }

  /* ------------------------------------------------ 头像：预览和上传 */

  function renderAvatarPreview(preview) {
    var src = String(draft.site.avatar || "").trim();
    var name = draft.site.author || "我";
    if (!src) {
      preview.innerHTML = "";
      preview.textContent = name.slice(0, 1).toUpperCase();
      return;
    }
    preview.innerHTML = '<img alt="头像" src="' + esc(src) + '">';
  }

  function setupAvatar(host, preview) {
    renderAvatarPreview(preview);

    var input = $('[data-path="avatar"]', host);
    var file = $("[data-avatar-file]", host);
    var pick = $("[data-avatar-pick]", host);
    var clear = $("[data-avatar-clear]", host);

    if (input) {
      input.addEventListener("input", function () {
        draft.site.avatar = input.value.trim();
        renderAvatarPreview(preview);
        markDirty("site");
      });
    }

    if (pick && file) {
      pick.addEventListener("click", function () {
        if (!serverMode) {
          toast("双击打开的后台不能传文件。用「启动后台.bat」启动后再传。");
          return;
        }
        file.click();
      });
    }

    if (file) {
      file.addEventListener("change", function () {
        var f = file.files && file.files[0];
        if (!f) { return; }
        toast("正在传图片…");
        uploadImage(f).then(function (path) {
          draft.site.avatar = path;
          if (input) { input.value = path; }
          renderAvatarPreview(preview);
          markDirty("site");
          toast("传好了，记得点「保存站点信息」写回文件");
        }).catch(function (err) {
          toast(err.message);
        });
        file.value = "";
      });
    }

    if (clear) {
      clear.addEventListener("click", function () {
        draft.site.avatar = "";
        if (input) { input.value = ""; }
        renderAvatarPreview(preview);
        markDirty("site");
      });
    }
  }

  /* ------------------------------------------- 往服务器传一张图片 */

  function uploadImage(file) {
    return new Promise(function (resolve, reject) {
      if (!serverMode) {
        reject(new Error("双击打开的后台不能传文件。用「启动后台.bat」或「启动局域网.bat」跑起来再传。"));
        return;
      }
      if (file.size > 3 * 1024 * 1024) {
        reject(new Error("图片超过 3MB，先压一下再传。"));
        return;
      }
      var reader = new FileReader();
      reader.onload = function () {
        var b64 = String(reader.result).split(",")[1] || "";
        fetch("api/upload", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ token: serverToken, name: file.name, data: b64 })
        }).then(function (r) { return r.json(); })
          .then(function (res) {
            if (res && res.ok) { resolve(res.path); }
            else { reject(new Error((res && res.msg) || "上传失败")); }
          })
          .catch(function () { reject(new Error("连不上本地服务")); });
      };
      reader.onerror = function () { reject(new Error("读文件失败")); };
      reader.readAsDataURL(file);
    });
  }

  /* ------------------------------------------- 编辑器上的小工具条 */

  function bindEditorTools() {
    var bodyEl = $("#f-body");
    if (!bodyEl) { return; }

    function insert(text) {
      var start = bodyEl.selectionStart == null ? bodyEl.value.length : bodyEl.selectionStart;
      var end = bodyEl.selectionEnd == null ? start : bodyEl.selectionEnd;
      var v = bodyEl.value;
      bodyEl.value = v.slice(0, start) + text + v.slice(end);
      bodyEl.selectionStart = bodyEl.selectionEnd = start + text.length;
      bodyEl.focus();
      bodyEl.dispatchEvent(new Event("input", { bubbles: true }));
    }

    var pickImg = $("#pick-image");
    var insImg = $("#ins-image");

    if (insImg && pickImg) {
      insImg.addEventListener("click", function () {
        if (serverMode) { pickImg.click(); return; }
        var url = window.prompt("图片地址（外链 https:// 开头，或者 assets/uploads/xxx.jpg）", "https://");
        if (!url || url === "https://") { return; }
        insert("\n![](" + url.trim() + ")\n");
      });
    }

    if (pickImg) {
      pickImg.addEventListener("change", function () {
        var f = pickImg.files && pickImg.files[0];
        if (!f) { return; }
        toast("正在传图片…");
        uploadImage(f).then(function (path) {
          insert("\n![](" + path + ")\n");
          toast("图片插进来了，别忘了保存");
        }).catch(function (err) { toast(err.message); });
        pickImg.value = "";
      });
    }

    var insVideo = $("#ins-video");
    if (insVideo) {
      insVideo.addEventListener("click", function () {
        var url = window.prompt("视频地址：本地 mp4，或者 B 站 / YouTube 的链接都行", "https://");
        if (!url || url === "https://") { return; }
        var cap = window.prompt("给这段视频写一句说明（可以留空，直接点确定）", "");
        insert("\n!video[" + String(cap || "").trim() + "](" + url.trim() + ")\n");
      });
    }

    var insCode = $("#ins-code");
    if (insCode) {
      insCode.addEventListener("click", function () { insert("\n```\n\n```\n"); });
    }
  }

  /* ======================================================== 收藏夹面板 */

  function renderShelf() {
    var host = $("#panel-shelf");
    if (!host) { return; }

    host.innerHTML =
      '<div class="field"><span>友链说明</span>' +
        '<p class="hint">收藏夹页面最下面那段话。</p>' +
        '<textarea data-path="friendLinkNote" style="min-height:130px"></textarea></div>' +
      '<div class="field"><span>收藏夹分组</span>' +
        '<p class="hint">每组下面可以放很多条。首页右栏「常去的地方」显示的是第一组的前四条。</p>' +
        '<div id="shelf-groups"></div>' +
        '<button class="add-row" id="add-group" type="button">＋ 加一个分组</button></div>';

    var note = $('[data-path="friendLinkNote"]', host);
    note.value = draft.site.friendLinkNote || "";
    note.addEventListener("input", function () {
      draft.site.friendLinkNote = note.value;
      markDirty("site");
    });

    renderShelfGroups();

    var addGroup = $("#add-group");
    if (addGroup) {
      addGroup.addEventListener("click", function () {
        if (!draft.site.shelf) { draft.site.shelf = []; }
        draft.site.shelf.push({ group: "新分组", hint: "", items: [] });
        renderShelfGroups();
        markDirty("site");
      });
    }
  }

  function renderShelfGroups() {
    var host = $("#shelf-groups");
    if (!host) { return; }
    var groups = draft.site.shelf || [];

    host.innerHTML = groups.map(function (g, gi) {
      var items = (g.items || []).map(function (it, ii) {
        return '<div class="item-card">' +
          '<div class="grid-2">' +
            '<input type="text" data-g="' + gi + '" data-i="' + ii + '" data-f="name" placeholder="站名" value="' + esc(it.name || "") + '">' +
            '<input type="text" data-g="' + gi + '" data-i="' + ii + '" data-f="domain" placeholder="域名（显示在站名下面）" value="' + esc(it.domain || "") + '">' +
          '</div>' +
          '<div class="grid-2">' +
            '<input type="text" data-g="' + gi + '" data-i="' + ii + '" data-f="url" placeholder="完整网址 https://…" value="' + esc(it.url || "") + '">' +
            '<input type="text" data-g="' + gi + '" data-i="' + ii + '" data-f="note" placeholder="为什么留着它" value="' + esc(it.note || "") + '">' +
          '</div>' +
          '<button class="add-row" type="button" data-act="del-item" data-g="' + gi + '" data-i="' + ii + '">删掉这一条</button>' +
        '</div>';
      }).join("");

      return '<div class="group-card">' +
        '<div class="group-head">' +
          '<input type="text" data-g="' + gi + '" data-f="group" placeholder="分组名，比如 学习" value="' + esc(g.group || "") + '">' +
          '<input type="text" data-g="' + gi + '" data-f="hint" placeholder="右边的小字，比如 查东西的地方" value="' + esc(g.hint || "") + '">' +
          '<button class="row-del" type="button" data-act="del-group" data-g="' + gi + '" aria-label="删掉这一组">×</button>' +
        '</div>' + items +
        '<button class="add-row" type="button" data-act="add-item" data-g="' + gi + '">＋ 加一条收藏</button>' +
      '</div>';
    }).join("");

    if (!host.dataset.bound) {
      host.dataset.bound = "1";
      host.addEventListener("input", function (e) {
        var inp = e.target.closest ? e.target.closest("input[data-g]") : null;
        if (!inp) { return; }
        var g = (draft.site.shelf || [])[+inp.dataset.g];
        if (!g) { return; }
        var key = inp.dataset.f;
        if (inp.dataset.i == null) {
          g[key] = inp.value;
        } else {
          var item = (g.items || [])[+inp.dataset.i];
          if (item) { item[key] = inp.value; }
        }
        markDirty("site");
      });
      host.addEventListener("click", function (e) {
        var btn = e.target.closest ? e.target.closest("[data-act]") : null;
        if (!btn) { return; }
        var gi = +btn.dataset.g;
        var groups = draft.site.shelf || [];
        var g = groups[gi];
        if (!g) { return; }

        if (btn.dataset.act === "del-group") {
          groups.splice(gi, 1);
        } else if (btn.dataset.act === "add-item") {
          if (!g.items) { g.items = []; }
          g.items.push({ name: "", url: "https://", domain: "", note: "" });
        } else if (btn.dataset.act === "del-item") {
          if (g.items) { g.items.splice(+btn.dataset.i, 1); }
        }
        renderShelfGroups();
        markDirty("site");
      });
    }
  }

  /* ========================================================== 文章面板 */

  function sortedIndexes() {
    return draft.posts.map(function (p, i) { return i; }).sort(function (a, b) {
      var da = draft.posts[a].date || "";
      var db = draft.posts[b].date || "";
      return da < db ? 1 : (da > db ? -1 : 0);
    });
  }

  function renderPostIndex() {
    var list = $("#post-index");
    if (!list) { return; }
    list.innerHTML = sortedIndexes().map(function (i) {
      var p = draft.posts[i];
      return '<li data-i="' + i + '"' + (i === curIdx ? ' class="on"' : "") + '>' +
        '<span class="pi-date">' + esc(p.date || "") + "</span>" + esc(p.title || "（没标题）") + "</li>";
    }).join("");

    var has = draft.posts.length > 0;
    var editor = $("#post-editor");
    var empty = $("#post-empty");
    if (editor) { editor.hidden = !has; }
    if (empty) { empty.hidden = has; }
  }

  function updatePreview() {
    var body = $("#f-body");
    var prev = $("#f-preview");
    if (body && prev) { prev.innerHTML = mdToHtml(body.value); }
  }

  function loadPost(i) {
    if (!draft.posts.length) { renderPostIndex(); return; }
    curIdx = Math.max(0, Math.min(i, draft.posts.length - 1));
    var p = draft.posts[curIdx];

    $("#f-title").value = p.title || "";
    $("#f-date").value = p.date || today();
    $("#f-slug").value = p.slug || "";
    $("#f-tags").value = (p.tags || []).join("，");
    $("#f-excerpt").value = p.excerpt || "";

    var md = mdCache[curIdx];
    if (md == null) {
      md = htmlToMd(p.body || "");
      mdCache[curIdx] = md;
    }
    $("#f-body").value = md;

    var hint = $("#editor-hint");
    if (hint) {
      hint.textContent = "正文用 Markdown；网址名留空的话，保存时会自动补一个。";
    }
    updatePreview();
    renderPostIndex();
  }

  function bindPostFields() {
    var titleEl = $("#f-title"), dateEl = $("#f-date"), slugEl = $("#f-slug"),
        tagsEl = $("#f-tags"), excEl = $("#f-excerpt"), bodyEl = $("#f-body");

    function touch() {
      var p = draft.posts[curIdx];
      if (!p) { return; }
      p.title = titleEl.value;
      p.date = dateEl.value || today();
      p.slug = slugEl.value.trim().replace(/[^a-zA-Z0-9-]+/g, "-").replace(/^-+|-+$/g, "").toLowerCase();
      if (slugEl.value !== p.slug) { slugEl.value = p.slug; }
      p.tags = tagsEl.value.split(/[,，]/).map(function (s) { return s.trim(); })
                 .filter(function (s, idx, arr) { return s !== "" && arr.indexOf(s) === idx; });
      p.excerpt = excEl.value;
      markDirty("posts");
      renderPostIndex();
    }

    [titleEl, dateEl, slugEl, tagsEl, excEl].forEach(function (input) {
      input.addEventListener("input", touch);
    });
    if (tagsEl) {
      tagsEl.addEventListener("change", function () { renderTagManager(); });
    }

    bodyEl.addEventListener("input", function () {
      var p = draft.posts[curIdx];
      if (!p) { return; }
      mdCache[curIdx] = bodyEl.value;
      p.body = mdToHtml(bodyEl.value);
      updatePreview();
      markDirty("posts");
    });
  }

  function bindPostActions() {
    var list = $("#post-index");
    if (list) {
      list.addEventListener("click", function (e) {
        var li = e.target.closest ? e.target.closest("li[data-i]") : null;
        if (!li) { return; }
        loadPost(+li.dataset.i);
      });
    }

    var addBtn = $("#new-post");
    if (addBtn) {
      addBtn.addEventListener("click", function () {
        draft.posts.unshift({
          slug: "post-" + today().replace(/-/g, ""),
          title: "还没起标题",
          date: today(),
          tags: [],
          excerpt: "",
          body: "<p>从这儿开始写。</p>"
        });
        mdCache = {};
        markDirty("posts");
        loadPost(0);
        showPanel("panel-posts");
        $("#f-title").focus();
      });
    }

    var delBtn = $("#del-post");
    if (delBtn) {
      delBtn.addEventListener("click", function () {
        var p = draft.posts[curIdx];
        if (!p) { return; }
        if (!window.confirm("删掉《" + (p.title || "没标题") + "》？删了就得自己写回来了。")) { return; }
        draft.posts.splice(curIdx, 1);
        mdCache = {};
        markDirty("posts");
        curIdx = 0;
        if (draft.posts.length) { loadPost(0); } else { renderPostIndex(); }
        renderTagManager();
        toast("删了。记得点保存");
      });
    }
  }

  /* ========================================================== 标签面板 */

  function tagCounts() {
    var counts = {};
    draft.posts.forEach(function (p) {
      (p.tags || []).forEach(function (t) {
        counts[t] = (counts[t] || 0) + 1;
      });
    });
    return counts;
  }

  function renderTagManager() {
    var host = $("#tag-manager");
    if (!host) { return; }
    var counts = tagCounts();
    var names = Object.keys(counts).sort();

    if (!names.length) {
      host.innerHTML = '<p class="hint">还没有任何标签。去「文章」面板，在标签框里写几个，用逗号隔开。</p>';
      return;
    }

    host.innerHTML = names.map(function (t) {
      return '<div class="tag-row">' +
        '<input type="text" value="' + esc(t) + '" data-old="' + esc(t) + '">' +
        '<span class="tag-count">' + counts[t] + " 篇</span>" +
        '<button class="row-del" type="button" data-del-tag="' + esc(t) + '" aria-label="删掉这个标签">×</button>' +
      "</div>";
    }).join("");

    if (!host.dataset.bound) {
      host.dataset.bound = "1";

      host.addEventListener("change", function (e) {
        var inp = e.target.closest ? e.target.closest("input[data-old]") : null;
        if (!inp) { return; }
        var oldName = inp.dataset.old;
        var newName = inp.value.trim();
        if (!newName || newName === oldName) { inp.value = oldName; return; }
        renameTag(oldName, newName);
      });

      host.addEventListener("click", function (e) {
        var btn = e.target.closest ? e.target.closest("[data-del-tag]") : null;
        if (!btn) { return; }
        var name = btn.dataset.delTag;
        if (!window.confirm("把所有文章里的「" + name + "」标签都去掉？文章本身不会动。")) { return; }
        removeTag(name);
      });
    }
  }

  function renameTag(oldName, newName) {
    draft.posts.forEach(function (p) {
      p.tags = (p.tags || []).map(function (t) { return t === oldName ? newName : t; })
        .filter(function (t, i, arr) { return arr.indexOf(t) === i; });
    });
    markDirty("posts");
    renderTagManager();
    renderPostIndex();
    loadPost(curIdx);
    toast("「" + oldName + "」改成了「" + newName + "」");
  }

  function removeTag(name) {
    draft.posts.forEach(function (p) {
      p.tags = (p.tags || []).filter(function (t) { return t !== name; });
    });
    markDirty("posts");
    renderTagManager();
    renderPostIndex();
    loadPost(curIdx);
    toast("删掉标签「" + name + "」");
  }

  /* ========================================================== 保存/导出 */

  var serverMode = false;
  var serverToken = "";

  function save(which) {
    var rel = which === "posts" ? "assets/posts.js" : "assets/site-data.js";
    var name = which === "posts" ? "posts.js" : "site-data.js";
    var text = which === "posts" ? buildPosts() : buildSite();

    function success(msg) {
      dirty[which] = false;
      updateStatus();
      clearDraft();
      toast(msg);
    }

    /* --- 服务端模式：交给本地服务去校验和写 --- */
    if (serverMode && window.fetch) {
      fetch("api/save", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: serverToken, file: rel, content: text })
      }).then(function (r) {
        return r.json();
      }).then(function (res) {
        if (res && res.ok) {
          success("已写回 " + name + "，上一版留成了 " + name + ".bak");
          return;
        }
        if (res && /过期|登录/.test(res.msg || "")) {
          window.HUT_AUTH.clearSession();
          toast("钥匙过期了，重新登录一下");
          setTimeout(function () { window.location.reload(); }, 1400);
          return;
        }
        toast((res && res.msg) || "保存失败");
      }).catch(function () {
        toast("连不上本地服务，改用下载");
        download(name, text);
      });
      return;
    }

    /* --- 本地文件模式：浏览器文件接口，不行就下载 --- */
    writeFile(name, text).then(function (r) {
      if (r === "abort") { return; }
      if (r === "saved") { success("已写回 " + name); }
      if (r === "downloaded") {
        toast("浏览器不让直接写文件，已经帮你下载 " + name + "，把它拖进 assets 文件夹覆盖原文件即可。");
      }
    });
  }

  function bindExport() {
    var sp = $("#save-posts");
    if (sp) { sp.addEventListener("click", function () { save("posts"); }); }
    var ss = $("#save-site");
    if (ss) { ss.addEventListener("click", function () { save("site"); }); }

    var dp = $("#dl-posts");
    if (dp) { dp.addEventListener("click", function () { download("posts.js", buildPosts()); toast("已下载 posts.js"); }); }
    var ds = $("#dl-site");
    if (ds) { ds.addEventListener("click", function () { download("site-data.js", buildSite()); toast("已下载 site-data.js"); }); }

    var cp = $("#copy-posts");
    if (cp) {
      cp.addEventListener("click", function () {
        var text = buildPosts();
        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(text).then(function () {
            toast("文章代码已复制到剪贴板");
          }, function () { toast("复制失败，用下载吧"); });
        } else {
          toast("这个浏览器不给复制，用下载吧");
        }
      });
    }
  }

  /* ============================================================ 登录 */

  var gate = $("#gate");

  function renderModeBar() {
    var bar = $("#mode-bar");
    if (!bar) { return; }
    bar.hidden = false;
    bar.innerHTML =
      '<span class="mode-pill' + (serverMode ? " on" : "") + '">' +
        (serverMode ? "服务端模式" : "本地文件模式") + "</span>" +
      '<span class="mode-text">' +
        (serverMode
          ? "密码校验和写文件都在本地服务里做，别人拿到网页也改不动你的文件。"
          : "改动写进你自己电脑的文件。想更稳一点，双击「启动后台.bat」再来改。") +
      "</span>";

    var ph = $("#save-posts-hint");
    var sh = $("#save-site-hint");
    if (serverMode) {
      if (ph) { ph.innerHTML = "点一下就写回 <code>assets/posts.js</code>，上一版会自动存成 .bak。"; }
      if (sh) { sh.innerHTML = "点一下就写回 <code>assets/site-data.js</code>，上一版会自动存成 .bak。"; }
    }
  }

  function showGate(msg) {
    if (!gate) { return; }
    gate.hidden = false;
    document.body.classList.remove("unlocked");
    var err = $("#gate-err");
    if (err) { err.textContent = msg || ""; }
    var note = $("#gate-note");
    if (note) {
      note.textContent = serverMode
        ? "现在是服务端模式：密码检查在本地服务里完成，绕不过去。登录状态 12 小时内有效。"
        : "现在是本地文件模式。密码是哈希比对的（源码里没有明文），但纯网页挡不住会改代码的人。想更稳，双击「启动后台.bat」，再从那个地址打开后台。";
    }
  }

  function detectServer() {
    if (!window.fetch) { return Promise.resolve(false); }
    return fetch("api/ping", { cache: "no-store" })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (j) { return !!(j && j.ok); })
      .catch(function () { return false; });
  }

  function bindGate() {
    var form = $("#gate-form");
    if (!form) { return; }
    form.addEventListener("submit", function (e) {
      e.preventDefault();
      var user = $("#gate-user").value;
      var pass = $("#gate-pass").value;
      var rememberEl = $("#gate-remember");
      var remember = rememberEl ? rememberEl.checked : true;
      var btn = $("#gate-submit");
      var err = $("#gate-err");

      btn.disabled = true;
      btn.textContent = "检查中…";

      var attempt;
      if (serverMode && window.fetch) {
        attempt = fetch("api/login", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ user: user, pass: pass })
        }).then(function (r) { return r.json(); })
          .catch(function () { return { ok: false, msg: "连不上本地服务，确认那个黑窗口还开着。" }; });
      } else {
        attempt = window.HUT_AUTH.login(user, pass);
      }

      attempt.then(function (res) {
        btn.disabled = false;
        btn.textContent = "进去";
        if (!res || !res.ok) {
          if (err) { err.textContent = (res && res.msg) || "不对劲。"; }
          $("#gate-pass").value = "";
          return;
        }
        serverToken = res.token || "";
        window.HUT_AUTH.saveSession(remember, serverToken);
        if (gate) { gate.hidden = true; }
        document.body.classList.add("unlocked");
        startAdmin();
        toast("欢迎回来");
      });
    });
  }

  function bindLogout() {
    var btn = $("#logout");
    if (!btn) { return; }
    btn.addEventListener("click", function () {
      if (serverMode && serverToken && window.fetch) {
        fetch("api/logout", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ token: serverToken })
        }).catch(function () {});
      }
      window.HUT_AUTH.clearSession();
      window.location.reload();
    });
  }

  /* ============================================================ 启动 */

  var started = false;

  function startAdmin() {
    if (started) { return; }
    started = true;
    renderAll();
    bindPostFields();
    bindPostActions();
    bindExport();
    renderTagManager();
    updateStatus();
    checkDraft();

    var lastTab = null;
    try { lastTab = localStorage.getItem("hut-admin-tab"); } catch (e) {}
    showPanel(TABS.indexOf(lastTab) >= 0 ? lastTab : "panel-posts");
  }

  function renderAll() {
    renderPanel("panel-site");
    renderPanel("panel-side");
    renderPanel("panel-about");
    renderShelf();
    loadPost(curIdx);
  }

  /* 编辑器上的小工具条：DOM 一就绪就能绑，不用等登录 */
  bindEditorTools();

  /* 调试用：控制台里执行 __build.posts() 能看到将要写进文件的代码 */
  window.__build = {
    posts: buildPosts,
    site: buildSite,
    draft: draft,
    mdToHtml: mdToHtml,
    isServer: function () { return serverMode; }
  };

  detectServer().then(function (isServer) {
    serverMode = isServer;
    renderModeBar();
    bindGate();
    bindLogout();

    var session = window.HUT_AUTH.loadSession();
    if (session) {
      serverToken = session.token || "";
      if (serverMode && !serverToken) {
        window.HUT_AUTH.clearSession();
        showGate("登录状态过期了，重新登一次。");
        return;
      }
      if (gate) { gate.hidden = true; }
      document.body.classList.add("unlocked");
      startAdmin();
      return;
    }

    showGate();
  });
})();
