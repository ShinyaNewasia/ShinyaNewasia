/* =========================================================================
   小窝 · 交互套件（kit）
   这套东西是从 XinghuisamaBlogs（XHBlogs，一个 Next.js + FastAPI 的博客系统）
   里挑出来的几件事，重写成不依赖框架的 vanilla JS，配色全部换成小窝自己的紫色：

     ① 点击涟漪 —— 点哪儿，哪儿像水面一样散开（canvas）
     ② 全站搜索 —— Ctrl+K / 点放大镜，标题·摘要·标签·正文一起搜
     ③ 文章目录 —— 文章页右侧跟随，滚动自动高亮，点击平滑跳转
     ④ 阅读增强 —— 字数/阅读时长、代码块一键复制、标题锚点
     ⑤ 氛围特效 —— 樱花 / 雪 / 萤火 / 雨，一键切换并记住

   载入顺序要紧：site-data.js → posts.js → site.js → kit.js
   （目录要等 site.js 把正文渲染出来才能扫到标题）
   ========================================================================= */

(function () {
  "use strict";

  var root = document.documentElement;
  var body = document.body;
  var $ = function (sel, el) { return (el || document).querySelector(sel); };
  var $$ = function (sel, el) {
    return Array.prototype.slice.call((el || document).querySelectorAll(sel));
  };
  var reduced = function () {
    return window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  };
  var coarse = function () {
    return window.matchMedia && window.matchMedia("(pointer: coarse)").matches;
  };

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  /* 把一段 HTML 拍成纯文字，搜索和字数统计都用它 */
  function plain(html) {
    var d = document.createElement("div");
    d.innerHTML = String(html == null ? "" : html);
    return String(d.textContent || "").replace(/\s+/g, " ").trim();
  }

  var SITE = window.SITE || {};
  var POSTS = (window.POSTS || []).slice().sort(function (a, b) {
    return a.date < b.date ? 1 : -1;
  });

  /* 底部冒一句小提示，自己会消失 */
  var toastTimer = null;
  function toast(msg) {
    var el = $("#kit-toast");
    if (!el) {
      el = document.createElement("div");
      el.id = "kit-toast";
      el.className = "kit-toast";
      el.setAttribute("role", "status");
      body.appendChild(el);
    }
    el.textContent = msg;
    el.hidden = false;
    requestAnimationFrame(function () { el.classList.add("show"); });
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () {
      el.classList.remove("show");
      setTimeout(function () { el.hidden = true; }, 420);
    }, 1900);
  }

  /* 带偏移的平滑滚动。动画期间先把 CSS 的 scroll-behavior 关掉，
     不然浏览器的平滑滚动会和这里的每一帧打架，滚起来一卡一卡的。 */
  function scrollToY(targetY, dur) {
    var max = root.scrollHeight - window.innerHeight;
    var to = Math.max(0, Math.min(max, targetY));
    if (reduced() || dur <= 0) { window.scrollTo(0, to); return; }

    var startY = window.scrollY;
    var dist = to - startY;
    if (Math.abs(dist) < 2) { return; }

    var prev = root.style.scrollBehavior;
    root.style.scrollBehavior = "auto";
    var t0 = null;
    var total = dur || 620;

    function easeInOutCubic(t) {
      return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
    }

    function step(now) {
      if (t0 === null) { t0 = now; }
      var p = Math.min(1, (now - t0) / total);
      window.scrollTo(0, startY + dist * easeInOutCubic(p));
      if (p < 1) { requestAnimationFrame(step); }
      else { root.style.scrollBehavior = prev; }
    }
    requestAnimationFrame(step);
  }

  /* ======================================================== ① 点击涟漪

     原版（XHBlogs 的 ClickEffect）是一个永不停歇的 requestAnimationFrame 循环，
     哪怕屏幕上什么都没有也在空转。这里改成"有涟漪才跑，跑完就停"，
     静止时一行代码都不执行。 */

  (function () {
    if (reduced()) { return; }

    var canvas = document.createElement("canvas");
    canvas.className = "ripple-canvas";
    canvas.setAttribute("aria-hidden", "true");
    body.appendChild(canvas);

    var ctx = canvas.getContext("2d");
    if (!ctx) { return; }

    var dpr = 1;
    function resize() {
      dpr = Math.min(2, window.devicePixelRatio || 1);
      canvas.width = Math.round(window.innerWidth * dpr);
      canvas.height = Math.round(window.innerHeight * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }
    resize();
    window.addEventListener("resize", resize);

    var ripples = [];
    var running = false;
    var lastT = 0;

    function tint() {
      var c = getComputedStyle(root).getPropertyValue("--kit-ripple").trim();
      return c || "rgba(124, 58, 237, .55)";
    }

    function spawn(x, y) {
      /* 最多留 12 个，手快乱点也不会堆成一片 */
      if (ripples.length > 12) { ripples.shift(); }
      ripples.push({ x: x, y: y, r: 0, v: 2.6, o: 0.55, c: tint() });
      if (!running) { running = true; requestAnimationFrame(frame); }
    }

    /* 按真实时间推进，而不是按帧数：
       60Hz 上是 0.55 秒散完，144Hz 上也是 0.55 秒——
       否则刷新率越高，涟漪消失得越快。 */
    function frame(now) {
      if (!lastT) { lastT = now; }
      var dt = Math.min(48, now - lastT);
      lastT = now;
      var k = dt / 16.667;

      ctx.clearRect(0, 0, window.innerWidth, window.innerHeight);

      for (var i = ripples.length - 1; i >= 0; i--) {
        var rp = ripples[i];
        rp.r += rp.v * k;
        rp.v *= Math.pow(0.955, k);   /* 越铺越慢，像真的水面 */
        rp.o -= 0.016 * k;

        if (rp.o <= 0) { ripples.splice(i, 1); continue; }

        ctx.beginPath();
        ctx.arc(rp.x, rp.y, rp.r, 0, Math.PI * 2);
        ctx.strokeStyle = rp.c.replace(/[\d.]+\)$/, rp.o.toFixed(3) + ")");
        ctx.lineWidth = 2;
        ctx.stroke();

        ctx.beginPath();
        ctx.arc(rp.x, rp.y, rp.r * 0.45, 0, Math.PI * 2);
        ctx.fillStyle = rp.c.replace(/[\d.]+\)$/, (rp.o * 0.22).toFixed(3) + ")");
        ctx.fill();
      }

      if (ripples.length) { requestAnimationFrame(frame); }
      else {
        running = false;
        lastT = 0;
        ctx.clearRect(0, 0, window.innerWidth, window.innerHeight);
      }
    }

    document.addEventListener("pointerdown", function (e) {
      /* 右键和拖动不算 */
      if (e.button != null && e.button !== 0) { return; }
      spawn(e.clientX, e.clientY);
    }, { passive: true });
  })();

  /* ======================================================== ② 全站搜索 */

  (function () {
    if (!POSTS.length) { return; }

    /* 先把每篇文章拍成可搜的纯文字，只算一次 */
    var index = POSTS.map(function (p) {
      return {
        post: p,
        title: String(p.title || "").toLowerCase(),
        excerpt: String(p.excerpt || "").toLowerCase(),
        tags: (p.tags || []).join(" ").toLowerCase(),
        text: plain(p.body).toLowerCase(),
        raw: plain(p.body)
      };
    });

    var modal = document.createElement("div");
    modal.className = "search-modal";
    modal.hidden = true;
    modal.innerHTML =
      '<div class="search-veil" data-close></div>' +
      '<div class="search-panel" role="dialog" aria-modal="true" aria-label="搜索本站">' +
        '<div class="search-field">' +
          '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true">' +
            '<circle cx="11" cy="11" r="7.5"/><path d="M21 21l-4.6-4.6"/></svg>' +
          '<input id="kit-search-input" type="text" autocomplete="off" spellcheck="false" ' +
            'placeholder="搜标题、摘要、标签，或者正文里的某个词…" aria-label="搜索关键词">' +
          "<kbd>Esc</kbd>" +
        "</div>" +
        '<p class="search-meta" id="kit-search-meta"></p>' +
        '<ul class="search-results" id="kit-search-results"></ul>' +
        '<div class="search-foot">' +
          "<span><b>↑↓</b>选择</span><span><b>↵</b>打开</span>" +
          "<span><b>Ctrl K</b>随时唤起</span><span><b>Esc</b>关掉</span>" +
        "</div>" +
      "</div>";
    body.appendChild(modal);

    var input = $("#kit-search-input", modal);
    var metaEl = $("#kit-search-meta", modal);
    var resultEl = $("#kit-search-results", modal);
    var opened = false;
    var cursor = -1;
    var lastFocus = null;

    /* 截一段命中位置前后的话，让结果看起来有上下文 */
    function snippet(item, q) {
      var raw = item.raw;
      if (!raw) { return ""; }
      var at = raw.toLowerCase().indexOf(q);
      if (at < 0) { return raw.slice(0, 92) + (raw.length > 92 ? "…" : ""); }
      var from = Math.max(0, at - 34);
      var to = Math.min(raw.length, at + q.length + 58);
      return (from > 0 ? "…" : "") + raw.slice(from, to) + (to < raw.length ? "…" : "");
    }

    /* 把命中的那段包成 <mark>；先切分再转义，免得把标签切开 */
    function hilite(text, q) {
      var s = String(text == null ? "" : text);
      if (!q) { return esc(s); }
      var lower = s.toLowerCase();
      var out = "";
      var at = 0;
      var found = lower.indexOf(q, at);
      var guard = 0;
      while (found >= 0 && guard++ < 40) {
        out += esc(s.slice(at, found)) + "<mark>" + esc(s.slice(found, found + q.length)) + "</mark>";
        at = found + q.length;
        found = lower.indexOf(q, at);
      }
      return out + esc(s.slice(at));
    }

    var results = [];

    function render(q) {
      var query = q.trim().toLowerCase();
      cursor = -1;

      if (!query) {
        results = [];
        metaEl.textContent = "点下面的结果，或者直接敲关键词。共 " + POSTS.length + " 篇文章。";
        resultEl.innerHTML =
          '<li><div class="search-empty">' +
          '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><circle cx="11" cy="11" r="7.5"/><path d="M21 21l-4.6-4.6"/></svg>' +
          "<p>输入关键词就开始搜。<br>标题、摘要、标签、正文，哪儿命中都算。</p></div></li>";
        return;
      }

      results = index.filter(function (it) {
        return it.title.indexOf(query) >= 0 || it.excerpt.indexOf(query) >= 0 ||
               it.tags.indexOf(query) >= 0 || it.text.indexOf(query) >= 0;
      }).map(function (it) {
        /* 命中标题的排前面 */
        var score = it.title.indexOf(query) >= 0 ? 0
                  : it.tags.indexOf(query) >= 0 ? 1
                  : it.excerpt.indexOf(query) >= 0 ? 2 : 3;
        return { it: it, score: score };
      }).sort(function (a, b) {
        return a.score - b.score || (a.it.post.date < b.it.post.date ? 1 : -1);
      }).slice(0, 24).map(function (x) { return x.it; });

      if (!results.length) {
        metaEl.textContent = "一个都没找到";
        resultEl.innerHTML =
          '<li><div class="search-empty">' +
          '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><circle cx="11" cy="11" r="7.5"/><path d="M21 21l-4.6-4.6"/></svg>' +
          "<p>没找到「<b>" + esc(q.trim()) + "</b>」。<br>换个短一点的词试试？</p></div></li>";
        return;
      }

      metaEl.textContent = "找到 " + results.length + " 篇";

      resultEl.innerHTML = results.map(function (it, i) {
        var p = it.post;
        var tags = (p.tags || []).map(function (t) {
          return "<li>" + hilite(t, query) + "</li>";
        }).join("");
        return '<li><a href="post.html?p=' + encodeURIComponent(p.slug) + '" data-i="' + i + '">' +
          "<h4><span>" + hilite(p.title, query) + "</span>" +
            (p.date ? '<time datetime="' + esc(p.date) + '">' + esc(p.date) + "</time>" : "") +
          "</h4>" +
          "<p>" + hilite(snippet(it, query), query) + "</p>" +
          (tags ? '<ul class="tags">' + tags + "</ul>" : "") +
        "</a></li>";
      }).join("");
    }

    function move(step) {
      var links = $$("a", resultEl);
      if (!links.length) { return; }
      cursor += step;
      if (cursor < 0) { cursor = links.length - 1; }
      if (cursor >= links.length) { cursor = 0; }
      links.forEach(function (a, i) { a.classList.toggle("on", i === cursor); });
      var box = resultEl;
      var active = links[cursor];
      var top = active.offsetTop - box.offsetTop;
      if (top < box.scrollTop) { box.scrollTop = top - 8; }
      else if (top + active.offsetHeight > box.scrollTop + box.clientHeight) {
        box.scrollTop = top + active.offsetHeight - box.clientHeight + 8;
      }
    }

    function open(q) {
      if (opened) { return; }
      opened = true;
      lastFocus = document.activeElement;
      modal.hidden = false;
      render(q || "");
      requestAnimationFrame(function () { modal.classList.add("on"); });
      setTimeout(function () { input.focus(); input.select(); }, 30);
    }

    function close() {
      if (!opened) { return; }
      opened = false;
      modal.classList.remove("on");
      setTimeout(function () {
        modal.hidden = true;
        input.value = "";
      }, 260);
      if (lastFocus && lastFocus.focus) { lastFocus.focus(); }
    }

    input.addEventListener("input", function () { render(input.value); });

    modal.addEventListener("click", function (e) {
      if (e.target.hasAttribute && e.target.hasAttribute("data-close")) { close(); }
    });

    /* 点结果不做拦截——交给 site.js 那个淡出切页的监听去跳 */
    resultEl.addEventListener("click", function (e) {
      if (e.target.closest && e.target.closest("a")) { close(); }
    });

    document.addEventListener("keydown", function (e) {
      var key = e.key;

      if ((e.ctrlKey || e.metaKey) && (key === "k" || key === "K")) {
        e.preventDefault();
        if (opened) { close(); } else { open(""); }
        return;
      }

      if (!opened) {
        /* 不在输入框里的时候，按 / 直接开搜索 */
        var t = e.target;
        var typing = t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable);
        if (key === "/" && !typing && !e.ctrlKey && !e.metaKey && !e.altKey) {
          e.preventDefault();
          open("");
        }
        return;
      }

      if (key === "Escape") { e.preventDefault(); close(); return; }
      if (key === "ArrowDown") { e.preventDefault(); move(1); return; }
      if (key === "ArrowUp") { e.preventDefault(); move(-1); return; }
      if (key === "Enter") {
        var links = $$("a", resultEl);
        if (links.length) {
          e.preventDefault();
          links[cursor < 0 ? 0 : cursor].click();
        }
      }
    });

    /* 顶栏上的放大镜 */
    var btn = document.createElement("button");
    btn.type = "button";
    btn.className = "theme-btn kit-btn";
    btn.id = "kit-search-btn";
    btn.setAttribute("aria-label", "搜索本站（Ctrl + K）");
    btn.setAttribute("title", "搜索本站 · Ctrl + K");
    btn.innerHTML =
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" aria-hidden="true">' +
        '<circle cx="11" cy="11" r="7"/><path d="M20.5 20.5l-4.4-4.4"/></svg>';
    btn.addEventListener("click", function () { open(""); });
    mountHeaderButton(btn);
  })();

  /* 把按钮塞进顶栏。电脑版塞在主题按钮前面，手机版塞在 m-top 里。 */
  function mountHeaderButton(el) {
    var nav = $(".site-head nav");
    if (nav) {
      var theme = $("#theme-toggle", nav);
      if (theme) { nav.insertBefore(el, theme); }
      else { nav.appendChild(el); }
      return;
    }
    var mTop = $(".m-top");
    if (mTop) { mTop.appendChild(el); }
  }

  /* ======================================================== ③ 文章目录 */

  (function () {
    var host = $("#post-body");
    if (!host) { return; }

    var heads = $$("h1, h2, h3", host);
    if (!heads.length) { return; }

    /* 标题的 id：去掉标点和空格，中文留着，重复的加序号。
       目的是"同一个标题每次都得到同一个锚点"，这样链接才能分享。 */
    function makeId(text, used) {
      var base = "h-" + String(text).replace(/[^\u4e00-\u9fa5a-zA-Z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "").toLowerCase();
      if (base === "h-") { base = "h-sec"; }
      var id = base;
      var n = 2;
      while (used[id]) { id = base + "-" + n++; }
      used[id] = true;
      return id;
    }

    var used = {};
    var items = [];

    heads.forEach(function (h) {
      var text = String(h.textContent || "").trim();
      if (!text) { return; }
      var id = makeId(text, used);
      h.id = id;

      /* 悬停时露出来的那个 #，点一下地址栏就带上锚点 */
      var a = document.createElement("a");
      a.className = "h-anchor";
      a.href = "#" + id;
      a.textContent = "#";
      a.setAttribute("aria-label", "复制这一节的链接");
      a.setAttribute("title", "这一节的链接");
      h.appendChild(a);

      items.push({ id: id, text: text, level: h.tagName === "H1" ? 1 : (h.tagName === "H2" ? 2 : 3) });
    });

    if (items.length < 2) { return; }

    function linksHTML() {
      return items.map(function (it) {
        return '<li class="lv-' + it.level + '"><a href="#' + it.id + '" data-toc="' + it.id + '">' +
               esc(it.text) + "</a></li>";
      }).join("");
    }

    /* 桌面版：右侧那一栏 */
    var col = $(".toc-col");
    if (col) {
      col.innerHTML =
        '<div class="toc-card">' +
          '<p class="toc-title">目录</p>' +
          '<ul class="toc-list">' + linksHTML() + "</ul>" +
        "</div>";
    }

    /* 窄屏：浮动按钮 + 底部抽屉 */
    var fab = document.createElement("button");
    fab.type = "button";
    fab.className = "toc-fab";
    fab.setAttribute("aria-label", "打开目录");
    fab.innerHTML =
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true">' +
        '<path d="M4 6h16M4 12h11M4 18h7"/></svg>';
    body.appendChild(fab);

    var veil = document.createElement("div");
    veil.className = "toc-sheet-veil";
    veil.hidden = true;
    var sheet = document.createElement("div");
    sheet.className = "toc-sheet";
    sheet.hidden = true;
    sheet.innerHTML =
      '<div class="toc-sheet-head"><span>目录</span><button type="button" aria-label="关掉目录">×</button></div>' +
      '<ul class="toc-list">' + linksHTML() + "</ul>";
    body.appendChild(veil);
    body.appendChild(sheet);

    function openSheet() {
      veil.hidden = false;
      sheet.hidden = false;
      requestAnimationFrame(function () {
        veil.classList.add("on");
        sheet.classList.add("on");
      });
    }
    function closeSheet() {
      veil.classList.remove("on");
      sheet.classList.remove("on");
      setTimeout(function () { veil.hidden = true; sheet.hidden = true; }, 420);
    }

    fab.addEventListener("click", openSheet);
    veil.addEventListener("click", closeSheet);
    $("button", sheet).addEventListener("click", closeSheet);
    sheet.addEventListener("click", function (e) {
      if (e.target.closest && e.target.closest("a[data-toc]")) {
        setTimeout(closeSheet, 120);
      }
    });

    /* 目录里点一下：滑过去，别用浏览器的默认跳转，
       因为顶部那条导航是吸顶的，默认跳转会正好被它盖住 */
    function jump(id) {
      var target = document.getElementById(id);
      if (!target) { return; }
      var y = target.getBoundingClientRect().top + window.scrollY - 88;
      scrollToY(y, 640);
      if (history.replaceState) { history.replaceState(null, "", "#" + id); }
      setActive(id);
    }

    document.addEventListener("click", function (e) {
      var a = e.target.closest ? e.target.closest('a[data-toc], a.h-anchor') : null;
      if (!a) { return; }
      var id = a.getAttribute("data-toc") ||
               (a.getAttribute("href") || "").replace(/^#/, "");
      if (!id || !document.getElementById(id)) { return; }
      e.preventDefault();
      jump(id);
    });

    var allLinks = $$("a[data-toc]", document);

    function setActive(id) {
      allLinks.forEach(function (a) { a.classList.toggle("on", a.getAttribute("data-toc") === id); });
    }

    var ticking = false;
    function spy() {
      if (ticking) { return; }
      ticking = true;
      requestAnimationFrame(function () {
        var line = 132;
        var current = items[0].id;
        for (var i = 0; i < items.length; i++) {
          var el = document.getElementById(items[i].id);
          if (!el) { continue; }
          if (el.getBoundingClientRect().top <= line) { current = items[i].id; }
          else { break; }
        }
        /* 已经滚到最底了，就把最后一个点亮，别让高亮卡在中间 */
        if (window.innerHeight + window.scrollY >= root.scrollHeight - 4) {
          current = items[items.length - 1].id;
        }
        setActive(current);
        ticking = false;
      });
    }

    window.addEventListener("scroll", spy, { passive: true });
    window.addEventListener("resize", spy);
    spy();
  })();

  /* ======================================================== ④ 阅读增强 */

  (function () {
    var host = $("#post-body");
    if (!host) { return; }

    /* --- 字数 / 阅读时长 --- */
    var raw = String(host.textContent || "");
    var cjk = (raw.match(/[\u4e00-\u9fa5]/g) || []).length;
    var words = (raw.replace(/[\u4e00-\u9fa5]/g, " ").match(/[A-Za-z0-9_'-]+/g) || []).length;
    var total = cjk + words;
    var minutes = Math.max(1, Math.round(cjk / 340 + words / 200));

    var meta = $(".post-meta");
    if (meta && total > 0) {
      var box = document.createElement("span");
      box.className = "read-meta";
      box.title = "按每分钟 340 字估的，别太当真";
      box.innerHTML =
        '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" aria-hidden="true">' +
          '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/></svg>' +
        "<span>约 " + minutes + " 分钟 · " + total.toLocaleString("zh-CN") + " 字</span>";
      meta.appendChild(box);
    }

    /* --- 代码块：语言角标 + 一键复制 --- */
    $$(".prose pre", host).forEach(function (pre) {
      if (pre.parentNode && pre.parentNode.classList &&
          pre.parentNode.classList.contains("code-wrap")) { return; }

      var code = pre.querySelector("code");
      var text = code ? code.textContent : pre.textContent;
      if (!String(text || "").trim()) { return; }

      var lang = "";
      if (code && code.className) {
        var m = String(code.className).match(/(?:language|lang)-([\w+#-]+)/i);
        if (m) { lang = m[1]; }
      }

      var wrap = document.createElement("div");
      wrap.className = "code-wrap";
      pre.parentNode.insertBefore(wrap, pre);
      wrap.appendChild(pre);

      var bar = document.createElement("div");
      bar.className = "code-bar";
      bar.innerHTML =
        (lang ? '<span class="code-lang">' + esc(lang) + "</span>" : "") +
        '<button class="code-copy" type="button">' +
          '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
            '<rect x="9" y="9" width="11" height="11" rx="2.5"/><path d="M15 5.5A2.5 2.5 0 0 0 12.5 3h-6A3.5 3.5 0 0 0 3 6.5v6A2.5 2.5 0 0 0 5.5 15"/></svg>' +
          "<span>复制</span>" +
        "</button>";
      wrap.appendChild(bar);

      var btn = $(".code-copy", bar);
      var label = $("span", btn);

      btn.addEventListener("click", function () {
        var payload = code ? code.textContent : pre.textContent;
        payload = String(payload || "").replace(/\s+$/, "");

        function done() {
          btn.classList.add("done");
          label.textContent = "已复制";
          setTimeout(function () {
            btn.classList.remove("done");
            label.textContent = "复制";
          }, 1600);
        }

        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(payload).then(done, function () { fallback(payload, done); });
        } else {
          fallback(payload, done);
        }
      });

      /* 老浏览器 / 非安全上下文里 navigator.clipboard 是没有的 */
      function fallback(text, cb) {
        try {
          var ta = document.createElement("textarea");
          ta.value = text;
          ta.setAttribute("readonly", "");
          ta.style.position = "fixed";
          ta.style.top = "-1000px";
          body.appendChild(ta);
          ta.select();
          document.execCommand("copy");
          ta.remove();
          cb();
        } catch (e) { toast("这个浏览器不给复制，只能手选了"); }
      }
    });
  })();

  /* ======================================================== ⑤ 氛围特效

     原先在 XHBlogs 里是四个各自独立的组件（Sakura / GlobalSnow /
     Fireflies / WeatherEffect），一上来就全开着。这里合成一层，
     顶栏一个按钮切换，选择记在浏览器里，默认关着——想看的时候自己开。 */

  (function () {
    var KEY = "hut-ambient";
    var MODES = ["off", "petal", "snow", "fly", "rain"];
    var NAME = { off: "关掉", petal: "樱花", snow: "下雪", fly: "萤火", rain: "小雨" };

    var ICONS = {
      off: '<path d="M12 3.5l1.9 5.1 5.1 1.9-5.1 1.9L12 17.5l-1.9-5.1L5 10.5l5.1-1.9z"/>',
      petal: '<path d="M12 3.2c3.1 3.2 4.7 6.2 4.7 9.1a4.7 4.7 0 1 1-9.4 0c0-2.9 1.6-5.9 4.7-9.1z"/>',
      snow: '<path d="M12 3v18M4.4 7.5l15.2 9M19.6 7.5l-15.2 9"/>',
      fly: '<circle cx="12" cy="12" r="3.2"/><path d="M12 3.5v2.4M12 18.1v2.4M3.5 12h2.4M18.1 12h2.4"/>',
      rain: '<path d="M6.5 14.5a4 4 0 0 1 .6-7.9A5.5 5.5 0 0 1 17.7 7.4a3.6 3.6 0 0 1-.5 7.1z"/><path d="M9 17.5l-1 3M13 17.5l-1 3M17 17.5l-1 3"/>'
    };

    var layer = document.createElement("div");
    layer.className = "ambient";
    layer.setAttribute("aria-hidden", "true");
    body.appendChild(layer);

    var mode = "off";
    try {
      var saved = localStorage.getItem(KEY);
      if (saved && MODES.indexOf(saved) >= 0) { mode = saved; }
    } catch (e) {}

    function seed(n) {
      /* 每次刷新都长得不一样，但同一次浏览里稳定 */
      return Math.random() * n;
    }

    function fill() {
      layer.innerHTML = "";
      if (mode === "off") { return; }

      var w = window.innerWidth;
      var narrow = w < 900;
      if (mode === "rain") {
        var drops = narrow ? 40 : 90;
        for (var r = 0; r < drops; r++) {
          var d = document.createElement("span");
          d.className = "amb drop";
          var h = 10 + seed(16);
          d.style.left = seed(112) - 6 + "%";
          d.style.width = "1.5px";
          d.style.height = h.toFixed(1) + "px";
          d.style.opacity = (0.25 + seed(0.4)).toFixed(2);
          d.style.setProperty("--sway", (-2 - seed(4)).toFixed(1) + "vw");
          d.style.setProperty("--dur", (0.55 + seed(0.5)).toFixed(2) + "s");
          d.style.animationDelay = (-seed(2)).toFixed(2) + "s";
          layer.appendChild(d);
        }
        return;
      }

      var count = mode === "fly" ? (narrow ? 16 : 38)
                : mode === "snow" ? (narrow ? 22 : 62)
                : (narrow ? 18 : 40);
      for (var i = 0; i < count; i++) {
        var el = document.createElement("span");
        el.className = "amb " + (mode === "petal" ? "petal" : mode === "snow" ? "flake" : "fly");

        if (mode === "fly") {
          var size = 2 + seed(4);
          el.style.left = seed(100) + "%";
          el.style.top = 8 + seed(84) + "%";
          el.style.width = size.toFixed(1) + "px";
          el.style.height = size.toFixed(1) + "px";
          el.style.setProperty("--dx", (-4 - seed(9)).toFixed(1) + "vw");
          el.style.setProperty("--dy", (-3 - seed(7)).toFixed(1) + "vh");
          el.style.setProperty("--dur", (2.6 + seed(5)).toFixed(1) + "s");
          el.style.setProperty("--dur2", (16 + seed(22)).toFixed(1) + "s");
          el.style.animationDelay = (-seed(8)).toFixed(1) + "s, " + (-seed(24)).toFixed(1) + "s";
        } else {
          var s = mode === "petal" ? 7 + seed(11) : 3 + seed(5.5);
          el.style.left = seed(100) + "%";
          el.style.width = s.toFixed(1) + "px";
          el.style.height = (mode === "petal" ? s * 1.15 : s).toFixed(1) + "px";
          el.style.opacity = mode === "snow" ? (0.4 + seed(0.5)).toFixed(2) : "";
          el.style.setProperty("--sway", (2 + seed(14)).toFixed(1) + "vw");
          el.style.setProperty("--spin", Math.round(200 + seed(420)) + "deg");
          el.style.setProperty("--dur", (mode === "petal" ? 8 + seed(10) : 9 + seed(11)).toFixed(1) + "s");
          el.style.animationDelay = (-seed(18)).toFixed(1) + "s";
        }
        layer.appendChild(el);
      }
    }

    var btn = document.createElement("button");
    btn.type = "button";
    btn.className = "theme-btn kit-btn";
    btn.id = "kit-ambient-btn";
    function paint() {
      btn.innerHTML =
        '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" ' +
        'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + ICONS[mode] + "</svg>";
      btn.setAttribute("aria-label", "氛围特效：" + NAME[mode]);
      btn.setAttribute("title", "氛围特效：" + NAME[mode] + "（点一下换一种）");
      btn.setAttribute("aria-pressed", mode === "off" ? "false" : "true");
    }
    paint();

    var hinted = false;
    btn.addEventListener("click", function () {
      mode = MODES[(MODES.indexOf(mode) + 1) % MODES.length];
      try { localStorage.setItem(KEY, mode); } catch (e) {}
      paint();
      fill();

      var msg = "氛围特效：" + NAME[mode];
      /* 这台电脑如果关了系统动画，站里其它动效都是静止的；
         氛围特效因为是"你亲手按开"的，照常跑。第一次说一句，免得奇怪。 */
      if (reduced() && mode !== "off" && !hinted) {
        hinted = true;
        msg += " · 系统关了动画，本站其它动效是静止的，这个照常跑";
      }
      toast(msg);
    });

    mountHeaderButton(btn);

    var rt = null;
    window.addEventListener("resize", function () {
      clearTimeout(rt);
      rt = setTimeout(fill, 300);
    });

    fill();
  })();
})();
