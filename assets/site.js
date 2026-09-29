/* =========================================================================
   小窝 · 交互脚本
   主题切换（圆形扩散）· 导航滑块 · 滚动进度 · 页面切换淡出 · 内容渲染
   内容本身在 site-data.js 和 posts.js 里，这个文件一般不用动。
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

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  /* 数据里允许写少量 HTML（比如 <b>、<strong>），所以这两个不转义 */
  function setHTML(sel, value) {
    var el = $(sel);
    if (el && value != null && value !== "") { el.innerHTML = value; }
  }
  function setText(sel, value) {
    var el = $(sel);
    if (el && value != null && value !== "") { el.textContent = value; }
  }
  function tagsHTML(tags) {
    if (!tags || !tags.length) { return ""; }
    return '<ul class="tags">' + tags.map(function (t) {
      return "<li>" + esc(t) + "</li>";
    }).join("") + "</ul>";
  }

  var SITE = window.SITE || {};
  var POSTS = (window.POSTS || []).slice().sort(function (a, b) {
    return a.date < b.date ? 1 : -1;
  });

  /* ============================================================ 主题 */

  var KEY = "hut-theme";

  function isNight() { return root.getAttribute("data-theme") === "night"; }

  function syncThemeBtn() {
    var btn = $("#theme-toggle");
    if (!btn) { return; }
    var night = isNight();
    btn.setAttribute("aria-label", night ? "切换到白天模式" : "切换到夜间模式");
    btn.setAttribute("title", night ? "把灯打开" : "把灯关了");
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
    syncThemeBtn();
  }

  syncThemeBtn();
  var themeBtn = $("#theme-toggle");
  if (themeBtn) {
    themeBtn.addEventListener("click", function () {
      var r = themeBtn.getBoundingClientRect();
      switchTheme(r.left + r.width / 2, r.top + r.height / 2);
    });
  }

  /* ================================================== 导航滑块 / 进度条 */

  var nav = $(".site-head nav");
  var current = nav ? $('a[aria-current="page"]', nav) : null;
  var pill = null;

  if (nav && current) {
    pill = document.createElement("span");
    pill.className = "nav-pill";
    pill.setAttribute("aria-hidden", "true");
    nav.insertBefore(pill, nav.firstChild);

    var placeOn = function (el) {
      if (!el) { return; }
      pill.style.width = el.offsetWidth + "px";
      pill.style.transform = "translate(" + el.offsetLeft + "px, -50%)";
    };
    var place = function () { placeOn(current); };

    /* 先停在原位，下一帧再滑到当前页——这样每次进页面都有一段滑动 */
    requestAnimationFrame(function () {
      requestAnimationFrame(function () {
        place();
        requestAnimationFrame(function () { pill.classList.add("ready"); });
      });
    });

    /* 鼠标扫过哪一项，滑块就先跟到哪一项；离开整条导航再归位 */
    $$("a", nav).forEach(function (a) {
      a.addEventListener("mouseenter", function () { placeOn(a); });
      a.addEventListener("focus", function () { placeOn(a); });
      a.addEventListener("click", function () {
        pill.classList.add("pulse");
        setTimeout(function () { pill.classList.remove("pulse"); }, 420);
      });
    });
    nav.addEventListener("mouseleave", place);

    window.addEventListener("resize", place);
    window.addEventListener("load", place);
  }

  var bar = document.createElement("div");
  bar.className = "progress";
  body.appendChild(bar);

  var toTop = document.createElement("button");
  toTop.type = "button";
  toTop.className = "to-top";
  toTop.setAttribute("aria-label", "回到顶部");
  toTop.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 19V6M5.5 12.5 12 6l6.5 6.5"/></svg>';
  toTop.addEventListener("click", function () {
    window.scrollTo({ top: 0, behavior: reduced() ? "auto" : "smooth" });
  });
  body.appendChild(toTop);

  var ticking = false;
  function onScroll() {
    if (ticking) { return; }
    ticking = true;
    requestAnimationFrame(function () {
      var max = root.scrollHeight - window.innerHeight;
      var ratio = max > 0 ? Math.min(1, Math.max(0, window.scrollY / max)) : 0;
      bar.style.width = (ratio * 100) + "%";

      if (window.scrollY > 420) { toTop.classList.add("show"); }
      else { toTop.classList.remove("show"); }

      /* 滚过一点点，顶部栏就收窄 */
      var isScrolled = window.scrollY > 24;
      if (isScrolled !== body.classList.contains("scrolled")) {
        body.classList.toggle("scrolled", isScrolled);
      }

      ticking = false;
    });
  }
  window.addEventListener("scroll", onScroll, { passive: true });
  onScroll();

  /* ================================================ 跟着鼠标的那团光 */

  (function () {
    if (reduced()) { return; }
    /* 触摸屏没有鼠标，别浪费电 */
    if (window.matchMedia && !window.matchMedia("(pointer: fine)").matches) { return; }

    var glow = document.createElement("div");
    glow.className = "cursor-glow";
    glow.setAttribute("aria-hidden", "true");
    body.appendChild(glow);

    var gx = window.innerWidth / 2;
    var gy = window.innerHeight * 0.32;
    var shown = false;

    glow.style.transform = "translate3d(" + gx + "px," + gy + "px,0)";

    function follow(x, y) {
      glow.style.transform = "translate3d(" + x + "px," + y + "px,0)";
      if (!shown) {
        shown = true;
        glow.classList.add("on");
      }
    }

    document.addEventListener("mousemove", function (e) {
      follow(e.clientX, e.clientY);
    }, { passive: true });

    document.addEventListener("mousedown", function () { glow.classList.add("down"); });
    document.addEventListener("mouseup", function () { glow.classList.remove("down"); });

    /* 鼠标跑出窗口就淡掉，别停在边上 */
    document.addEventListener("mouseleave", function () {
      shown = false;
      glow.classList.remove("on");
    });
    window.addEventListener("blur", function () {
      shown = false;
      glow.classList.remove("on");
    });
  })();

  /* ==================================================== 页面切换淡出 */

  document.addEventListener("click", function (e) {
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) { return; }
    var a = e.target.closest ? e.target.closest("a") : null;
    if (!a) { return; }
    var href = a.getAttribute("href") || "";
    if (a.target === "_blank" || a.hasAttribute("download")) { return; }
    if (!href || href.charAt(0) === "#" || /^[a-z]+:/i.test(href)) { return; }
    if (href.indexOf(".html") < 0) { return; }
    if (reduced()) { return; }
    e.preventDefault();
    body.classList.add("leaving");
    setTimeout(function () { window.location.href = href; }, 170);
  });

  /* ==================================================== 页面内容渲染 */

  /* 页脚年份 */
  var year = String(new Date().getFullYear());
  $$(".js-year").forEach(function (el) { el.textContent = year; });

  /* 页脚此刻 */
  var nowEl = $("#now");
  if (nowEl) {
    var tick = function () {
      var d = new Date();
      var p = function (n) { return n < 10 ? "0" + n : String(n); };
      nowEl.textContent = p(d.getHours()) + ":" + p(d.getMinutes());
    };
    tick();
    setInterval(tick, 20000);
  }

  /* 站名 */
  if (SITE.brand) {
    $$(".brand").forEach(function (el) {
      el.innerHTML = esc(SITE.brand) + "<b>.</b>";
    });
  }

  /* ------------------------------------------------------------ 首页 */
  if ($("#intro-title")) {
    setHTML("#intro-title", SITE.heroTitle);
    setHTML("#intro-text", SITE.heroText);
    var eyebrow = $("#intro-eyebrow");
    if (eyebrow && SITE.eyebrow) {
      eyebrow.textContent = SITE.eyebrow + " · " + year;
    }
    if (SITE.facts && SITE.facts.length) {
      setHTML("#intro-facts", SITE.facts.map(function (f) {
        return "<li>" + esc(f) + "</li>";
      }).join(""));
    }
    if (SITE.notes && SITE.notes.length) {
      setHTML("#notes-list", SITE.notes.map(function (n) {
        var md = String(n.date || "").slice(5);
        return '<li><time datetime="' + esc(n.date) + '">' + esc(md) + "</time>" + esc(n.text) + "</li>";
      }).join(""));
    }
    if (SITE.now && SITE.now.length) {
      setHTML("#now-list", SITE.now.map(function (n) {
        return "<dt>" + esc(n.k) + "</dt><dd>" + esc(n.v) + "</dd>";
      }).join(""));
    }
    if (SITE.gear && SITE.gear.length) {
      setHTML("#gear-list", SITE.gear.map(function (g) {
        return "<li>" + esc(g.name) + " <span>" + esc(g.note) + "</span></li>";
      }).join(""));
    }
    if (SITE.shelf && SITE.shelf.length) {
      var firstGroup = SITE.shelf[0].items || [];
      setHTML("#places-list", firstGroup.slice(0, 4).map(function (it) {
        var short = String(it.note || "").split("。")[0];
        return '<li><a href="' + esc(it.url) + '" target="_blank" rel="noopener">' + esc(it.name) +
               "</a> <span>" + esc(short) + "</span></li>";
      }).join(""));
    }
    setText("#house-note", SITE.houseNote);
  }

  /* ------------------------------------------------------------ 关于 */
  if ($("#about-paragraphs")) {
    var about = SITE.about || {};
    if (about.paragraphs && about.paragraphs.length) {
      setHTML("#about-paragraphs", about.paragraphs.map(function (p) {
        return "<p>" + p + "</p>";
      }).join(""));
    }
    if (about.timeline && about.timeline.length) {
      setHTML("#about-timeline", about.timeline.map(function (t) {
        return "<li><time>" + esc(t.when) + "</time><p>" + t.text + "</p></li>";
      }).join(""));
    }
    if (about.contacts && about.contacts.length) {
      setHTML("#about-contacts", about.contacts.map(function (c) {
        var v = String(c.value || "");

        /* 邮箱和网址就该能点。判断一下再决定渲染成链接还是纯文字——
           像"计应2604"这种既不是邮箱也不是网址的，保持原样。 */
        var href = null;
        if (/^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/.test(v)) {
          href = "mailto:" + v;
        } else if (/^https?:\/\/\S+$/i.test(v)) {
          href = v;
        } else if (/^[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)+\S*$/.test(v)) {
          href = "https://" + v;
        }

        var inner = href
          ? '<a href="' + esc(href) + '"' +
            (href.indexOf("mailto:") === 0 ? "" : ' target="_blank" rel="noopener"') +
            ">" + esc(v) + "</a>"
          : "<span>" + esc(v) + "</span>";

        return "<li>" + esc(c.label) + " " + inner + "</li>";
      }).join(""));
    }
  }

  /* ---------------------------------------------------------- 收藏夹 */
  if ($("#shelf")) {
    setHTML("#shelf", (SITE.shelf || []).map(function (g) {
      var items = (g.items || []).map(function (it) {
        return "<li>" +
          '<div class="fav-head"><a href="' + esc(it.url) + '" target="_blank" rel="noopener">' +
          esc(it.name) + "</a><span class=\"fav-url\">" + esc(it.domain || "") + "</span></div>" +
          '<p class="fav-note">' + esc(it.note || "") + "</p>" +
        "</li>";
      }).join("");
      return '<section class="block">' +
        '<h2 class="block-title"><span>' + esc(g.group) + "</span><span>" + esc(g.hint || "") + "</span></h2>" +
        '<ul class="fav-list">' + items + "</ul>" +
      "</section>";
    }).join(""));

    var note = $("#friend-note");
    if (note && SITE.friendLinkNote) {
      note.innerHTML = "<p>" + esc(SITE.friendLinkNote) + "</p>" +
        '<pre><code>站名：你的站叫什么\n网址：https://example.com\n一句话：用一句话说清这个站在写什么\n联系：' +
        esc((SITE.about && SITE.about.contacts && SITE.about.contacts[0] && SITE.about.contacts[0].value) || "your@mail.com") +
        "</code></pre>";
    }
  }

  /* -------------------------------------------------------- 文章列表 */

  function postItemHTML(p) {
    return '<li class="post-item">' +
             '<time datetime="' + esc(p.date) + '">' + esc(p.date) + "</time>" +
             '<h3><a href="post.html?p=' + encodeURIComponent(p.slug) + '">' + esc(p.title) + "</a></h3>" +
             "<p>" + esc(p.excerpt) + "</p>" +
             tagsHTML(p.tags) +
           "</li>";
  }

  var recent = $("#recent-posts");
  if (recent) {
    recent.innerHTML = POSTS.slice(0, 3).map(postItemHTML).join("") ||
      '<li class="post-item"><p>还没有文章。打开 admin.html 可以写第一篇。</p></li>';
  }

  var all = $("#all-posts");
  if (all) {
    var filters = $("#filters");
    var tags = [];
    POSTS.forEach(function (p) {
      (p.tags || []).forEach(function (t) { if (tags.indexOf(t) < 0) { tags.push(t); } });
    });

    var render = function (tag) {
      var list = tag ? POSTS.filter(function (p) {
        return (p.tags || []).indexOf(tag) >= 0;
      }) : POSTS;
      all.innerHTML = list.length
        ? list.map(postItemHTML).join("")
        : '<li class="post-item"><p>这个标签下还没有文章。</p></li>';
      var count = $("#post-count");
      if (count) { count.textContent = list.length + " 篇"; }
    };

    if (filters) {
      var mk = function (label, value) {
        var b = document.createElement("button");
        b.type = "button";
        b.textContent = label;
        b.setAttribute("aria-pressed", value === "" ? "true" : "false");
        b.addEventListener("click", function () {
          $$("button", filters).forEach(function (x) { x.setAttribute("aria-pressed", "false"); });
          b.setAttribute("aria-pressed", "true");
          render(value);
        });
        return b;
      };
      filters.appendChild(mk("全部", ""));
      tags.forEach(function (t) { filters.appendChild(mk(t, t)); });
    }
    render("");
  }

  /* -------------------------------------------------------- 单篇文章 */
  var postBody = $("#post-body");
  if (postBody) {
    var slug = "";
    try { slug = new URLSearchParams(location.search).get("p") || ""; } catch (e) {}
    var post = POSTS.filter(function (p) { return p.slug === slug; })[0];

    if (post) {
      document.title = post.title + " · " + (SITE.brand || "小窝");
      var titleEl = $("#post-title");
      if (titleEl) { titleEl.textContent = post.title; }
      var dateEl = $("#post-date");
      if (dateEl) { dateEl.textContent = post.date; dateEl.setAttribute("datetime", post.date); }
      var tagEl = $("#post-tags");
      if (tagEl) {
        tagEl.innerHTML = (post.tags || []).map(function (t) {
          return "<li>" + esc(t) + "</li>";
        }).join("");
      }
      postBody.innerHTML = post.body;

      var idx = POSTS.indexOf(post);
      var next = POSTS[idx - 1];   /* 更新的一篇 */
      var prev = POSTS[idx + 1];   /* 更早的一篇 */
      var navEl = $("#post-nav");
      if (navEl) {
        navEl.innerHTML =
          "<span>" + (next ? '更新的一篇：<a href="post.html?p=' + encodeURIComponent(next.slug) + '">' + esc(next.title) + "</a>" : "") + "</span>" +
          "<span>" + (prev ? '更早的一篇：<a href="post.html?p=' + encodeURIComponent(prev.slug) + '">' + esc(prev.title) + "</a>" : "") + "</span>";
      }
    } else {
      document.title = "没找到这篇文章 · " + (SITE.brand || "小窝");
      var t2 = $("#post-title");
      if (t2) { t2.textContent = "没找到这篇文章"; }
      postBody.innerHTML = "<p>可能是链接抄错了，或者我把这篇的文件名改过。" +
                           '<a href="posts.html">回文章列表</a> 看看还在不在。</p>';
    }
  }

  /* ================================================ 手机上的底部导航 */

  var ICONS = {
    home: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 11l8-6.5 8 6.5v8a1.5 1.5 0 0 1-1.5 1.5H13v-5.5h-2V20H5.5A1.5 1.5 0 0 1 4 18.5z"/></svg>',
    doc:  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 4.5h9l5 5v10a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1v-14a1 1 0 0 1 1-1z"/><path d="M14 4.5v5h5"/></svg>',
    star: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 4h12v16l-6-4.5L6 20z"/></svg>',
    user: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="8.5" r="3.5"/><path d="M5 20c0-3.6 3.1-5.5 7-5.5s7 1.9 7 5.5"/></svg>',
    pic:  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3.5" y="5" width="17" height="14" rx="2.5"/><circle cx="9" cy="10" r="1.7"/><path d="M4.5 16.5 9.5 12l3.5 3 3-2.5 4 3.5"/></svg>'
  };

  function currentFile() {
    var f = window.location.pathname.split("/").pop();
    return f || "index.html";
  }

  function buildTabbar() {
    var map = {
      "index.html": "index.html",
      "m.html": "index.html",
      "posts.html": "posts.html",
      "post.html": "posts.html",
      "photos.html": "photos.html",
      "links.html": "links.html",
      "admin.html": "admin.html"
    };
    var here = map[currentFile()] || "index.html";
    var items = [
      { href: "index.html", label: "首页", icon: ICONS.home },
      { href: "posts.html", label: "文章", icon: ICONS.doc },
      { href: "photos.html", label: "照片", icon: ICONS.pic },
      { href: "links.html", label: "收藏", icon: ICONS.star },
      { href: "admin.html", label: "我的", icon: ICONS.user }
    ];

    var nav = document.createElement("nav");
    nav.className = "tabbar";
    nav.setAttribute("aria-label", "主导航");
    nav.innerHTML = items.map(function (it) {
      return '<a href="' + it.href + '"' + (it.href === here ? ' aria-current="page"' : "") + ">" +
             it.icon + it.label + "</a>";
    }).join("");
    body.appendChild(nav);
  }

  buildTabbar();

  /* 手机上第一次看电脑版时，轻轻提一句有手机版 */
  (function () {
    var f = currentFile();
    if (f !== "index.html") { return; }
    if (!window.matchMedia || !window.matchMedia("(max-width: 700px)").matches) { return; }

    var seen = null;
    try { seen = localStorage.getItem("hut-mobile-hint"); } catch (e) {}
    if (seen === "no") { return; }

    var hint = document.createElement("div");
    hint.className = "m-hint";
    hint.innerHTML = "<span>手机上有专门的版本</span>" +
                     '<a href="m.html">去看看</a>' +
                     '<button type="button" aria-label="不再提示">×</button>';
    hint.querySelector("button").addEventListener("click", function () {
      try { localStorage.setItem("hut-mobile-hint", "no"); } catch (e) {}
      hint.remove();
    });
    body.appendChild(hint);

    /* 没人理它就自己收起来，别老挡着文章 */
    setTimeout(function () {
      hint.style.transition = "opacity .4s ease, transform .4s ease";
      hint.style.opacity = "0";
      hint.style.transform = "translateY(10px)";
      setTimeout(function () { hint.remove(); }, 450);
    }, 9000);
  })();

  /* ==================================================== 首页头像 */

  (function () {
    var host = $("#intro-avatar");
    if (!host) { return; }
    var name = SITE.author || "我";
    var fallback = name.slice(0, 1).toUpperCase();
    var src = String(SITE.avatar || "").trim();

    if (!src) {
      host.textContent = fallback;
      return;
    }

    var img = document.createElement("img");
    img.alt = name;
    img.onerror = function () {
      /* 图片挂了就退回首字母，别留一个破图标 */
      host.innerHTML = "";
      host.textContent = fallback;
    };
    img.src = src;
    host.textContent = "";
    host.appendChild(img);
  })();

  /* ============================================ 滚到哪儿，哪才动 */

  (function () {
    if (reduced()) { return; }

    var targets = [];
    var viewport = window.innerHeight;

    [".intro > *", ".layout > *", "section.block", ".post-list .post-item",
     ".fav-list > li", ".timeline li", ".notes li", ".m-quick a",
     /* 文章页、关于页、收藏页的正文：也一段一段浮出来。
        段落（p）除外——它们交给下面"逐段写出来"那套，别叠两个效果。 */
     ".post-meta", ".prose > *:not(p)", ".prose.spaced", ".post-nav a"].forEach(function (sel) {
      $$(sel).forEach(function (el, i) {
        /* 一进页面就看得见的，保留原有的入场动画 */
        if (el.getBoundingClientRect().top < viewport * 0.92) { return; }
        /* 还在屏幕下面的：先收起来，滚到了再浮现 */
        el.style.animation = "none";
        el.classList.add("reveal");
        el.style.transition = "opacity .7s cubic-bezier(.22,1,.36,1), transform .7s cubic-bezier(.22,1,.36,1)";
        el.style.transitionDelay = Math.min(i, 5) * 70 + "ms";
        targets.push(el);
      });
    });

    if (!targets.length) { return; }

    if (!window.IntersectionObserver) {
      targets.forEach(function (el) { el.classList.add("in"); });
      return;
    }

    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) {
        if (!en.isIntersecting) { return; }
        en.target.classList.add("in");
        io.unobserve(en.target);
      });
    }, { rootMargin: "0px 0px -8% 0px", threshold: 0.05 });

    targets.forEach(function (el) { io.observe(el); });

    /* 兜底一：万一有人一下把滚动条拖到底，中间那些会被跳过。
       所以滚动时再扫一遍——已经滚过去的直接显示（不再动画），
       正在视口里的正常浮现。绝不把内容永远藏着。 */
    var sweeping = false;
    function sweep() {
      if (sweeping) { return; }
      sweeping = true;
      requestAnimationFrame(function () {
        var vh = window.innerHeight;
        targets.forEach(function (el) {
          if (el.classList.contains("in")) { return; }
          var r = el.getBoundingClientRect();
          if (r.bottom < 0) {
            el.style.transition = "none";
            el.classList.add("in");
            io.unobserve(el);
          } else if (r.top < vh * 0.95) {
            el.classList.add("in");
            io.unobserve(el);
          }
        });
        sweeping = false;
      });
    }

    window.addEventListener("scroll", sweep, { passive: true });
    window.addEventListener("resize", sweep);
    setTimeout(sweep, 700);

    /* 兜底二：最后一道保险，8 秒后不管怎样都放出来 */
    setTimeout(function () {
      targets.forEach(function (el) {
        if (!el.classList.contains("in")) { el.classList.add("in"); }
      });
    }, 8000);
  })();

  /* ============================== 侧栏卡片：鼠标扫过会轻轻歪一下 */

  (function () {
    if (reduced()) { return; }
    if (window.matchMedia && !window.matchMedia("(pointer: fine)").matches) { return; }

    $$(".card").forEach(function (card) {
      card.addEventListener("mousemove", function (e) {
        var r = card.getBoundingClientRect();
        var px = (e.clientX - r.left) / r.width - 0.5;
        var py = (e.clientY - r.top) / r.height - 0.5;
        card.style.transform =
          "perspective(760px) rotateX(" + (-py * 5).toFixed(2) + "deg) rotateY(" +
          (px * 6).toFixed(2) + "deg) translateY(-4px)";
      });
      card.addEventListener("mouseleave", function () {
        card.style.transform = "";
      });
    });
  })();

  /* ============================================== 文章里的图点开看 */

  (function () {
    var host = $("#post-body");
    if (!host) { return; }

    var box = null;

    function onKey(e) {
      if (e.key === "Escape") { closeBox(); }
    }

    function closeBox() {
      if (!box) { return; }
      var b = box;
      box = null;
      b.classList.remove("on");
      document.removeEventListener("keydown", onKey);
      setTimeout(function () { b.remove(); }, 380);
    }

    host.addEventListener("click", function (e) {
      var img = e.target.closest ? e.target.closest("img") : null;
      if (!img) { return; }

      box = document.createElement("div");
      box.className = "lightbox";
      box.innerHTML = '<img alt="' + esc(img.alt || "") + '" src="' +
                      esc(img.currentSrc || img.src) + '">' +
                      '<span class="lightbox-hint">按 Esc 或点空白处关掉</span>';
      box.addEventListener("click", closeBox);
      document.body.appendChild(box);
      document.addEventListener("keydown", onKey);
      requestAnimationFrame(function () { box.classList.add("on"); });
    });
  })();

  /* ==================================== 会动的背景那一层（电脑上才有）

     网格缓慢上移、第三团光飘、一道斜光隔一会儿扫过去、
     小光点成群往上飘、一层很淡的颗粒。鼠标一动，整层轻轻偏一点。 */

  (function () {
    var desktop = window.matchMedia && window.matchMedia("(pointer: fine)").matches;

    var sky = document.createElement("div");
    sky.className = "sky";
    sky.setAttribute("aria-hidden", "true");

    var grid = document.createElement("span");
    grid.className = "grid";
    grid.innerHTML = "<i></i>";

    var blob3 = document.createElement("span");
    blob3.className = "blob3";

    var beam = document.createElement("span");
    beam.className = "beam";

    sky.appendChild(grid);
    sky.appendChild(blob3);
    sky.appendChild(beam);

    if (!reduced() && desktop) {
      for (var i = 0; i < 18; i++) {
        var sp = document.createElement("span");
        sp.className = "spark";
        var size = 2 + Math.random() * 3.4;
        sp.style.width = size.toFixed(1) + "px";
        sp.style.height = size.toFixed(1) + "px";
        sp.style.left = (Math.random() * 100).toFixed(2) + "%";
        sp.style.top = (52 + Math.random() * 48).toFixed(2) + "%";
        sp.style.setProperty("--dx", ((Math.random() * 100) - 50).toFixed(0) + "px");
        sp.style.animationDuration = (11 + Math.random() * 14).toFixed(1) + "s";
        sp.style.animationDelay = (Math.random() * 18).toFixed(1) + "s";
        sky.appendChild(sp);
      }

      var grain = document.createElement("span");
      grain.className = "grain";
      sky.appendChild(grain);
    }

    body.appendChild(sky);

    /* 鼠标位置 -> 背景的轻微视差 */
    if (!reduced() && desktop) {
      var pending = false, tx = 0, ty = 0;
      document.addEventListener("mousemove", function (e) {
        tx = (e.clientX / window.innerWidth - 0.5) * 2;
        ty = (e.clientY / window.innerHeight - 0.5) * 2;
        if (pending) { return; }
        pending = true;
        requestAnimationFrame(function () {
          pending = false;
          sky.style.setProperty("--px", tx.toFixed(3));
          sky.style.setProperty("--py", ty.toFixed(3));
        });
      }, { passive: true });
    }
  })();

  /* ================================== 大标题：一个字一个字跳出来 */

  (function () {
    /* 每页最主要的那个标题：首页是 #intro-title，文章页是文章标题，
       关于页和文章列表页是页首那句。统一抓 main 里的第一个 h1。 */
    var h1 = document.querySelector("main h1");
    if (!h1 || reduced()) { return; }

    var n = 0;

    function walk(node) {
      Array.prototype.slice.call(node.childNodes).forEach(function (child) {
        if (child.nodeType === 3) {
          var text = child.nodeValue;
          if (!text) { return; }
          var frag = document.createDocumentFragment();
          for (var k = 0; k < text.length; k++) {
            var c = text.charAt(k);
            if (c === " " || c === "\n" || c === "\t") {
              frag.appendChild(document.createTextNode(c));
              continue;
            }
            var sp = document.createElement("span");
            sp.className = "ch";
            sp.style.setProperty("--i", Math.min(n++, 28));
            sp.textContent = c;
            frag.appendChild(sp);
          }
          node.replaceChild(frag, child);
        } else if (child.nodeType === 1 && child.tagName !== "BR") {
          /* <b> 这块带渐变高亮，不能拆：一拆 background-clip: text 就裁不准，
             整个词会糊成一个色块。当成一个整体蹦出来，反而更像个"重点词"。 */
          if (child.tagName === "B") {
            child.classList.add("ch");
            child.style.setProperty("--i", Math.min(n++, 28));
            return;
          }
          walk(child);
        }
      });
    }

    walk(h1);
  })();

  /* ============================ 二级标题下面那道线：滚到跟前才画出来 */

  (function () {
    var titles = $$(".block-title");
    if (!titles.length) { return; }

    /* 关掉动效的人，直接画好，别留一条看不见的线 */
    if (reduced() || !window.IntersectionObserver) {
      titles.forEach(function (el) { el.classList.add("drawn"); });
      return;
    }

    var tio = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) {
        if (!en.isIntersecting) { return; }
        en.target.classList.add("drawn");
        tio.unobserve(en.target);
      });
    }, { rootMargin: "0px 0px -12% 0px", threshold: 0.1 });

    titles.forEach(function (el) { tio.observe(el); });

    /* 和滚动显现一样的兜底：滚动太快时顺手补上，别让线一直空着 */
    function sweep() {
      titles.forEach(function (el) {
        if (el.classList.contains("drawn")) { return; }
        var b = el.getBoundingClientRect();
        if (b.top < window.innerHeight * 0.95 && b.bottom > 0) {
          el.classList.add("drawn");
          tio.unobserve(el);
        }
      });
    }
    window.addEventListener("scroll", sweep, { passive: true });
    window.addEventListener("resize", sweep);
  })();

  /* ===================== 正文段落：滚到了就一点点"写"出来 */

  (function () {
    if (reduced() || !window.IntersectionObserver) { return; }

    var targets = $$(".lede, .prose > p");
    if (!targets.length) { return; }

    var wio = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) {
        if (!en.isIntersecting) { return; }
        startWipe(en.target);
        wio.unobserve(en.target);
      });
    }, { rootMargin: "0px 0px -8% 0px", threshold: 0.05 });

    /* 加动画，然后盯一下：万一动画因为什么原因没跑起来，
       遮罩会一直停在 0%，字就永远看不见了——那种情况直接把类去掉，
       宁可不要这个效果，也不能让文字消失。 */
    function startWipe(el) {
      el.classList.add("wipe");
      setTimeout(function () {
        var cs = getComputedStyle(el);
        var m = cs.webkitMaskSize || cs.maskSize || "";
        if (String(m).indexOf("0% 100%") === 0) {
          el.classList.remove("wipe");
        }
      }, 2600);
    }

    targets.forEach(function (el, i) {
      /* 一进页面就在眼前的几段：错开一点开工，别挤在一起同时擦 */
      if (el.getBoundingClientRect().top < window.innerHeight * 0.9) {
        var delay = 140 + Math.min(i, 5) * 110;
        setTimeout(function () { startWipe(el); }, delay);
        return;
      }
      wio.observe(el);
    });
  })();
})();
