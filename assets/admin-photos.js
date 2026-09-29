/* =========================================================================
   小窝 · 后台的「照片墙」面板
   独立成一个小文件，跟 admin.js 互不打扰：admin.js 只管 articles / site-data，
   这里只管 assets/photos.js。
   写回有两条路（和 admin.js 一样）：
     · 服务端模式：POST 给本地服务 api/save
     · 本地文件模式：浏览器文件接口，不行就下载
   ========================================================================= */

(function () {
  "use strict";

  var host = document.getElementById("panel-photos");
  if (!host) { return; }

  var $ = function (s, el) { return (el || document).querySelector(s); };
  var $$ = function (s, el) {
    return Array.prototype.slice.call((el || document).querySelectorAll(s));
  };

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  function clone(o) { return JSON.parse(JSON.stringify(o)); }
  function debounce(fn, ms) {
    var t;
    return function () {
      var a = arguments, self = this;
      clearTimeout(t);
      t = setTimeout(function () { fn.apply(self, a); }, ms);
    };
  }

  /* ------------------------------------------------------------ 提示 */

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
    }, 3200);
  }

  /* ------------------------------------------------------------ 数据 */

  var DRAFT_KEY = "hut-photos-draft";
  var draft = clone(window.ALBUMS || []);
  var dirty = false;

  function slug(s) {
    return String(s || "").toLowerCase()
      .replace(/[^a-z0-9\u4e00-\u9fa5]+/g, "-")
      .replace(/^-+|-+$/g, "") || "album";
  }
  function uniqueId(base) {
    var id = slug(base);
    var used = {};
    draft.forEach(function (a) { used[a.id] = true; });
    var out = id, n = 2;
    while (used[out] && draft.filter(function (a) { return a.id === out; }).length) { out = id + "-" + n++; }
    return out;
  }

  /* 一行一张照片：地址 | 说明（说明可以省） */
  function photosToText(list) {
    return (list || []).map(function (p) {
      var url = typeof p === "string" ? p : (p.url || "");
      var cap = typeof p === "string" ? "" : (p.caption || "");
      return cap ? url + " | " + cap : url;
    }).join("\n");
  }
  function textToPhotos(text) {
    return String(text || "").split("\n").map(function (line) {
      var t = line.trim();
      if (!t) { return null; }
      var at = t.indexOf("|");
      if (at < 0) { return { url: t, caption: "" }; }
      return { url: t.slice(0, at).trim(), caption: t.slice(at + 1).trim() };
    }).filter(Boolean);
  }

  function markDirty() {
    dirty = true;
    var bar = $("#photos-status");
    if (bar) { bar.textContent = "有改动没保存"; bar.classList.add("dirty"); }
    saveDraft();
  }
  function markClean() {
    dirty = false;
    var bar = $("#photos-status");
    if (bar) { bar.textContent = "已同步"; bar.classList.remove("dirty"); }
    try { localStorage.removeItem(DRAFT_KEY); } catch (e) {}
  }

  var saveDraft = debounce(function () {
    try { localStorage.setItem(DRAFT_KEY, JSON.stringify(draft)); } catch (e) {}
  }, 400);

  /* ------------------------------------------------------------ 画出来 */

  function render() {
    host.innerHTML =
      '<div class="field">' +
        "<span>照片墙</span>" +
        '<p class="hint">' +
          "数据写在 <code>assets/photos.js</code>。相册的先后顺序＝网页上的顺序。" +
          "照片那一栏一行一张，写成 <code>图片地址 | 说明</code>，说明可以省掉。" +
          "图片先点「传一张照片」传进 <code>assets/uploads/</code>，再把地址填进来。" +
        "</p>" +
      "</div>" +
      '<div class="draft-bar" id="photos-draftbar" hidden>' +
        "<span>上次关掉页面时，照片墙有些改动没保存。</span>" +
        '<button class="btn tiny" type="button" id="photos-draft-restore">恢复</button>' +
        '<button class="btn tiny ghost" type="button" id="photos-draft-drop">不要了</button>' +
      "</div>" +
      '<div id="album-list"></div>' +
      '<button class="add-row" type="button" id="photos-add">＋ 加一本相册</button>' +
      '<div class="btn-row" style="margin-top:24px">' +
        '<button class="btn primary" type="button" id="photos-save">保存 photos.js</button>' +
        '<button class="btn" type="button" id="photos-download">下载 photos.js</button>' +
        '<button class="btn ghost" type="button" id="photos-preview">看一眼照片墙</button>' +
      "</div>" +
      '<p class="hint" id="photos-status" style="margin-top:14px">已同步</p>';

    renderAlbums();
    bind();
    checkLocalDraft();
  }

  function renderAlbums() {
    var host2 = $("#album-list");
    if (!host2) { return; }

    if (!draft.length) {
      host2.innerHTML = '<p class="hint">还没有相册。点下面的「加一本相册」开始。</p>';
      return;
    }

    host2.innerHTML = draft.map(function (a, i) {
      var cover = a.cover || "";
      return '<div class="group-card" data-album="' + i + '">' +
        '<div class="group-head">' +
          '<input type="text" data-f="title" placeholder="相册名，比如「小屋的角落」" value="' + esc(a.title || "") + '">' +
          '<input type="text" data-f="date" placeholder="2026.09" style="max-width:130px" value="' + esc(a.date || "") + '">' +
          '<button class="row-del" type="button" data-act="del-album" aria-label="删掉这本相册">×</button>' +
        "</div>" +
        '<div class="grid-2">' +
          '<input type="text" data-f="id" placeholder="网址里用的名字（英文小写）" value="' + esc(a.id || "") + '">' +
          '<input type="text" data-f="cover" placeholder="封面图地址（留空就用第一张）" value="' + esc(cover) + '">' +
        "</div>" +
        '<div class="field" style="margin-top:12px">' +
          "<span>简介</span>" +
          '<textarea data-f="description" style="min-height:80px" placeholder="这本相册是干什么的">' + esc(a.description || "") + "</textarea>" +
        "</div>" +
        '<div class="field">' +
          "<span>照片（一行一张：图片地址 | 说明）</span>" +
          '<textarea data-f="photos" style="min-height:150px" spellcheck="false">' + esc(photosToText(a.photos)) + "</textarea>" +
          '<div class="btn-row" style="margin-top:10px">' +
            '<button class="btn tiny" type="button" data-act="pick" data-album="' + i + '">传一张照片</button>' +
            '<button class="btn tiny ghost" type="button" data-act="cover-from-first" data-album="' + i + '">拿第一张当封面</button>' +
          "</div>" +
        "</div>" +
        '<p class="hint">网页上的地址：photos.html#' + esc(a.id || "") + "</p>" +
      "</div>";
    }).join("");
  }

  function bind() {
    var list = $("#album-list");

    list.addEventListener("input", function (e) {
      var inp = e.target.closest ? e.target.closest("[data-f]") : null;
      if (!inp) { return; }
      var card = inp.closest("[data-album]");
      if (!card) { return; }
      var a = draft[+card.dataset.album];
      if (!a) { return; }

      if (inp.dataset.f === "photos") { a.photos = textToPhotos(inp.value); }
      else { a[inp.dataset.f] = inp.value; }
      markDirty();
    });

    list.addEventListener("change", function (e) {
      var inp = e.target.closest ? e.target.closest('input[data-f="title"], input[data-f="id"]') : null;
      if (!inp) { return; }
      var card = inp.closest("[data-album]");
      var a = draft[+card.dataset.album];
      if (!a) { return; }
      if (inp.dataset.f === "id" && !String(inp.value).trim()) {
        a.id = uniqueId(a.title || "album");
        inp.value = a.id;
      }
      if (inp.dataset.f === "title" && !String(a.id || "").trim()) {
        a.id = uniqueId(inp.value);
        var idInp = $('input[data-f="id"]', card);
        if (idInp) { idInp.value = a.id; }
      }
      markDirty();
    });

    list.addEventListener("click", function (e) {
      var btn = e.target.closest ? e.target.closest("[data-act]") : null;
      if (!btn) { return; }
      var i = +btn.dataset.album;
      var a = draft[i];
      if (!a) { return; }

      if (btn.dataset.act === "del-album") {
        if (!window.confirm("删掉相册「" + (a.title || "没名字") + "」？里面的照片记录会一起没掉（图片文件还在 uploads 里）。")) { return; }
        draft.splice(i, 1);
        markDirty();
        renderAlbums();
        return;
      }

      if (btn.dataset.act === "cover-from-first") {
        var first = (a.photos || [])[0];
        var url = typeof first === "string" ? first : (first && first.url) || "";
        if (!url) { toast("这本相册里还没有照片"); return; }
        a.cover = url;
        markDirty();
        renderAlbums();
        toast("封面换成了第一张");
        return;
      }

      if (btn.dataset.act === "pick") {
        if (!serverMode) {
          toast("双击打开的后台不能传文件。用「启动后台.bat」启动后再传。");
          return;
        }
        var picker = document.createElement("input");
        picker.type = "file";
        picker.accept = "image/*";
        picker.addEventListener("change", function () {
          var f = picker.files && picker.files[0];
          if (!f) { return; }
          toast("正在传图片…");
          upload(f).then(function (path) {
            var ta = $('textarea[data-f="photos"]', list.children[i]);
            var cur = ta ? ta.value.replace(/\s+$/, "") : photosToText(a.photos);
            var next = cur ? cur + "\n" + path : path;
            if (ta) { ta.value = next; }
            a.photos = textToPhotos(next);
            if (!a.cover) { a.cover = path; }
            markDirty();
            renderAlbums();
            toast("传好了，记得点「保存 photos.js」");
          }).catch(function (err) { toast(err.message); });
        });
        picker.click();
      }
    });

    var add = $("#photos-add");
    if (add) {
      add.addEventListener("click", function () {
        draft.push({
          id: uniqueId("新相册"),
          title: "新相册",
          description: "",
          cover: "",
          date: new Date().getFullYear() + "." + ("0" + (new Date().getMonth() + 1)).slice(-2),
          photos: []
        });
        markDirty();
        renderAlbums();
      });
    }

    var sv = $("#photos-save");
    if (sv) { sv.addEventListener("click", save); }
    var dl = $("#photos-download");
    if (dl) { dl.addEventListener("click", function () { download("photos.js", build()); toast("已下载 photos.js"); }); }
    var pv = $("#photos-preview");
    if (pv) {
      pv.addEventListener("click", function () {
        if (dirty && !window.confirm("还有改动没保存，网页上看到的会是旧版本。还是去看？")) { return; }
        window.open("photos.html?" + Date.now(), "_blank");
      });
    }

    /* 保存 / 导出 面板里那两个按钮也归这儿管 */
    var sv2 = $("#save-photos");
    if (sv2) { sv2.addEventListener("click", save); }
    var dl2 = $("#dl-photos");
    if (dl2) { dl2.addEventListener("click", function () { download("photos.js", build()); toast("已下载 photos.js"); }); }
  }

  /* -------------------------------------------------------- 生成源码 */

  function build() {
    return "/* 小窝 · 照片墙数据\n" +
           "   一个相册一段，photos 里一行一张：图片地址 | 说明\n" +
           "   改这个文件有两种办法：\n" +
           "     · 打开 admin.html，在「照片墙」面板里可视化地改（推荐）\n" +
           "     · 直接在这儿手写，格式照着下面抄\n" +
           "   图片放在 assets/uploads/ 里，上传用后台的「传一张照片」。 */\n\n" +
           "window.ALBUMS = " + JSON.stringify(draft, null, 2) + ";\n";
  }

  /* ------------------------------------------------------------ 写文件 */

  var serverMode = false;
  var serverToken = "";
  var handle = null;

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

  function save() {
    var text = build();

    if (serverMode && window.fetch) {
      fetch("api/save", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token: serverToken, file: "assets/photos.js", content: text })
      }).then(function (r) { return r.json(); }).then(function (res) {
        if (res && res.ok) {
          markClean();
          toast("已写回 photos.js，上一版留成了 photos.js.bak");
          return;
        }
        if (res && /过期|登录/.test(res.msg || "")) {
          toast("钥匙过期了，重新登录一下");
          return;
        }
        toast((res && res.msg) || "保存失败");
      }).catch(function () {
        toast("连不上本地服务，改用下载");
        download("photos.js", text);
      });
      return;
    }

    if (!window.showSaveFilePicker) {
      download("photos.js", text);
      toast("这个浏览器不让直接写文件，已经帮你下载 photos.js，拖进 assets 覆盖即可。");
      markClean();
      return;
    }

    var getter = handle ? Promise.resolve(handle) : window.showSaveFilePicker({
      suggestedName: "photos.js",
      types: [{ description: "JavaScript", accept: { "text/javascript": [".js"] } }]
    }).then(function (h) { handle = h; return h; });

    getter.then(function (h) {
      return h.createWritable();
    }).then(function (w) {
      return w.write(text).then(function () { return w.close(); });
    }).then(function () {
      markClean();
      toast("已写回 photos.js");
    }).catch(function (err) {
      if (err && err.name === "AbortError") { return; }
      download("photos.js", text);
      toast("浏览器不让直接写，已经帮你下载 photos.js。");
      markClean();
    });
  }

  /* ------------------------------------------------------------ 传图 */

  function upload(file) {
    return new Promise(function (resolve, reject) {
      if (!serverMode) {
        reject(new Error("双击打开的后台不能传文件。用「启动后台.bat」跑起来再传。"));
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

  /* ------------------------------------------------------- 本地草稿 */

  function checkLocalDraft() {
    var raw = null;
    try { raw = localStorage.getItem(DRAFT_KEY); } catch (e) {}
    if (!raw) { return; }
    var parsed;
    try { parsed = JSON.parse(raw); } catch (e) { return; }
    if (!parsed || JSON.stringify(parsed) === JSON.stringify(window.ALBUMS || [])) { return; }
    if (JSON.stringify(parsed) === JSON.stringify(draft)) { return; }

    var bar = $("#photos-draftbar");
    if (!bar) { return; }
    bar.hidden = false;

    var re = $("#photos-draft-restore");
    if (re) {
      re.addEventListener("click", function () {
        draft = parsed;
        bar.hidden = true;
        renderAlbums();
        markDirty();
        toast("已恢复上次的改动，记得点保存");
      });
    }
    var dr = $("#photos-draft-drop");
    if (dr) {
      dr.addEventListener("click", function () {
        try { localStorage.removeItem(DRAFT_KEY); } catch (e) {}
        bar.hidden = true;
      });
    }
  }

  /* ------------------------------------------------------------ 启动 */

  render();

  if (window.fetch) {
    fetch("api/ping", { cache: "no-store" })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (j) {
        serverMode = !!(j && j.ok);
        var s = window.HUT_AUTH && window.HUT_AUTH.loadSession ? window.HUT_AUTH.loadSession() : null;
        serverToken = (s && s.token) || "";
      })
      .catch(function () {});
  }
})();
