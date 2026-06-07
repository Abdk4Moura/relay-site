/* signal.js · Relay's live figures, realist edition.
   Every illustration is drawn at runtime from the product's real internals:
   actual wire-protocol lines, real HID usage codes, keystrokes landing
   letter by letter. Devices are rendered as objects: shadows, body
   gradients, glass, sheen, scanlines, the classic blue BIOS.

   Performance: each figure pre-renders its static artwork once to an
   offscreen layer (rebuilt only on resize or theme change); per frame we
   blit the layer and draw just the moving parts. Vignettes run at 30fps.
   Screens stay dark glass in both themes. Honors reduced motion. */
(function () {
  "use strict";

  var REDUCED = matchMedia("(prefers-reduced-motion: reduce)").matches;
  var DPR = Math.min(devicePixelRatio || 1, 2);
  var TAU = Math.PI * 2;
  function lerp(a, b, t) { return a + (b - a) * t; }
  function clamp(v, a, b) { return Math.min(b, Math.max(a, v)); }
  function ez(t) { return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2; }

  /* ---- palettes: P follows the page theme, DK is the fixed dark deck ---- */
  var P = {}, DK = {}, themeVer = 0;
  function palette() {
    var cs = getComputedStyle(document.documentElement);
    function g(k, d) { var v = cs.getPropertyValue(k).trim(); return v || d; }
    P.e1 = g("--e1", "#1b1b22"); P.e2 = g("--e2", "#22222a");
    P.border = g("--border", "#3a3a44"); P.borderHi = g("--border-hi", "#55555f");
    P.text = g("--text", "#f4f4f6"); P.t2 = g("--text-2", "#b9b9c0");
    P.t3 = g("--text-3", "#8b8b93"); P.t4 = g("--text-4", "#67676f");
    P.acc = g("--accent", "#65ea92");
    P.ghost = g("--accent-ghost", "rgba(101,234,146,.13)");
    P.line = g("--accent-line", "rgba(101,234,146,.32)");
    P.mono = g("--font-mono", "ui-monospace, monospace");
    var hue = g("--hue", "152");
    DK.e1 = "oklch(0.190 0.009 265)"; DK.e2 = "oklch(0.225 0.010 265)";
    DK.e3 = "oklch(0.270 0.011 265)";
    DK.border = "oklch(0.305 0.010 265)"; DK.borderHi = "oklch(0.42 0.013 265)";
    DK.text = "oklch(0.97 0.004 265)"; DK.t2 = "oklch(0.78 0.006 265)";
    DK.t3 = "oklch(0.60 0.007 265)"; DK.t4 = "oklch(0.46 0.007 265)";
    DK.acc = "oklch(0.84 0.17 " + hue + ")"; DK.acc2 = "oklch(0.72 0.15 " + hue + ")";
    DK.ghost = "oklch(0.84 0.17 " + hue + " / 0.13)";
    DK.line = "oklch(0.84 0.17 " + hue + " / 0.32)";
    DK.mono = P.mono;
  }
  palette();
  new MutationObserver(function () { palette(); themeVer++; }).observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });

  /* realist content constants (content colors, not UI tokens) */
  var RL = {
    glass: "#0b0d12",
    tl: ["#ff5f57", "#febc2e", "#28c840"],
    bios: { bg: "#0a0aa8", bg2: "#0d0dc8", txt: "#dcdcee", sel: "#c0c0c0", selTxt: "#0a0aa8", key: "#ffd75e" },
    tv: ["#e50914", "#1f80e0", "#1db954", "#8b5cf6"],
    sun: ["#191040", "#8f2f6d", "#ff8a3c"]
  };

  /* ---- draw helpers ---- */
  function rr(c, x, y, w, h, r) {
    r = Math.min(r, w / 2, h / 2);
    c.beginPath();
    c.moveTo(x + r, y);
    c.arcTo(x + w, y, x + w, y + h, r);
    c.arcTo(x + w, y + h, x, y + h, r);
    c.arcTo(x, y + h, x, y, r);
    c.arcTo(x, y, x + w, y, r);
    c.closePath();
  }
  function mono(c, px, col, align) {
    c.font = px + "px " + P.mono;
    c.fillStyle = col;
    c.textAlign = align || "left";
    c.textBaseline = "middle";
  }
  function cubic(p0, p1, p2, p3, t) {
    var u = 1 - t, a = u * u * u, b = 3 * u * u * t, d = 3 * u * t * t, e = t * t * t;
    return { x: a * p0.x + b * p1.x + d * p2.x + e * p3.x, y: a * p0.y + b * p1.y + d * p2.y + e * p3.y };
  }
  /* glow without shadowBlur: three arcs */
  function glowDot(c, col, x, y, r) {
    c.save(); c.fillStyle = col;
    c.globalAlpha = 0.10; c.beginPath(); c.arc(x, y, r * 3.4, 0, TAU); c.fill();
    c.globalAlpha = 0.22; c.beginPath(); c.arc(x, y, r * 2, 0, TAU); c.fill();
    c.globalAlpha = 1; c.beginPath(); c.arc(x, y, r, 0, TAU); c.fill();
    c.restore();
  }
  function chipBox(c, K, x, y, label, fs) {
    mono(c, fs || 9.5, K.acc, "center");
    var tw = c.measureText(label).width;
    c.save(); c.shadowColor = K.acc; c.shadowBlur = 7;
    c.fillStyle = RL.glass; c.strokeStyle = K.line; c.lineWidth = 1;
    rr(c, x - tw / 2 - 7, y - 9, tw + 14, 18, 6); c.fill(); c.stroke();
    c.restore();
    c.fillStyle = K.acc; c.fillText(label, x, y + 0.5);
  }
  function cursorArrow(c, x, y, col) {
    c.fillStyle = col;
    c.beginPath(); c.moveTo(x, y); c.lineTo(x + 7.5, y + 8); c.lineTo(x + 3.2, y + 8.3); c.lineTo(x + 1.3, y + 11.8); c.closePath(); c.fill();
    c.strokeStyle = "rgba(0,0,0,0.45)"; c.lineWidth = 0.8; c.stroke();
  }

  /* ---- realist shell pieces (drawn once into a figure's cached layer) ---- */
  function shadowUnder(g, cx, cy, w, hh) {
    hh = hh || w / 9;
    var grd = g.createRadialGradient(cx, cy, 1, cx, cy, w / 2);
    grd.addColorStop(0, "rgba(0,0,0,0.30)"); grd.addColorStop(1, "rgba(0,0,0,0)");
    g.save(); g.translate(cx, cy); g.scale(1, hh / (w / 2)); g.translate(-cx, -cy);
    g.fillStyle = grd; g.beginPath(); g.arc(cx, cy, w / 2, 0, TAU); g.fill();
    g.restore();
  }
  function sheen(g, x, y, w, h, r) {
    g.save(); rr(g, x, y, w, h, r); g.clip();
    var s = g.createLinearGradient(x, y, x + w * 0.9, y + h * 0.7);
    s.addColorStop(0, "rgba(255,255,255,0.075)");
    s.addColorStop(0.45, "rgba(255,255,255,0.018)");
    s.addColorStop(1, "rgba(255,255,255,0)");
    g.fillStyle = s; g.fillRect(x, y, w, h * 0.65);
    g.restore();
  }
  function scanlines(g, x, y, w, h) {
    g.save(); g.fillStyle = "rgba(0,0,0,0.10)";
    for (var sy = y + 2; sy < y + h - 2; sy += 3) g.fillRect(x, sy, w, 1);
    g.restore();
  }
  function phoneShell(g, K, x, y, w, h) {
    shadowUnder(g, x + w / 2, y + h + 5, w * 1.15);
    var bg = g.createLinearGradient(0, y, 0, y + h);
    bg.addColorStop(0, K.e3); bg.addColorStop(1, K.e1);
    g.fillStyle = bg; g.strokeStyle = K.borderHi; g.lineWidth = 1.4;
    rr(g, x, y, w, h, Math.min(13, w * 0.17)); g.fill(); g.stroke();
    g.strokeStyle = "rgba(255,255,255,0.10)"; g.lineWidth = 1;
    g.beginPath(); g.moveTo(x + 7, y + 1.5); g.lineTo(x + w - 7, y + 1.5); g.stroke();
    g.fillStyle = RL.glass; rr(g, x + 4, y + 7, w - 8, h - 14, 8); g.fill();
    sheen(g, x + 4, y + 7, w - 8, h - 14, 8);
    g.fillStyle = "#1d2127"; g.beginPath(); g.arc(x + w / 2, y + 12.5, 2.1, 0, TAU); g.fill();
    g.fillStyle = "rgba(120,160,255,0.55)"; g.beginPath(); g.arc(x + w / 2 + 0.7, y + 11.9, 0.7, 0, TAU); g.fill();
  }
  function keyGridShell(g, x, y, w, h) {
    var cols = 5, rows = 4, gx = 4, gy = 4;
    var kw = (w - gx * (cols + 1)) / cols, kh = (h - gy * (rows + 1)) / rows;
    for (var r = 0; r < rows; r++) for (var q = 0; q < cols; q++) {
      var kx = x + gx + q * (kw + gx), ky = y + gy + r * (kh + gy);
      g.fillStyle = "rgba(255,255,255,0.07)"; rr(g, kx, ky, kw, kh, 3); g.fill();
      g.fillStyle = "rgba(255,255,255,0.05)"; g.fillRect(kx + 1, ky + 0.7, kw - 2, 1);
    }
  }
  function flashKey(c, K, x, y, w, h, ch, a) {
    if (!ch || a <= 0) return;
    var cols = 5, rows = 4, gx = 4, gy = 4;
    var kw = (w - gx * (cols + 1)) / cols, kh = (h - gy * (rows + 1)) / rows;
    var n = (ch.charCodeAt(0) * 7) % (cols * rows);
    var fx = x + gx + (n % cols) * (kw + gx), fy = y + gy + ((n / cols) | 0) * (kh + gy);
    c.globalAlpha = a;
    c.fillStyle = K.ghost; rr(c, fx, fy, kw, kh, 3); c.fill();
    c.strokeStyle = K.acc; c.lineWidth = 1.2; rr(c, fx, fy, kw, kh, 3); c.stroke();
    c.globalAlpha = 1;
  }
  function monitorShell(g, K, x, y, w, h) {
    shadowUnder(g, x + w / 2, y + h + 19, w);
    var bg = g.createLinearGradient(0, y, 0, y + h);
    bg.addColorStop(0, K.e3); bg.addColorStop(1, K.e2);
    g.fillStyle = bg; g.strokeStyle = K.borderHi; g.lineWidth = 1.4;
    rr(g, x, y, w, h, 10); g.fill(); g.stroke();
    g.strokeStyle = "rgba(255,255,255,0.09)"; g.lineWidth = 1;
    g.beginPath(); g.moveTo(x + 8, y + 1.5); g.lineTo(x + w - 8, y + 1.5); g.stroke();
    g.fillStyle = RL.glass; rr(g, x + 6, y + 6, w - 12, h - 12, 6); g.fill();
    scanlines(g, x + 8, y + 8, w - 16, h - 16);
    sheen(g, x + 6, y + 6, w - 12, h - 12, 6);
    var ng = g.createLinearGradient(0, y + h, 0, y + h + 13);
    ng.addColorStop(0, K.e2); ng.addColorStop(1, K.e1);
    g.fillStyle = ng; g.fillRect(x + w / 2 - 7, y + h, 14, 12);
    g.fillStyle = K.e2; g.strokeStyle = K.border; g.lineWidth = 1;
    rr(g, x + w / 2 - 27, y + h + 11, 54, 6, 3); g.fill(); g.stroke();
  }
  function laptopShell(g, K, x, y, w, h) {
    shadowUnder(g, x + w / 2, y + h + 12, w * 1.25);
    var bg = g.createLinearGradient(0, y, 0, y + h);
    bg.addColorStop(0, K.e3); bg.addColorStop(1, K.e2);
    g.fillStyle = bg; g.strokeStyle = K.borderHi; g.lineWidth = 1.4;
    rr(g, x, y, w, h, 8); g.fill(); g.stroke();
    g.fillStyle = RL.glass; rr(g, x + 5, y + 5, w - 10, h - 10, 5); g.fill();
    sheen(g, x + 5, y + 5, w - 10, h - 10, 5);
    var base = g.createLinearGradient(0, y + h, 0, y + h + 9);
    base.addColorStop(0, K.e3); base.addColorStop(1, K.e1);
    g.fillStyle = base; g.strokeStyle = K.borderHi; g.lineWidth = 1;
    g.beginPath();
    g.moveTo(x - 13, y + h); g.lineTo(x + w + 13, y + h);
    g.lineTo(x + w + 9, y + h + 8); g.lineTo(x - 9, y + h + 8);
    g.closePath(); g.fill(); g.stroke();
    g.fillStyle = "rgba(255,255,255,0.06)";
    g.fillRect(x + w / 2 - 16, y + h + 1, 32, 2.5);
  }
  function windowChrome(g, K, x, y, w, h, title) {
    shadowUnder(g, x + w / 2, y + h + 4, w * 0.9, 5);
    var bg = g.createLinearGradient(0, y, 0, y + h);
    bg.addColorStop(0, K.e3); bg.addColorStop(1, K.e2);
    g.fillStyle = bg; g.strokeStyle = K.borderHi; g.lineWidth = 1.2;
    rr(g, x, y, w, h, 8); g.fill(); g.stroke();
    for (var i = 0; i < 3; i++) {
      g.fillStyle = RL.tl[i];
      g.beginPath(); g.arc(x + 11 + i * 8.5, y + 9, 2.6, 0, TAU); g.fill();
    }
    if (title) {
      g.font = "8px " + P.mono; g.fillStyle = K.t4; g.textAlign = "left"; g.textBaseline = "middle";
      g.fillText(title, x + 38, y + 9.5);
    }
    g.fillStyle = "#0d0f14"; rr(g, x + 4, y + 17, w - 8, h - 21, 5); g.fill();
  }
  function biosBox(g, x, y, w, h, header, footer) {
    var bg = g.createLinearGradient(0, y, 0, y + h);
    bg.addColorStop(0, RL.bios.bg2); bg.addColorStop(0.25, RL.bios.bg); bg.addColorStop(1, RL.bios.bg);
    g.fillStyle = bg; rr(g, x, y, w, h, 3); g.fill();
    g.strokeStyle = "rgba(225,225,245,0.85)"; g.lineWidth = 1;
    g.strokeRect(x + 3.5, y + 3.5, w - 7, h - 7);
    g.strokeStyle = "rgba(225,225,245,0.35)";
    g.strokeRect(x + 6.5, y + 6.5, w - 13, h - 13);
    if (header) {
      g.fillStyle = RL.bios.bg2; g.fillRect(x + 7, y + 7, w - 14, 13);
      g.font = "7.5px " + P.mono; g.fillStyle = RL.bios.txt; g.textAlign = "center"; g.textBaseline = "middle";
      g.fillText(header, x + w / 2, y + 14);
    }
    if (footer) {
      g.font = "7px " + P.mono; g.fillStyle = RL.bios.key; g.textAlign = "center"; g.textBaseline = "middle";
      g.fillText(footer, x + w / 2, y + h - 11);
    }
  }
  function typeLoop(words, step, hold) {
    var s = { wi: 0, ci: 0, p: 0, hp: 0, mode: "type", typed: "", flight: null };
    s.update = function (dt) {
      if (s.mode === "type") {
        var w = words[s.wi];
        s.flight = s.ci < w.length ? w[s.ci] : null;
        s.p += dt / step;
        if (s.p >= 1) {
          s.p = 0;
          if (s.ci < w.length) { s.typed += w[s.ci]; s.ci++; }
          if (s.ci >= w.length) { s.mode = "hold"; s.hp = 0; s.flight = null; }
        }
      } else {
        s.hp += dt;
        if (s.hp > hold) { s.typed = ""; s.ci = 0; s.p = 0; s.wi = (s.wi + 1) % words.length; s.mode = "type"; }
      }
    };
    return s;
  }

  /* real lines from the actual wire protocol (port 47600) */
  var WIRE = [
    '{"t":"hello","token":"••••"}',
    '{"t":"key","k":"enter","mod":0}',
    '{"t":"text","s":"relay"}',
    '{"t":"moveto","x":16384,"y":8000}',
    '{"t":"scroll","dy":-3}',
    '{"t":"click","b":"left"}',
    '{"t":"key","k":"down"}',
    '{"t":"consumer","u":"vol_up"}'
  ];

  var SIG = {};

  /* =================== HERO: phone drives a machine, live =================== */
  SIG.hero = function (c, dim, S) {
    var loop = typeLoop(["wake the dead box", "BIOS> boot from usb", "search: interstellar", "hello from a phone"], 0.34, 1.6);
    var scroll = 0;
    function lay(W, H) {
      var narrow = W < 560;
      var m = narrow ? 14 : Math.max(22, W * 0.045);
      var phW = clamp(W * 0.105, 48, 92), phH = phW * 1.95;
      var py = (H - 30 - phH) / 2 + 6, px = m;
      var moW = clamp(W * 0.34, 170, 320), moH = moW * 0.62;
      var mx = W - m - moW, my = (H - 30 - moH - 14) / 2 + 2;
      var a = { x: px + phW + 9, y: py + phH * 0.42 };
      var b = { x: mx - 8, y: my + moH * 0.5 };
      return { narrow: narrow, m: m, phW: phW, phH: phH, px: px, py: py, moW: moW, moH: moH, mx: mx, my: my,
        a: a, b: b,
        c1: { x: lerp(a.x, b.x, 0.38), y: a.y - 26 },
        c2: { x: lerp(a.x, b.x, 0.66), y: b.y + 22 } };
    }
    function drawShell(g, W, H) {
      var L = lay(W, H), K = DK;
      g.strokeStyle = K.border; g.lineWidth = 1.3;
      g.beginPath(); g.moveTo(L.a.x, L.a.y); g.bezierCurveTo(L.c1.x, L.c1.y, L.c2.x, L.c2.y, L.b.x, L.b.y); g.stroke();
      g.font = "10px " + P.mono; g.fillStyle = K.t4; g.textAlign = "center"; g.textBaseline = "middle";
      g.fillText(L.narrow ? "9 ms" : "encrypted · 9 ms", lerp(L.a.x, L.b.x, 0.5), Math.min(L.a.y, L.b.y) - 18);
      phoneShell(g, K, L.px, L.py, L.phW, L.phH);
      keyGridShell(g, L.px + 7, L.py + L.phH * 0.46, L.phW - 14, L.phH * 0.44);
      g.fillStyle = K.t3; g.font = "10px " + P.mono;
      g.fillText("your phone", L.px + L.phW / 2, L.py + L.phH + 16);
      monitorShell(g, K, L.mx, L.my, L.moW, L.moH);
      g.fillStyle = K.t3; g.font = "10px " + P.mono;
      g.fillText(L.narrow ? "any machine" : "any machine · nothing installed", L.mx + L.moW / 2, L.my + L.moH + 26);
      g.font = "9.5px " + P.mono; g.fillStyle = K.t4; g.textAlign = "left";
      g.fillText("relay · link up · 47600", L.mx + 16, L.my + 22);
    }
    return function (t, dt) {
      var D = dim(), W = D.W, H = D.H, K = DK, L = lay(W, H);
      c.clearRect(0, 0, W, H);
      c.drawImage(S.shell(drawShell), 0, 0, W, H);
      loop.update(dt); scroll += dt * 26;

      flashKey(c, K, L.px + 7, L.py + L.phH * 0.46, L.phW - 14, L.phH * 0.44, loop.flight, loop.mode === "type" ? 1 - loop.p : 0);
      if (loop.mode === "type" && loop.flight) {
        var q = cubic(L.a, L.c1, L.c2, L.b, ez(clamp(loop.p / 0.85, 0, 1)));
        glowDot(c, K.acc, q.x, q.y, 3.2);
      }
      var fs = L.moW < 220 ? 11 : 13;
      var tx = L.mx + 16, ty = L.my + 22;
      mono(c, fs, K.t3, "left");
      c.fillText(">", tx, ty + 22);
      c.save(); c.shadowColor = K.acc; c.shadowBlur = 6;
      mono(c, fs, K.acc, "left");
      c.fillText(loop.typed, tx + 12, ty + 22);
      c.restore();
      if ((t * 2 | 0) % 2 === 0) {
        c.fillStyle = K.acc;
        var cw = c.measureText(loop.typed).width;
        c.fillRect(tx + 15 + cw, ty + 22 - fs * 0.45, fs * 0.52, fs * 0.9);
      }
      var line = WIRE.join("   ");
      mono(c, 10, K.t4, "left");
      var lw = c.measureText(line + "   ").width;
      c.save(); c.globalAlpha = 0.5;
      c.fillText(line + "   " + line, L.m - (scroll % lw), H - 14);
      c.restore();
    };
  };
  SIG.hero.fps = 60;

  /* =================== MODE 1: app mode, a key travels as JSON =================== */
  SIG.app = function (c, dim, S) {
    var loop = typeLoop(["hello"], 0.55, 1.4);
    function lay(W, H) {
      var narrow = W < 460;
      var phW = clamp(W * 0.14, 44, 70), phH = phW * 1.95;
      var px = narrow ? 6 : 8, py = (H - phH) / 2 - 6;
      var lsW = clamp(W * 0.42, 150, 210), lsH = lsW * 0.62;
      var lx = W - lsW - (narrow ? 14 : 20), ly = (H - lsH) / 2 - 12;
      var a = { x: px + phW + 9, y: py + phH * 0.4 };
      var b = { x: lx - 12, y: ly + lsH * 0.55 };
      return { narrow: narrow, phW: phW, phH: phH, px: px, py: py, lsW: lsW, lsH: lsH, lx: lx, ly: ly,
        a: a, b: b,
        c1: { x: lerp(a.x, b.x, 0.4), y: a.y - 20 },
        c2: { x: lerp(a.x, b.x, 0.6), y: b.y + 16 } };
    }
    function drawShell(g, W, H) {
      var L = lay(W, H), K = DK;
      g.strokeStyle = K.border; g.lineWidth = 1.2;
      g.beginPath(); g.moveTo(L.a.x, L.a.y); g.bezierCurveTo(L.c1.x, L.c1.y, L.c2.x, L.c2.y, L.b.x, L.b.y); g.stroke();
      if (!L.narrow) {
        g.font = "9.5px " + P.mono; g.fillStyle = K.t4; g.textAlign = "center"; g.textBaseline = "middle";
        g.fillText("your network · encrypted", lerp(L.a.x, L.b.x, 0.5), Math.min(L.a.y, L.b.y) - 16);
      }
      phoneShell(g, K, L.px, L.py, L.phW, L.phH);
      keyGridShell(g, L.px + 6, L.py + L.phH * 0.46, L.phW - 12, L.phH * 0.44);
      laptopShell(g, K, L.lx, L.ly, L.lsW, L.lsH);
      for (var i = 0; i < 3; i++) {
        g.fillStyle = RL.tl[i];
        g.beginPath(); g.arc(L.lx + 15 + i * 8, L.ly + 14, 2.3, 0, TAU); g.fill();
      }
      g.font = "8.5px " + P.mono; g.fillStyle = K.t4; g.textAlign = "left"; g.textBaseline = "middle";
      g.fillText(L.narrow ? "receiver" : "receiver · open source", L.lx + 40, L.ly + 14.5);
      g.fillText(L.narrow ? "uinput · SendInput" : "uinput · SendInput · CGEvent", L.lx + 14, L.ly + L.lsH - 13);
    }
    return function (t, dt) {
      var D = dim(), W = D.W, H = D.H, K = DK, L = lay(W, H);
      c.clearRect(0, 0, W, H);
      c.drawImage(S.shell(drawShell), 0, 0, W, H);
      loop.update(dt);
      flashKey(c, K, L.px + 6, L.py + L.phH * 0.46, L.phW - 12, L.phH * 0.44, loop.flight, loop.mode === "type" ? 1 - loop.p : 0);
      if (loop.mode === "type" && loop.flight) {
        var pp = ez(clamp(loop.p / 0.85, 0, 1));
        var q = cubic(L.a, L.c1, L.c2, L.b, pp);
        c.globalAlpha = clamp(Math.min(pp / 0.08, (1 - pp) / 0.12), 0, 1);
        chipBox(c, K, q.x, q.y, L.narrow ? '"' + loop.flight + '"' : '{"t":"key","k":"' + loop.flight + '"}', L.narrow ? 9 : 9.5);
        c.globalAlpha = 1;
      }
      mono(c, 14, K.text, "left");
      c.fillText(loop.typed, L.lx + 14, L.ly + L.lsH * 0.55);
      if ((t * 2 | 0) % 2 === 0) {
        c.fillStyle = K.acc;
        c.fillRect(L.lx + 16 + c.measureText(loop.typed).width, L.ly + L.lsH * 0.55 - 6, 7, 12);
      }
    };
  };
  SIG.app.fps = 48;

  /* ============ MODE 2: out-of-band, HID bytes drive the blue BIOS ============ */
  SIG.oob = function (c, dim, S) {
    var ROWS = ["NVME SSD", "USB DRIVE", "NETWORK"];
    var SEQ = [
      { code: "0x51", move: 1 }, { code: "0x51", move: 1 },
      { code: "0x28", move: 0 }, { code: "0x52", move: -1 },
      { code: "0x52", move: -1 }, { code: "0x28", move: 0 }
    ];
    var si = 0, p = 0, hl = 0, flash = 0;
    function lay(W, H) {
      var compact = W < 420;
      if (compact) {
        var brW = clamp(W * 0.26, 78, 100), brH = 44;
        var bx = 8, by = H * 0.52 - brH / 2;
        var moW = clamp(W * 0.52, 150, 200), moH = moW * 0.68;
        var mx = W - moW - 8, my = (H - moH) / 2 - 8;
        return { compact: true, brW: brW, brH: brH, bx: bx, by: by, moW: moW, moH: moH, mx: mx, my: my,
          u0: { x: bx + brW + 4, y: by + 10 }, u1: { x: mx - 8, y: my + moH * 0.28 },
          h0: { x: mx - 8, y: my + moH * 0.8 }, h1: { x: bx + brW * 0.75, y: by + brH + 4 } };
      }
      var phW = clamp(W * 0.115, 40, 60), phH = phW * 1.95;
      var px = 6, py = 10;
      var brW = clamp(W * 0.2, 76, 112), brH = 50;
      var moW = clamp(W * 0.36, 150, 220), moH = moW * 0.68;
      var mx = W - moW - 14, my = (H - moH) / 2 - 10;
      var bx = Math.min(W * 0.30, mx - brW - 46);
      var by = H * 0.56 - brH / 2;
      return { compact: false, phW: phW, phH: phH, px: px, py: py, brW: brW, brH: brH, bx: bx, by: by,
        moW: moW, moH: moH, mx: mx, my: my,
        u0: { x: bx + brW + 4, y: by + 12 }, u1: { x: mx - 8, y: my + moH * 0.3 },
        h0: { x: mx - 8, y: my + moH * 0.78 }, h1: { x: bx + brW * 0.7, y: by + brH + 4 } };
    }
    function drawShell(g, W, H) {
      var L = lay(W, H), K = DK;
      g.textBaseline = "middle";
      if (!L.compact) {
        var a = { x: L.px + L.phW / 2, y: L.py + L.phH + 4 };
        var b = { x: L.bx + L.brW * 0.3, y: L.by - 4 };
        g.strokeStyle = K.border; g.lineWidth = 1.2;
        g.beginPath(); g.moveTo(a.x, a.y); g.bezierCurveTo(a.x, a.y + 24, b.x - 34, b.y - 20, b.x, b.y); g.stroke();
        g.font = "9px " + P.mono; g.fillStyle = K.t4; g.textAlign = "center";
        g.fillText("wifi", lerp(a.x, b.x, 0.58), lerp(a.y, b.y, 0.5) + 10);
        phoneShell(g, K, L.px, L.py, L.phW, L.phH);
      } else {
        g.font = "9px " + P.mono; g.fillStyle = K.t4; g.textAlign = "left";
        g.fillText("phone · wifi →", L.bx + 2, L.by - 16);
      }
      // bridge: a small metal box with ports
      shadowUnder(g, L.bx + L.brW / 2, L.by + L.brH + 4, L.brW * 1.1, 5);
      var bg = g.createLinearGradient(0, L.by, 0, L.by + L.brH);
      bg.addColorStop(0, K.e3); bg.addColorStop(1, K.e1);
      g.fillStyle = bg; g.strokeStyle = K.borderHi; g.lineWidth = 1.3;
      rr(g, L.bx, L.by, L.brW, L.brH, 9); g.fill(); g.stroke();
      g.strokeStyle = "rgba(255,255,255,0.09)";
      g.beginPath(); g.moveTo(L.bx + 6, L.by + 1.5); g.lineTo(L.bx + L.brW - 6, L.by + 1.5); g.stroke();
      g.fillStyle = RL.glass;
      g.fillRect(L.bx + L.brW - 7, L.by + L.brH * 0.28, 4, 6);
      g.fillRect(L.bx + L.brW - 7, L.by + L.brH * 0.58, 4, 6);
      g.font = (L.compact ? "9.5px " : "10.5px ") + P.mono; g.fillStyle = K.text; g.textAlign = "center";
      g.fillText("BRIDGE", L.bx + L.brW / 2, L.by + L.brH * 0.36);
      g.font = (L.compact ? "8.5px " : "9px ") + P.mono; g.fillStyle = K.t3;
      g.fillText("pi · dongle", L.bx + L.brW / 2, L.by + L.brH * 0.68);
      // usb path, label tucked at the monitor end
      g.strokeStyle = K.acc2; g.lineWidth = 1.3; g.globalAlpha = 0.7;
      g.beginPath(); g.moveTo(L.u0.x, L.u0.y);
      g.bezierCurveTo(L.u0.x + 40, L.u0.y - 14, L.u1.x - 40, L.u1.y - 8, L.u1.x, L.u1.y); g.stroke();
      g.globalAlpha = 1;
      g.font = "9px " + P.mono; g.fillStyle = K.t4; g.textAlign = "right";
      g.fillText(L.compact ? "USB HID" : "USB · a real keyboard", L.u1.x - 2, L.u1.y - 15);
      // hdmi path, label tucked at the bridge end
      g.strokeStyle = K.t4; g.lineWidth = 1.1; g.setLineDash([4, 4]);
      g.beginPath(); g.moveTo(L.h0.x, L.h0.y);
      g.bezierCurveTo(L.h0.x - 50, L.h0.y + 14, L.h1.x + 40, L.h1.y + 22, L.h1.x, L.h1.y); g.stroke();
      g.setLineDash([]);
      g.textAlign = "center";
      g.fillText(L.compact ? "HDMI capture" : "HDMI capture · the eyes", (L.h0.x + L.h1.x) / 2, L.h1.y + 26);
      // the target: a real monitor showing the classic blue BIOS
      monitorShell(g, K, L.mx, L.my, L.moW, L.moH);
      biosBox(g, L.mx + 8, L.my + 8, L.moW - 16, L.moH - 16,
        L.moW < 190 ? "BIOS SETUP" : "BIOS SETUP UTILITY",
        L.moW < 190 ? null : "↑↓: Select   Enter: Boot");
      g.font = "9px " + P.mono; g.fillStyle = K.t4; g.textAlign = "center";
      g.fillText(L.compact ? "no OS needed" : "no OS · nothing runs here", L.mx + L.moW / 2, L.my + L.moH + 26);
    }
    return function (t, dt) {
      var D = dim(), W = D.W, H = D.H, K = DK, L = lay(W, H);
      c.clearRect(0, 0, W, H);
      c.drawImage(S.shell(drawShell), 0, 0, W, H);
      var step = 1.05;
      p += dt / step; flash = Math.max(0, flash - dt * 2.2);
      if (p >= 1) {
        p = 0;
        var ev = SEQ[si];
        if (ev.move) hl = clamp(hl + ev.move, 0, ROWS.length - 1);
        else flash = 1;
        si = (si + 1) % SEQ.length;
      }
      glowDot(c, K.acc, L.bx + 9, L.by + 9, 1.6 + 0.5 * Math.sin(t * 3));
      var pp = ez(p);
      var q = cubic(L.u0, { x: L.u0.x + 40, y: L.u0.y - 14 }, { x: L.u1.x - 40, y: L.u1.y - 8 }, L.u1, pp);
      c.globalAlpha = clamp(Math.min(pp / 0.08, (1 - pp) / 0.12, 1), 0, 1);
      chipBox(c, K, q.x, q.y, SEQ[si].code, 9.5);
      c.globalAlpha = 1;
      for (var k = 0; k < 3; k++) {
        var fp = ((t * 0.35 + k / 3) % 1);
        var fq = cubic(L.h0, { x: L.h0.x - 50, y: L.h0.y + 14 }, { x: L.h1.x + 40, y: L.h1.y + 22 }, L.h1, fp);
        c.fillStyle = K.t3; c.globalAlpha = 0.8;
        c.fillRect(fq.x - 2.5, fq.y - 2, 5, 4); c.globalAlpha = 1;
      }
      var bw2 = L.moW - 16;
      var small = L.moW < 190;
      var tx = L.mx + (small ? 14 : 18), ty = L.my + 8 + (small ? 26 : 30);
      var rstep = small ? 14 : 17, fs = small ? 8.5 : 9.5;
      for (var r = 0; r < ROWS.length; r++) {
        var ry = ty + r * rstep;
        if (r === hl) {
          c.fillStyle = RL.bios.sel;
          c.fillRect(tx - 4, ry - 6.5, bw2 - (small ? 22 : 32), 13);
          if (flash > 0) {
            c.strokeStyle = "#ffffff"; c.globalAlpha = flash; c.lineWidth = 1;
            c.strokeRect(tx - 4, ry - 6.5, bw2 - (small ? 22 : 32), 13); c.globalAlpha = 1;
          }
        }
        mono(c, fs, r === hl ? RL.bios.selTxt : RL.bios.txt, "left");
        c.fillText((r + 1) + ". " + ROWS[r], tx, ry);
      }
    };
  };
  SIG.oob.fps = 48;

  /* =================== USE-CASE VIGNETTES =================== */

  /* a real TV launcher: search field, app tiles, the phone typing into it */
  SIG["uc-tv"] = function (c, dim, S) {
    var loop = typeLoop(["interstellar", "wifi password", "jazz radio"], 0.22, 1.3);
    function lay(W, H) {
      return { tw: Math.min(W * 0.74, 212), th: H - 24 };
    }
    function drawShell(g, W, H) {
      var L = lay(W, H), K = DK;
      shadowUnder(g, L.tw / 2, L.th + 10, L.tw);
      g.fillStyle = "#0c0e12"; g.strokeStyle = "rgba(255,255,255,0.12)"; g.lineWidth = 1.2;
      rr(g, 0, 2, L.tw, L.th, 6); g.fill(); g.stroke();
      g.fillStyle = "#101418"; rr(g, 3, 5, L.tw - 6, L.th - 6, 4); g.fill();
      sheen(g, 3, 5, L.tw - 6, L.th - 6, 4);
      // legs
      g.strokeStyle = K.e3; g.lineWidth = 2.5; g.lineCap = "round";
      g.beginPath(); g.moveTo(L.tw * 0.2, L.th + 2); g.lineTo(L.tw * 0.16, L.th + 9);
      g.moveTo(L.tw * 0.8, L.th + 2); g.lineTo(L.tw * 0.84, L.th + 9); g.stroke();
      // search field
      g.fillStyle = "rgba(255,255,255,0.08)"; g.strokeStyle = "rgba(255,255,255,0.16)"; g.lineWidth = 1;
      rr(g, 13, 14, L.tw - 26, 20, 5); g.fill(); g.stroke();
      // app tiles
      var n = 4, gap = 7, tw2 = (L.tw - 26 - gap * (n - 1)) / n;
      for (var i = 0; i < n; i++) {
        var x = 13 + i * (tw2 + gap), y = 42;
        var tg = g.createLinearGradient(0, y, 0, y + 16);
        tg.addColorStop(0, RL.tv[i]); tg.addColorStop(1, "rgba(0,0,0,0.35)");
        g.fillStyle = RL.tv[i]; rr(g, x, y, tw2, 16, 3); g.fill();
        g.fillStyle = "rgba(0,0,0,0.25)"; rr(g, x, y + 9, tw2, 7, 3); g.fill();
        g.fillStyle = "rgba(255,255,255,0.3)"; g.fillRect(x + 2, y + 1, tw2 - 4, 1);
      }
      // the phone, small, lower right
      phoneShell(g, K, W - 33, H - 56, 26, 50);
      g.strokeStyle = P.border; g.lineWidth = 1;
      g.beginPath(); g.moveTo(W - 37, H - 32); g.quadraticCurveTo(L.tw + 14, H * 0.42, L.tw - 4, 26); g.stroke();
    }
    return function (t, dt) {
      var D = dim(), W = D.W, H = D.H, K = DK, L = lay(W, H);
      c.clearRect(0, 0, W, H);
      c.drawImage(S.shell(drawShell), 0, 0, W, H);
      loop.update(dt);
      mono(c, 10, "#f2f2f5", "left");
      c.fillText(loop.typed, 21, 24.5);
      if ((t * 2 | 0) % 2 === 0) c.fillRect(23 + c.measureText(loop.typed).width, 19, 5.5, 11);
      if (loop.mode === "type" && loop.flight) {
        c.globalAlpha = 1 - loop.p;
        glowDot(c, K.acc, W - 20, H - 30, 1.7);
        c.globalAlpha = 1;
      }
    };
  };

  /* the blue BIOS, small */
  SIG["uc-bios"] = function (c, dim, S) {
    var rows = ["NVME SSD", "USB DRIVE", "PXE BOOT"];
    var hl = 0, p = 0, dir = 1, chip = 0;
    function lay(W, H) { return { bw: Math.min(W * 0.64, 185) }; }
    function drawShell(g, W, H) {
      var L = lay(W, H);
      shadowUnder(g, L.bw / 2, H - 4, L.bw);
      biosBox(g, 0, 3, L.bw, H - 12, "BOOT MENU", null);
    }
    return function (t, dt) {
      var D = dim(), W = D.W, H = D.H, L = lay(W, H);
      c.clearRect(0, 0, W, H);
      c.drawImage(S.shell(drawShell), 0, 0, W, H);
      p += dt / 0.9; chip = Math.max(0, chip - dt * 1.6);
      if (p >= 1) { p = 0; hl += dir; if (hl >= rows.length - 1 || hl <= 0) dir *= -1; chip = 1; }
      for (var r = 0; r < rows.length; r++) {
        var ry = 31 + r * 15;
        if (r === hl) { c.fillStyle = RL.bios.sel; c.fillRect(11, ry - 6, L.bw - 22, 12); }
        mono(c, 8.5, r === hl ? RL.bios.selTxt : RL.bios.txt, "left");
        c.fillText(rows[r], 15, ry);
      }
      mono(c, 8.5, P.t4, "left"); c.fillText("HID →", L.bw + 14, H / 2 - 18);
      if (chip > 0) {
        c.globalAlpha = chip;
        chipBox(c, P, L.bw + 38, H / 2, dir > 0 ? "0x51" : "0x52", 9);
        c.globalAlpha = 1;
      }
    };
  };

  /* a real video player: sunset frame, play state, gliding cursor */
  SIG["uc-couch"] = function (c, dim, S) {
    var prog = 0.18, playing = true, cx = 0, cy = 0, clickT = -9;
    function lay(W, H) { return { ww: Math.min(W * 0.8, 220), wh: H - 16 }; }
    function drawShell(g, W, H) {
      var L = lay(W, H), K = DK;
      windowChrome(g, K, 0, 2, L.ww, L.wh, "now playing");
      // the video: a sunset
      var vx = 4, vy = 19, vw = L.ww - 8, vh = L.wh - 23;
      g.save(); rr(g, vx, vy, vw, vh, 5); g.clip();
      var sky = g.createLinearGradient(0, vy, 0, vy + vh);
      sky.addColorStop(0, RL.sun[0]); sky.addColorStop(0.55, RL.sun[1]); sky.addColorStop(1, RL.sun[2]);
      g.fillStyle = sky; g.fillRect(vx, vy, vw, vh);
      var sun = g.createRadialGradient(vx + vw * 0.62, vy + vh * 0.62, 1, vx + vw * 0.62, vy + vh * 0.62, vh * 0.45);
      sun.addColorStop(0, "rgba(255,225,170,0.9)"); sun.addColorStop(1, "rgba(255,225,170,0)");
      g.fillStyle = sun; g.beginPath(); g.arc(vx + vw * 0.62, vy + vh * 0.62, vh * 0.45, 0, TAU); g.fill();
      g.fillStyle = "#150c1c";
      g.beginPath(); g.moveTo(vx, vy + vh);
      g.quadraticCurveTo(vx + vw * 0.3, vy + vh * 0.55, vx + vw * 0.55, vy + vh * 0.86);
      g.quadraticCurveTo(vx + vw * 0.75, vy + vh * 1.0, vx + vw, vy + vh * 0.88);
      g.lineTo(vx + vw, vy + vh); g.closePath(); g.fill();
      // control scrim
      g.fillStyle = "rgba(0,0,0,0.38)"; g.fillRect(vx, vy + vh - 14, vw, 14);
      g.restore();
    }
    return function (t, dt) {
      var D = dim(), W = D.W, H = D.H, K = DK, L = lay(W, H);
      c.clearRect(0, 0, W, H);
      c.drawImage(S.shell(drawShell), 0, 0, W, H);
      if (playing) prog = (prog + dt * 0.045) % 1;
      var vx = 4, vy = 19, vw = L.ww - 8, vh = L.wh - 23;
      var by = vy + vh - 7;
      // play / pause glyph in the scrim
      c.fillStyle = "#fff";
      if (playing) { c.fillRect(vx + 8, by - 4, 2.6, 8); c.fillRect(vx + 13, by - 4, 2.6, 8); }
      else { c.beginPath(); c.moveTo(vx + 8, by - 4.5); c.lineTo(vx + 16, by); c.lineTo(vx + 8, by + 4.5); c.closePath(); c.fill(); }
      // timeline
      c.strokeStyle = "rgba(255,255,255,0.35)"; c.lineWidth = 2.4; c.lineCap = "round";
      c.beginPath(); c.moveTo(vx + 24, by); c.lineTo(vx + vw - 10, by); c.stroke();
      c.strokeStyle = K.acc;
      c.beginPath(); c.moveTo(vx + 24, by); c.lineTo(vx + 24 + (vw - 34) * prog, by); c.stroke();
      // gliding cursor, click toggles play
      var ph = (t % 5) / 5;
      var targX = vx + 12, targY = by - 1;
      if (ph < 0.55) { cx = lerp(W * 0.86, targX, ez(ph / 0.55)); cy = lerp(H * 0.3, targY, ez(ph / 0.55)); }
      else { cx = targX; cy = targY; }
      if (ph >= 0.56 && ph < 0.585 && t - clickT > 2) { clickT = t; playing = !playing; }
      var rip = t - clickT;
      if (rip < 0.5) {
        c.strokeStyle = K.acc; c.globalAlpha = 1 - rip * 2; c.lineWidth = 1.2;
        c.beginPath(); c.arc(cx, cy, 4 + rip * 26, 0, TAU); c.stroke(); c.globalAlpha = 1;
      }
      cursorArrow(c, cx, cy, "#fff");
    };
  };

  /* a real slide on a projector white, notes beside, tap to advance */
  SIG["uc-present"] = function (c, dim, S) {
    /* a slide is white in real life: fixed light surface in both themes */
    var slide = 0, tapT = -9;
    function lay(W, H) { return { sw: Math.min(W * 0.46, 118), sh: H - 22 }; }
    function drawShell(g, W, H) {
      var L = lay(W, H);
      shadowUnder(g, L.sw / 2, 4 + L.sh + 5, L.sw);
      g.fillStyle = "#f4f4f6"; g.strokeStyle = "#c9c9d2"; g.lineWidth = 1;
      rr(g, 0, 4, L.sw, L.sh, 5); g.fill(); g.stroke();
      g.fillStyle = "#3a3a44"; g.fillRect(10, 12, L.sw * 0.55, 4);
      g.fillStyle = "#b9b9c2"; g.fillRect(10, 20, L.sw * 0.38, 2.5);
      var baseY = 4 + L.sh - 9, maxH = baseY - 30;
      var bx = 12, bw = (L.sw - 46) / 3;
      var hs = [0.4, 0.65, 0.92];
      for (var i = 0; i < 3; i++) {
        g.fillStyle = i === 2 ? "#3ec877" : "#c2c2cc";
        var bh = maxH * hs[i];
        g.fillRect(bx + i * (bw + 5), baseY - bh, bw, bh);
      }
      g.strokeStyle = "#d8d8de"; g.lineWidth = 1;
      g.beginPath(); g.moveTo(10, baseY + 0.5); g.lineTo(L.sw - 10, baseY + 0.5); g.stroke();
      var nx = L.sw + 18;
      g.font = "8.5px " + P.mono; g.fillStyle = P.t4; g.textAlign = "left"; g.textBaseline = "middle";
      g.fillText("NOTES", nx, 12);
      g.strokeStyle = P.t3; g.lineWidth = 2; g.lineCap = "round";
      g.beginPath(); g.moveTo(nx, 26); g.lineTo(nx + (W - nx - 14) * 0.92, 26); g.stroke();
      g.strokeStyle = P.border; g.lineWidth = 1.6;
      g.beginPath(); g.moveTo(nx, 38); g.lineTo(nx + (W - nx - 14) * 0.58, 38); g.stroke();
      g.beginPath(); g.moveTo(nx, 50); g.lineTo(nx + (W - nx - 14) * 0.46, 50); g.stroke();
      g.fillStyle = P.t4;
      g.fillText("tap → next", nx + 26, H - 10);
    }
    return function (t) {
      var D = dim(), W = D.W, H = D.H, L = lay(W, H);
      c.clearRect(0, 0, W, H);
      c.drawImage(S.shell(drawShell), 0, 0, W, H);
      var per = 2.6, cur = Math.floor(t / per);
      if (cur !== slide) { slide = cur; tapT = t; }
      var k = clamp((t - tapT) / 0.35, 0, 1);
      mono(c, 9, "#8f8fa0", "right");
      c.save(); c.globalAlpha = 0.3 + 0.7 * k;
      c.fillText(String(12 + slide), L.sw - 8, 15 - (1 - k) * 3);
      c.restore();
      var nx = L.sw + 18;
      var rip = t - tapT;
      if (rip < 0.5 && rip >= 0) {
        c.strokeStyle = P.acc; c.globalAlpha = 1 - rip * 2;
        c.beginPath(); c.arc(nx + 12, H - 10, 3 + rip * 16, 0, TAU); c.stroke(); c.globalAlpha = 1;
      }
      c.fillStyle = P.acc; c.beginPath(); c.arc(nx + 12, H - 10, 2.4, 0, TAU); c.fill();
    };
  };

  /* a watched agent session in a mini browser, MCP calls beside it */
  SIG["uc-agent"] = function (c, dim, S) {
    var PH = [
      { d: 1.2, call: "moveto 118,46" },
      { d: 0.35, call: "click left" },
      { d: 0.95, call: 'type "rel"' },
      { d: 1.0, call: "moveto 212,46" },
      { d: 0.35, call: "click left" },
      { d: 1.3, call: null }
    ];
    var pi = 0, pt = 0, typed = 0, cx = 24, cy = 70, sx = 24, sy = 70, clickR = -9;
    function lay(W, H) { return { sw: Math.min(W * 0.72, 205), sh: H - 14 }; }
    function drawShell(g, W, H) {
      var L = lay(W, H), K = DK;
      windowChrome(g, K, 0, 2, L.sw, L.sh, "agent session");
      // url bar
      g.fillStyle = "rgba(255,255,255,0.07)"; g.strokeStyle = "rgba(255,255,255,0.12)"; g.lineWidth = 1;
      rr(g, 9, 21, L.sw - 18, 12, 4); g.fill(); g.stroke();
      g.font = "7.5px " + P.mono; g.fillStyle = K.t4; g.textAlign = "left"; g.textBaseline = "middle";
      g.fillText("relay.local/panel", 15, 27.5);
      g.fillStyle = P.t4; g.font = "8.5px " + P.mono;
      g.fillText("MCP →", L.sw + 12, H / 2 - 18);
    }
    return function (t, dt) {
      var D = dim(), W = D.W, H = D.H, K = DK, L = lay(W, H);
      c.clearRect(0, 0, W, H);
      c.drawImage(S.shell(drawShell), 0, 0, W, H);
      pt += dt;
      if (pt >= PH[pi].d) {
        pt = 0; pi = (pi + 1) % PH.length;
        sx = cx; sy = cy;
        if (pi === 0) { typed = 0; sx = cx = 24; sy = cy = H * 0.8; }
        if (PH[pi].call === "click left") clickR = 0;
      }
      if (clickR >= 0) clickR += dt;
      var fx = 14, fy = L.sh * 0.55, fw = L.sw * 0.48, fh = 17;
      var bx = fx + fw + 9, bw2 = 32;
      var done = pi === 5;
      c.fillStyle = "rgba(255,255,255,0.06)"; c.strokeStyle = "rgba(255,255,255,0.13)"; c.lineWidth = 1;
      rr(c, fx, fy, fw, fh, 4); c.fill(); c.stroke();
      if (pi === 2) typed = clamp(Math.ceil(3 * pt / PH[2].d), 0, 3);
      mono(c, 9.5, K.acc, "left");
      c.fillText("rel".slice(0, typed), fx + 7, fy + fh / 2 + 0.5);
      c.fillStyle = done ? K.ghost : "rgba(255,255,255,0.06)";
      c.strokeStyle = done ? K.acc : "rgba(255,255,255,0.13)";
      rr(c, bx, fy, bw2, fh, 4); c.fill(); c.stroke();
      mono(c, 8.5, done ? K.acc : K.t3, "center");
      c.fillText("GO", bx + bw2 / 2, fy + fh / 2 + 0.5);
      var txx = (pi <= 2 ? fx + fw * 0.4 : bx + bw2 / 2), tyy = fy + fh / 2 + 4;
      if (pi === 0 || pi === 3) {
        var f = ez(pt / PH[pi].d);
        cx = lerp(sx, txx, f);
        cy = lerp(sy, tyy, f) - Math.sin(f * Math.PI) * 10;
      } else { cx = txx; cy = tyy; }
      if (clickR >= 0 && clickR < 0.45) {
        c.strokeStyle = K.acc; c.globalAlpha = 1 - clickR / 0.45; c.lineWidth = 1.2;
        c.beginPath(); c.arc(cx, cy, 3 + clickR * 40, 0, TAU); c.stroke(); c.globalAlpha = 1;
      }
      cursorArrow(c, cx, cy, "#fff");
      var call = PH[pi].call;
      if (call) {
        var strip = W - L.sw;
        chipBox(c, P, L.sw + strip / 2 + 2, H / 2, call, strip < 86 ? 7.5 : 8.5);
      }
    };
  };

  /* the device directory, in a real console window */
  SIG["uc-fleet"] = function (c, dim, S) {
    var ROWS = [
      { n: "popos", on: 1, ms: 9 },
      { n: "mediapc", on: 1, ms: 14 },
      { n: "lab-3", on: 1, ms: 22 },
      { n: "kiosk", on: 0, ms: 31 }
    ];
    function lay(W, H) { return { pw: Math.min(W * 0.92, 250), ph: H - 10 }; }
    function drawShell(g, W, H) {
      var L = lay(W, H), K = DK;
      windowChrome(g, K, 0, 2, L.pw, L.ph, "relay · devices");
    }
    return function (t) {
      var D = dim(), W = D.W, H = D.H, K = DK, L = lay(W, H);
      c.clearRect(0, 0, W, H);
      c.drawImage(S.shell(drawShell), 0, 0, W, H);
      var kioskOn = (t % 6) > 3;
      mono(c, 8, K.t4, "left");
      c.fillText((3 + (kioskOn ? 1 : 0)) + "/4 up", 122, 11.5);
      var n = ROWS.length, top = 24, step = (L.ph - 28) / n;
      for (var i = 0; i < n; i++) {
        var r = ROWS[i];
        var on = r.on === 1 || (i === 3 && kioskOn);
        var ry = top + i * step + step / 2 - 2;
        if (i === 3) {
          var k = (t % 6) - 3;
          if (k >= 0 && k < 0.6) {
            c.fillStyle = K.ghost; c.globalAlpha = 1 - k / 0.6;
            rr(c, 7, ry - 7, L.pw - 14, 14, 3); c.fill(); c.globalAlpha = 1;
          }
        }
        if (on) {
          c.globalAlpha = 0.55 + 0.45 * (0.5 + 0.5 * Math.sin(t * 2.4 + i * 2));
          glowDot(c, K.acc, 16, ry, 2.1);
          c.globalAlpha = 1;
        } else {
          c.strokeStyle = K.t4; c.lineWidth = 1.1;
          c.beginPath(); c.arc(16, ry, 2.2, 0, TAU); c.stroke();
        }
        mono(c, 9.5, on ? K.t2 : K.t4, "left"); c.fillText(r.n, 27, ry);
        var ms = on ? (r.ms + Math.round(Math.sin(t * 1.7 + i * 9) * 2)) + " ms" : "offline";
        mono(c, 9, on ? K.acc : K.t4, "right"); c.fillText(ms, L.pw - 10, ry);
      }
    };
  };

  /* =================== mount =================== */
  function mount(cv) {
    var name = cv.getAttribute("data-sig");
    var B = SIG[name];
    if (!B || cv.dataset.on) return;
    cv.dataset.on = "1";
    var c = cv.getContext("2d");
    var W = 0, H = 0;
    function size() {
      var r = cv.getBoundingClientRect();
      if (!r.width || !r.height) return;
      W = r.width; H = r.height;
      cv.width = Math.round(W * DPR); cv.height = Math.round(H * DPR);
      c.setTransform(DPR, 0, 0, DPR, 0, 0);
    }
    // cached static layer: rebuilt only on resize or theme change
    var shellCv = null, shellKey = "";
    var S = {
      shell: function (draw) {
        var key = W + "x" + H + ":" + themeVer;
        if (shellKey !== key) {
          shellCv = document.createElement("canvas");
          shellCv.width = Math.round(W * DPR); shellCv.height = Math.round(H * DPR);
          var g = shellCv.getContext("2d");
          g.setTransform(DPR, 0, 0, DPR, 0, 0);
          draw(g, W, H);
          shellKey = key;
        }
        return shellCv;
      }
    };
    var frame = B(c, function () { return { W: W, H: H }; }, S);
    size();
    var fps = B.fps || 30, minDt = 1 / fps;
    var raf = 0, last = 0, acc = 0, vis = false;
    function tick(ts) {
      if (!vis) { raf = 0; return; }
      var dt = last ? Math.min(0.05, (ts - last) / 1000) : 0.016;
      last = ts; acc += dt;
      if (acc >= minDt) { frame(ts / 1000, Math.min(acc, 0.05)); acc = 0; }
      raf = requestAnimationFrame(tick);
    }
    function start() { if (!raf) { last = 0; acc = 0; raf = requestAnimationFrame(tick); } }
    new ResizeObserver(function () { size(); if (REDUCED) frame(3, 0); }).observe(cv);
    var io = new IntersectionObserver(function (es) {
      vis = es[0].isIntersecting && !document.hidden;
      if (REDUCED) { frame(3, 0); return; }
      if (vis) start();
    }, { threshold: 0.05 });
    io.observe(cv);
    document.addEventListener("visibilitychange", function () {
      if (document.hidden) { vis = false; return; }
      var r = cv.getBoundingClientRect();
      vis = r.top < innerHeight && r.bottom > 0;
      if (vis && !REDUCED) start();
    });
    if (REDUCED) frame(3, 0);
  }
  function init() {
    document.querySelectorAll("canvas.sig[data-sig]").forEach(mount);
  }
  if (document.readyState !== "loading") init();
  else document.addEventListener("DOMContentLoaded", init);
})();
