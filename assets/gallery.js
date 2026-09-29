/* =========================================================================
   小窝 · 照片墙
   数据在 assets/photos.js（window.ALBUMS），这里只管画出来。
   相册用网址后面的 # 号切换，所以浏览器后退键是能用的。
   ========================================================================= */

(function () {
  "use strict";

  var host = document.getElementById("photo-wall");
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

  var ALBUMS = (window.ALBUMS || []).slice();

  function photoUrl(p) {
    return typeof p === "string" ? p : (p && p.url) || "";
  }
  function photoCap(p) {
    return typeof p === "string" ? "" : ((p && p.caption) || "");
  }
  function count(a) {
    return ((a && a.photos) || []).length;
  }

  var viewIndex = $("#album-index");
  var viewDetail = $("#album-detail");
  var gridEl = $("#album-grid");
  var headEl = $("#album-head");
  var photoEl = $("#photo-grid");
  var baseTitle = document.title;

  /* ---------------------------------------------------------- 全部相册 */

  function renderIndex() {
    if (!gridEl) { return; }

    var albums = ALBUMS.filter(function (a) { return a && a.id && count(a); });

    if (!albums.length) {
      gridEl.innerHTML = '<p class="photos-empty">还没有相册。打开 <a href="admin.html">后台</a> 的「照片墙」面板，' +
                         "加一本相册、传几张图就有了。</p>";
      return;
    }

    gridEl.innerHTML = albums.map(function (a) {
      var cover = a.cover || photoUrl((a.photos || [])[0]) || "";
      return '<a class="album-card" href="#' + esc(a.id) + '">' +
        '<div class="album-cover">' +
          (cover ? '<img src="' + esc(cover) + '" alt="' + esc(a.title || "") + '" loading="lazy">' : "") +
          '<span class="album-count">' + count(a) + " 张</span>" +
        "</div>" +
        '<div class="album-body">' +
          "<h3>" + esc(a.title || "没名字的相册") + "</h3>" +
          (a.description ? "<p>" + esc(a.description) + "</p>" : "") +
          (a.date ? '<time datetime="' + esc(a.date) + '">' + esc(a.date) + "</time>" : "") +
        "</div>" +
      "</a>";
    }).join("");
  }

  /* ---------------------------------------------------------- 单本相册 */

  function renderDetail(album) {
    if (!headEl || !photoEl) { return; }

    headEl.innerHTML =
      "<h2>" + esc(album.title || "没名字的相册") + "</h2>" +
      (album.description ? "<p>" + esc(album.description) + "</p>" : "") +
      (album.date ? '<time datetime="' + esc(album.date) + '">' + esc(album.date) + " · " + count(album) + " 张</time>" : "");

    photoEl.innerHTML = (album.photos || []).map(function (p, i) {
      var url = photoUrl(p);
      var cap = photoCap(p);
      if (!url) { return ""; }
      return '<button class="photo-cell" type="button" data-url="' + esc(url) + '" ' +
             'data-cap="' + esc(cap) + '" style="animation-delay:' + Math.min(i, 10) * 45 + 'ms">' +
        '<img src="' + esc(url) + '" alt="' + esc(cap) + '" loading="lazy">' +
        (cap ? "<span>" + esc(cap) + "</span>" : "") +
      "</button>";
    }).join("");
  }

  function show(which) {
    if (viewIndex) { viewIndex.classList.toggle("hidden", which !== "index"); }
    if (viewDetail) { viewDetail.classList.toggle("hidden", which !== "detail"); }
  }

  function route() {
    var id = "";
    try { id = decodeURIComponent((location.hash || "").replace(/^#/, "")); } catch (e) { id = ""; }

    var album = ALBUMS.filter(function (a) { return a.id === id; })[0];
    if (album) {
      renderDetail(album);
      show("detail");
      document.title = (album.title || "相册") + " · 照片墙 · " + (window.SITE && window.SITE.brand || "小窝");
      window.scrollTo(0, 0);
    } else {
      show("index");
      document.title = baseTitle;
    }
  }

  /* ------------------------------------------------------------ 灯箱 */

  var box = null;
  function closeBox() {
    if (!box) { return; }
    var b = box;
    box = null;
    b.classList.remove("on");
    document.removeEventListener("keydown", onKey);
    setTimeout(function () { b.remove(); }, 380);
  }
  function onKey(e) { if (e.key === "Escape") { closeBox(); } }

  function openBox(url, cap) {
    closeBox();
    box = document.createElement("div");
    box.className = "lightbox";
    box.innerHTML = '<img alt="' + esc(cap) + '" src="' + esc(url) + '">' +
      (cap ? '<p class="lightbox-cap">' + esc(cap) + "</p>" : "") +
      '<span class="lightbox-hint">按 Esc 或点空白处关掉</span>';
    box.addEventListener("click", closeBox);
    document.body.appendChild(box);
    document.addEventListener("keydown", onKey);
    requestAnimationFrame(function () { box.classList.add("on"); });
  }

  if (photoEl) {
    photoEl.addEventListener("click", function (e) {
      var cell = e.target.closest ? e.target.closest(".photo-cell") : null;
      if (!cell) { return; }
      openBox(cell.getAttribute("data-url"), cell.getAttribute("data-cap") || "");
    });
  }

  window.addEventListener("hashchange", route);
  renderIndex();
  route();
})();
