/* =========================================================================
   小窝 · 手机版脚本
   渲染手机版首页 + 白天/黑夜切换。数据同样来自 site-data.js 和 posts.js，
   所以在后台改了内容，手机版会跟着一起变。
   ========================================================================= */

(function () {
  "use strict";

  var root = document.documentElement;
  var $ = function (s, el) { return (el || document).querySelector(s); };
  var reduced = function () {
    return window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  };

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  var SITE = window.SITE || {};
  var POSTS = (window.POSTS || []).slice().sort(function (a, b) {
    return a.date < b.date ? 1 : -1;
  });

  var year = String(new Date().getFullYear());

  /* ============================================================ 主题 */

  var KEY = "hut-theme";

  function isNight() { return root.getAttribute("data-theme") === "night"; }

  function syncBtn() {
    var btn = $("#theme-toggle");
    if (!btn) { return; }
    var night = isNight();
    btn.setAttribute("aria-label", night ? "切换到白天模式" : "切换到夜间模式");
  }

  function applyTheme(night) {
    if (night) { root.setAttribute("data-theme", "night"); }
    else { root.removeAttribute("data-theme"); }
  }

  function switchTheme(x, y) {
    var night = !isNight();
    var run = function () { applyTheme(night); };
    var done = function () { root.classList.remove("vt-active"); };

    if (document.startViewTransition && !reduced()) {
      root.style.setProperty("--vt-x", (x == null ? window.innerWidth / 2 : x) + "px");
      root.style.setProperty("--vt-y", (y == null ? 60 : y) + "px");
      root.classList.add("vt-active");
      var t = document.startViewTransition(run);
      if (t.finished && t.finished.then) { t.finished.then(done, done); }
      else { setTimeout(done, 700); }
    } else {
      run();
    }

    try { localStorage.setItem(KEY, night ? "night" : "day"); } catch (e) {}
    syncBtn();
  }

  syncBtn();
  var btn = $("#theme-toggle");
  if (btn) {
    btn.addEventListener("click", function () {
      var r = btn.getBoundingClientRect();
      switchTheme(r.left + r.width / 2, r.top + r.height / 2);
    });
  }

  /* ========================================================== 渲染 */

  var name = SITE.author || "我";

  var avatar = $("#m-avatar");
  if (avatar) {
    var initial = name.slice(0, 1).toUpperCase();
    var av = String(SITE.avatar || "").trim();
    if (av) {
      var avImg = document.createElement("img");
      avImg.alt = name;
      avImg.onerror = function () {
        avatar.innerHTML = "";
        avatar.textContent = initial;
      };
      avImg.src = av;
      avatar.textContent = "";
      avatar.appendChild(avImg);
    } else {
      avatar.textContent = initial;
    }
  }

  var nameEl = $("#m-name");
  if (nameEl) { nameEl.textContent = name; }

  var subEl = $("#m-sub");
  if (subEl) {
    var sub = String(SITE.tagline || "").split("。")[0];
    var klass = (SITE.facts || []).filter(function (f) { return /计应|班/.test(f); })[0];
    if (klass) { sub = sub ? sub + " · " + klass : klass; }
    subEl.textContent = sub || "欢迎来我的小窝";
  }

  var eyebrow = $("#m-eyebrow");
  if (eyebrow && SITE.eyebrow) { eyebrow.textContent = SITE.eyebrow + " · " + year; }

  var helloTitle = $("#m-hello-title");
  if (helloTitle && SITE.heroTitle) { helloTitle.innerHTML = SITE.heroTitle; }

  var helloText = $("#m-hello-text");
  if (helloText && SITE.heroText) { helloText.innerHTML = SITE.heroText; }

  var facts = $("#m-facts");
  if (facts && SITE.facts && SITE.facts.length) {
    facts.innerHTML = SITE.facts.map(function (f) {
      return "<li>" + esc(f) + "</li>";
    }).join("");
  }

  var postsHost = $("#m-posts");
  if (postsHost) {
    var top = POSTS.slice(0, 4);
    postsHost.innerHTML = top.length ? top.map(function (p) {
      var tags = (p.tags || []).map(function (t) { return "<li>" + esc(t) + "</li>"; }).join("");
      return '<a class="m-post" href="post.html?p=' + encodeURIComponent(p.slug) + '">' +
        '<time datetime="' + esc(p.date) + '">' + esc(p.date) + "</time>" +
        "<h3>" + esc(p.title) + "</h3>" +
        "<p>" + esc(p.excerpt) + "</p>" +
        (tags ? '<ul class="tags">' + tags + "</ul>" : "") +
      "</a>";
    }).join("") : "<p>还没有文章。</p>";
  }

  var notesHost = $("#m-notes");
  if (notesHost && SITE.notes && SITE.notes.length) {
    notesHost.innerHTML = SITE.notes.slice(0, 4).map(function (n) {
      return '<li><time datetime="' + esc(n.date) + '">' + esc(String(n.date || "").slice(5)) +
             "</time>" + esc(n.text) + "</li>";
    }).join("");
  }

  var years = document.querySelectorAll(".js-year");
  Array.prototype.forEach.call(years, function (el) { el.textContent = year; });

  /* 手机版里的链接也用淡出动画，和电脑版一致 */
  document.addEventListener("click", function (e) {
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey) { return; }
    var a = e.target.closest ? e.target.closest("a") : null;
    if (!a) { return; }
    var href = a.getAttribute("href") || "";
    if (a.target === "_blank" || !href || href.charAt(0) === "#" || /^[a-z]+:/i.test(href)) { return; }
    if (href.indexOf(".html") < 0) { return; }
    if (reduced()) { return; }
    e.preventDefault();
    document.body.style.opacity = "0";
    document.body.style.transform = "translateY(-6px)";
    setTimeout(function () { window.location.href = href; }, 160);
  });

  /* 滚一点，顶部条收起来，和电脑版一个脾气 */
  var scrolling = false;
  window.addEventListener("scroll", function () {
    if (scrolling) { return; }
    scrolling = true;
    requestAnimationFrame(function () {
      var s = window.scrollY > 24;
      if (s !== document.body.classList.contains("scrolled")) {
        document.body.classList.toggle("scrolled", s);
      }
      scrolling = false;
    });
  }, { passive: true });
})();
