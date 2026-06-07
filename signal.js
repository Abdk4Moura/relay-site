/* signal.js · Relay's live figures.
   Every illustration on this site is drawn at runtime from the product's
   real internals: actual wire-protocol lines, real HID usage codes,
   keystrokes landing letter by letter. No stock art, no icon grids.

   One design rule: screens are dark glass. Drawn devices and the big
   instrument panels keep a fixed dark deck in BOTH themes (a monitor is
   dark even on a light page); only the page chrome around them re-themes.
   Canvas 2D, pauses off-screen, honors prefers-reduced-motion. */
(function () {
  "use strict";

  var REDUCED = matchMedia("(prefers-reduced-motion: reduce)").matches;
  var DPR = Math.min(devicePixelRatio || 1, 2);
  var TAU = Math.PI * 2;
  function lerp(a, b, t) { return a + (b - a) * t; }
  function clamp(v, a, b) { return Math.min(b, Math.max(a, v)); }
  function ez(t) { return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2; }

  /* ---- palettes ----
     P  follows the page theme (for wires/captions sitting on the page).
     DK is the fixed dark deck (for devices, screens, instrument panels). */
  var P = {}, DK = {};
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
    DK.e0 = "oklch(0.145 0.008 265)"; DK.e1 = "oklch(0.190 0.009 265)";
    DK.e2 = "oklch(0.225 0.010 265)"; DK.e3 = "oklch(0.270 0.011 265)";
    DK.border = "oklch(0.305 0.010 265)"; DK.borderHi = "oklch(0.42 0.013 265)";
    DK.text = "oklch(0.97 0.004 265)"; DK.t2 = "oklch(0.78 0.006 265)";
    DK.t3 = "oklch(0.60 0.007 265)"; DK.t4 = "oklch(0.46 0.007 265)";
    DK.acc = "oklch(0.84 0.17 " + hue + ")"; DK.acc2 = "oklch(0.72 0.15 " + hue + ")";
    DK.ghost = "oklch(0.84 0.17 " + hue + " / 0.13)";
    DK.line = "oklch(0.84 0.17 " + hue + " / 0.32)";
    DK.mono = P.mono;
  }
  palette();
  new MutationObserver(palette).observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });

  /* ---- draw helpers (K = whichever palette the element lives on) ---- */
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
  function glowDot(c, K, x, y, r) {
    c.save();
    c.shadowColor = K.acc; c.shadowBlur = 12;
    c.fillStyle = K.acc;
    c.beginPath(); c.arc(x, y, r, 0, TAU); c.fill();
    c.restore();
  }
  function cubic(p0, p1, p2, p3, t) {
    var u = 1 - t, a = u * u * u, b = 3 * u * u * t, d = 3 * u * t * t, e = t * t * t;
    return { x: a * p0.x + b * p1.x + d * p2.x + e * p3.x, y: a * p0.y + b * p1.y + d * p2.y + e * p3.y };
  }
  function phone(c, K, x, y, w, h) {
    c.fillStyle = K.e2; c.strokeStyle = K.borderHi; c.lineWidth = 1.4;
    rr(c, x, y, w, h, Math.min(12, w * 0.16)); c.fill(); c.stroke();
    c.fillStyle = K.e0 || K.e1; rr(c, x + 4, y + 7, w - 8, h - 14, 7); c.fill();
    c.strokeStyle = K.border; c.lineWidth = 2; c.lineCap = "round";
    c.beginPath(); c.moveTo(x + w * 0.38, y + h - 11); c.lineTo(x + w * 0.62, y + h - 11); c.stroke();
  }
  function keyFlash(c, K, x, y, w, h, ch, a) {
    var cols = 5, rows = 4, gx = 4, gy = 4;
    var kw = (w - gx * (cols + 1)) / cols, kh = (h - gy * (rows + 1)) / rows;
    for (var r = 0; r < rows; r++) for (var q = 0; q < cols; q++) {
      var kx = x + gx + q * (kw + gx), ky = y + gy + r * (kh + gy);
      c.fillStyle = K.e3; c.globalAlpha = 0.6;
      rr(c, kx, ky, kw, kh, 3); c.fill(); c.globalAlpha = 1;
    }
    if (ch && a > 0) {
      var n = (ch.charCodeAt(0) * 7) % (cols * rows);
      var fq = n % cols, fr = (n / cols) | 0;
      var fx = x + gx + fq * (kw + gx), fy = y + gy + fr * (kh + gy);
      c.globalAlpha = a;
      c.fillStyle = K.ghost; rr(c, fx, fy, kw, kh, 3); c.fill();
      c.strokeStyle = K.acc; c.lineWidth = 1.2; rr(c, fx, fy, kw, kh, 3); c.stroke();
      c.globalAlpha = 1;
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

  /* =================== HERO: phone drives a machine, live ===================
     Lives inside an always-dark instrument panel: everything on deck DK. */
  SIG.hero = function (c, dim) {
    var loop = typeLoop(["wake the dead box", "BIOS> boot from usb", "search: interstellar", "hello from a phone"], 0.34, 1.6);
    var scroll = 0;
    return function (t, dt) {
      var D = dim(), W = D.W, H = D.H, K = DK;
      c.clearRect(0, 0, W, H);
      loop.update(dt); scroll += dt * 26;
      var narrow = W < 560;

      var m = narrow ? 14 : Math.max(22, W * 0.045);
      var phW = clamp(W * 0.105, 48, 92), phH = phW * 1.95;
      var py = (H - 30 - phH) / 2 + 6;
      var px = m;
      var moW = clamp(W * 0.34, 170, 320), moH = moW * 0.62;
      var mx = W - m - moW, my = (H - 30 - moH - 14) / 2 + 2;

      var a = { x: px + phW + 6, y: py + phH * 0.42 };
      var b = { x: mx - 8, y: my + moH * 0.5 };
      var c1 = { x: lerp(a.x, b.x, 0.38), y: a.y - 26 };
      var c2 = { x: lerp(a.x, b.x, 0.66), y: b.y + 22 };
      c.strokeStyle = K.border; c.lineWidth = 1.3;
      c.beginPath(); c.moveTo(a.x, a.y); c.bezierCurveTo(c1.x, c1.y, c2.x, c2.y, b.x, b.y); c.stroke();
      mono(c, 10, K.t4, "center");
      c.fillText(narrow ? "9 ms" : "encrypted · 9 ms", lerp(a.x, b.x, 0.5), Math.min(a.y, b.y) - 18);

      phone(c, K, px, py, phW, phH);
      keyFlash(c, K, px + 7, py + phH * 0.46, phW - 14, phH * 0.44, loop.flight, loop.mode === "type" ? 1 - loop.p : 0);
      mono(c, 10, K.t3, "center");
      c.fillText("your phone", px + phW / 2, py + phH + 16);

      if (loop.mode === "type" && loop.flight) {
        var q = cubic(a, c1, c2, b, ez(clamp(loop.p / 0.85, 0, 1)));
        glowDot(c, K, q.x, q.y, 3.4);
      }

      c.fillStyle = K.e2; c.strokeStyle = K.borderHi; c.lineWidth = 1.4;
      rr(c, mx, my, moW, moH, 10); c.fill(); c.stroke();
      c.fillStyle = K.e0; rr(c, mx + 6, my + 6, moW - 12, moH - 12, 6); c.fill();
      c.strokeStyle = K.borderHi;
      c.beginPath(); c.moveTo(mx + moW * 0.42, my + moH); c.lineTo(mx + moW * 0.40, my + moH + 12); c.moveTo(mx + moW * 0.58, my + moH); c.lineTo(mx + moW * 0.60, my + moH + 12); c.stroke();
      mono(c, 10, K.t3, "center");
      c.fillText(narrow ? "any machine" : "any machine · nothing installed", mx + moW / 2, my + moH + 24);

      var fs = moW < 220 ? 11 : 13;
      var tx = mx + 16, ty = my + 22;
      mono(c, 9.5, K.t4, "left");
      c.fillText("relay · link up · 47600", tx, ty);
      mono(c, fs, K.t3, "left");
      c.fillText(">", tx, ty + 22);
      mono(c, fs, K.acc, "left");
      var typed = loop.typed;
      c.fillText(typed, tx + 12, ty + 22);
      if ((t * 2 | 0) % 2 === 0) {
        var cw = c.measureText(typed).width;
        c.fillRect(tx + 15 + cw, ty + 22 - fs * 0.45, fs * 0.52, fs * 0.9);
      }

      var line = WIRE.join("   ");
      mono(c, 10, K.t4, "left");
      var lw = c.measureText(line + "   ").width;
      var off = -(scroll % lw);
      c.save(); c.globalAlpha = 0.5;
      c.fillText(line + "   " + line, m + off, H - 16);
      c.restore();
    };
  };

  /* =================== MODE 1: app mode, a key travels as JSON =================== */
  SIG.app = function (c, dim) {
    var loop = typeLoop(["hello"], 0.55, 1.4);
    return function (t, dt) {
      var D = dim(), W = D.W, H = D.H, K = DK;
      c.clearRect(0, 0, W, H);
      loop.update(dt);
      var narrow = W < 460;

      var phW = clamp(W * 0.14, 44, 70), phH = phW * 1.95;
      var px = narrow ? 4 : 8, py = (H - phH) / 2 - 6;
      var lsW = clamp(W * 0.42, 150, 210), lsH = lsW * 0.62;
      var lx = W - lsW - (narrow ? 12 : 18), ly = (H - lsH) / 2 - 12;

      var a = { x: px + phW + 6, y: py + phH * 0.4 };
      var b = { x: lx - 10, y: ly + lsH * 0.55 };
      var c1 = { x: lerp(a.x, b.x, 0.4), y: a.y - 20 };
      var c2 = { x: lerp(a.x, b.x, 0.6), y: b.y + 16 };
      c.strokeStyle = K.border; c.lineWidth = 1.2;
      c.beginPath(); c.moveTo(a.x, a.y); c.bezierCurveTo(c1.x, c1.y, c2.x, c2.y, b.x, b.y); c.stroke();
      mono(c, 9.5, K.t4, "center");
      c.fillText(narrow ? "encrypted" : "your network · encrypted", lerp(a.x, b.x, 0.5), Math.min(a.y, b.y) - 14);

      phone(c, K, px, py, phW, phH);
      keyFlash(c, K, px + 6, py + phH * 0.46, phW - 12, phH * 0.44, loop.flight, loop.mode === "type" ? 1 - loop.p : 0);

      if (loop.mode === "type" && loop.flight) {
        var q = cubic(a, c1, c2, b, ez(clamp(loop.p / 0.85, 0, 1)));
        var label = '{"t":"key","k":"' + loop.flight + '"}';
        mono(c, 9.5, K.acc, "center");
        var tw = c.measureText(label).width;
        c.save(); c.shadowColor = K.acc; c.shadowBlur = 8;
        c.fillStyle = K.e0; c.strokeStyle = K.line; c.lineWidth = 1;
        rr(c, q.x - tw / 2 - 7, q.y - 9, tw + 14, 18, 6); c.fill(); c.stroke();
        c.restore();
        c.fillStyle = K.acc;
        c.fillText(label, q.x, q.y + 0.5);
      }

      c.fillStyle = K.e2; c.strokeStyle = K.borderHi; c.lineWidth = 1.4;
      rr(c, lx, ly, lsW, lsH, 8); c.fill(); c.stroke();
      c.fillStyle = K.e0; rr(c, lx + 5, ly + 5, lsW - 10, lsH - 10, 5); c.fill();
      c.fillStyle = K.e2; c.strokeStyle = K.borderHi;
      rr(c, lx - 10, ly + lsH, lsW + 20, 7, 3); c.fill(); c.stroke();

      mono(c, 9.5, K.t4, "left");
      c.fillText("receiver · open source", lx + 14, ly + 18);
      mono(c, 14, K.text, "left");
      c.fillText(loop.typed, lx + 14, ly + lsH * 0.55);
      if ((t * 2 | 0) % 2 === 0) {
        c.fillStyle = K.acc;
        c.fillRect(lx + 16 + c.measureText(loop.typed).width, ly + lsH * 0.55 - 6, 7, 12);
      }
      mono(c, 9, K.t4, "left");
      c.fillText("uinput · SendInput · CGEvent", lx + 14, ly + lsH - 14);
    };
  };

  /* ============ MODE 2: out-of-band, HID bytes drive a BIOS menu ============ */
  SIG.oob = function (c, dim) {
    var ROWS = ["NVME SSD", "USB DRIVE", "NETWORK"];
    var SEQ = [
      { code: "0x51", move: 1 }, { code: "0x51", move: 1 },
      { code: "0x28", move: 0 }, { code: "0x52", move: -1 },
      { code: "0x52", move: -1 }, { code: "0x28", move: 0 }
    ];
    var si = 0, p = 0, hl = 0, flash = 0;
    return function (t, dt) {
      var D = dim(), W = D.W, H = D.H, K = DK;
      c.clearRect(0, 0, W, H);
      var narrow = W < 520;
      var step = 1.05;
      p += dt / step; flash = Math.max(0, flash - dt * 2.2);
      if (p >= 1) {
        p = 0;
        var ev = SEQ[si];
        if (ev.move) hl = clamp(hl + ev.move, 0, ROWS.length - 1);
        else flash = 1;
        si = (si + 1) % SEQ.length;
      }

      var phW = clamp(W * 0.115, 40, 60), phH = phW * 1.95;
      var px = narrow ? 2 : 6, py = 12;
      var brW = clamp(W * 0.2, 76, 112), brH = narrow ? 46 : 54;
      var bx = W * (narrow ? 0.26 : 0.30), by = H * 0.52 - brH / 2;
      var moW = clamp(W * 0.36, 150, 220), moH = moW * 0.66;
      var mx = W - moW - (narrow ? 8 : 14), my = (H - moH) / 2 - 8;

      var a = { x: px + phW / 2, y: py + phH + 4 };
      var b = { x: bx + brW * 0.3, y: by - 4 };
      c.strokeStyle = K.border; c.lineWidth = 1.2;
      c.beginPath(); c.moveTo(a.x, a.y); c.bezierCurveTo(a.x, a.y + 26, b.x - 30, b.y - 22, b.x, b.y); c.stroke();
      mono(c, 9, K.t4, "left"); c.fillText("wifi", a.x + 8, (a.y + b.y) / 2);

      phone(c, K, px, py, phW, phH);

      c.save(); c.shadowColor = K.acc; c.shadowBlur = 14;
      c.fillStyle = K.e2; c.strokeStyle = K.acc; c.lineWidth = 1.3;
      rr(c, bx, by, brW, brH, 10); c.fill(); c.restore();
      c.strokeStyle = K.line; rr(c, bx, by, brW, brH, 10); c.stroke();
      mono(c, narrow ? 9.5 : 10.5, K.text, "center"); c.fillText("BRIDGE", bx + brW / 2, by + brH * 0.38);
      mono(c, narrow ? 8.5 : 9, K.t3, "center"); c.fillText("pi · dongle", bx + brW / 2, by + brH * 0.7);

      var u0 = { x: bx + brW + 4, y: by + 16 };
      var u1 = { x: mx - 8, y: my + moH * 0.3 };
      c.strokeStyle = K.acc2; c.lineWidth = 1.3; c.globalAlpha = 0.7;
      c.beginPath(); c.moveTo(u0.x, u0.y); c.bezierCurveTo(u0.x + 40, u0.y - 14, u1.x - 40, u1.y - 8, u1.x, u1.y); c.stroke();
      c.globalAlpha = 1;
      mono(c, 9, K.t4, "center");
      c.fillText(narrow ? "USB HID" : "USB · a real keyboard", (u0.x + u1.x) / 2, u0.y - 18);

      var q = cubic(u0, { x: u0.x + 40, y: u0.y - 14 }, { x: u1.x - 40, y: u1.y - 8 }, u1, ez(p));
      var code = SEQ[si].code;
      mono(c, 9.5, K.acc, "center");
      var tw = c.measureText(code).width;
      c.save(); c.shadowColor = K.acc; c.shadowBlur = 7;
      c.fillStyle = K.e0; c.strokeStyle = K.line; rr(c, q.x - tw / 2 - 6, q.y - 8.5, tw + 12, 17, 5); c.fill(); c.stroke();
      c.restore();
      c.fillStyle = K.acc; c.fillText(code, q.x, q.y + 0.5);

      var h0 = { x: mx - 8, y: my + moH * 0.78 };
      var h1 = { x: bx + brW * 0.7, y: by + brH + 4 };
      c.strokeStyle = K.t4; c.lineWidth = 1.1; c.setLineDash([4, 4]);
      c.beginPath(); c.moveTo(h0.x, h0.y); c.bezierCurveTo(h0.x - 50, h0.y + 14, h1.x + 40, h1.y + 22, h1.x, h1.y); c.stroke();
      c.setLineDash([]);
      mono(c, 9, K.t4, "center");
      c.fillText(narrow ? "HDMI" : "HDMI capture · the eyes", (h0.x + h1.x) / 2 + 10, h0.y + 26);
      for (var k = 0; k < 3; k++) {
        var fp = ((t * 0.35 + k / 3) % 1);
        var fq = cubic(h0, { x: h0.x - 50, y: h0.y + 14 }, { x: h1.x + 40, y: h1.y + 22 }, h1, fp);
        c.fillStyle = K.t3; c.globalAlpha = 0.8;
        c.fillRect(fq.x - 2.5, fq.y - 2, 5, 4); c.globalAlpha = 1;
      }

      c.fillStyle = K.e2; c.strokeStyle = K.borderHi; c.lineWidth = 1.3;
      c.setLineDash([4, 4]); rr(c, mx, my, moW, moH, 10); c.fill(); c.stroke(); c.setLineDash([]);
      c.fillStyle = K.e0; rr(c, mx + 6, my + 6, moW - 12, moH - 12, 6); c.fill();

      var fs = narrow ? 9.5 : 10.5;
      var tx = mx + (narrow ? 14 : 18), ty = my + 22;
      mono(c, 9.5, K.t3, "left"); c.fillText(narrow ? "BOOT ORDER" : "BOOT ORDER · F2 SETUP", tx, ty);
      for (var r = 0; r < ROWS.length; r++) {
        var ry = ty + 18 + r * (narrow ? 16 : 19);
        if (r === hl) {
          c.fillStyle = K.ghost;
          rr(c, tx - 5, ry - 8, moW - (narrow ? 28 : 38), 16, 4); c.fill();
          if (flash > 0) { c.strokeStyle = K.acc; c.globalAlpha = flash; rr(c, tx - 5, ry - 8, moW - (narrow ? 28 : 38), 16, 4); c.stroke(); c.globalAlpha = 1; }
        }
        mono(c, fs, r === hl ? K.acc : K.t2, "left");
        c.fillText((r + 1) + ". " + ROWS[r], tx, ry);
      }
      mono(c, 9, K.t4, "center");
      c.fillText(narrow ? "no OS needed" : "no OS · nothing runs here", mx + moW / 2, my + moH + 13);
    };
  };

  /* =================== USE-CASE VIGNETTES ===================
     Devices stay on the dark deck (a TV is dark glass even on a light page);
     wires and captions on the card follow the page theme. */
  SIG["uc-tv"] = function (c, dim) {
    var loop = typeLoop(["interstellar", "wifi password", "jazz radio"], 0.22, 1.3);
    return function (t, dt) {
      var D = dim(), W = D.W, H = D.H, K = DK;
      c.clearRect(0, 0, W, H);
      loop.update(dt);
      var tw = Math.min(W * 0.74, 210), th = H - 26;
      c.fillStyle = K.e2; c.strokeStyle = K.borderHi; c.lineWidth = 1.2;
      rr(c, 0, 4, tw, th, 8); c.fill(); c.stroke();
      c.fillStyle = K.e0; rr(c, 4, 8, tw - 8, th - 8, 5); c.fill();
      c.strokeStyle = K.border; c.fillStyle = K.e1;
      rr(c, 14, 18, tw - 28, 22, 5); c.fill(); c.stroke();
      mono(c, 10.5, K.acc, "left");
      c.fillText(loop.typed, 22, 29.5);
      if ((t * 2 | 0) % 2 === 0) c.fillRect(24 + c.measureText(loop.typed).width, 24, 6, 11);
      mono(c, 9, K.t4, "left"); c.fillText("SEARCH", 22, 52);
      var px = W - 34, py = H - 58;
      phone(c, K, px, py, 26, 50);
      if (loop.mode === "type" && loop.flight) {
        c.globalAlpha = 1 - loop.p;
        glowDot(c, K, px + 13, py + 30, 2.6);
        c.globalAlpha = 1;
      }
      c.strokeStyle = P.border; c.lineWidth = 1;
      c.beginPath(); c.moveTo(px - 4, py + 24); c.quadraticCurveTo(tw + 16, H * 0.4, tw - 2, 30); c.stroke();
    };
  };

  SIG["uc-bios"] = function (c, dim) {
    var rows = ["NVME SSD", "USB DRIVE", "PXE BOOT"];
    var hl = 0, p = 0, dir = 1, chip = 0;
    return function (t, dt) {
      var D = dim(), W = D.W, H = D.H, K = DK;
      c.clearRect(0, 0, W, H);
      p += dt / 0.9; chip = Math.max(0, chip - dt * 1.6);
      if (p >= 1) { p = 0; hl += dir; if (hl >= rows.length - 1 || hl <= 0) dir *= -1; chip = 1; }
      var bw = Math.min(W * 0.66, 190);
      c.fillStyle = K.e0; c.strokeStyle = K.borderHi; c.lineWidth = 1.2;
      c.setLineDash([4, 4]); rr(c, 0, 4, bw, H - 12, 7); c.fill(); c.stroke(); c.setLineDash([]);
      mono(c, 8.5, K.t4, "left"); c.fillText("BOOT MENU", 12, 18);
      for (var r = 0; r < rows.length; r++) {
        var ry = 33 + r * 17;
        if (r === hl) { c.fillStyle = K.ghost; rr(c, 8, ry - 7.5, bw - 16, 15, 3); c.fill(); }
        mono(c, 9.5, r === hl ? K.acc : K.t3, "left");
        c.fillText(rows[r], 13, ry);
      }
      if (chip > 0) {
        mono(c, 9.5, P.acc, "center");
        c.globalAlpha = chip;
        var label = dir > 0 ? "0x51" : "0x52";
        var tw2 = c.measureText(label).width;
        c.fillStyle = P.e1; c.strokeStyle = P.line;
        rr(c, bw + 14, H / 2 - 9, tw2 + 14, 18, 5); c.fill(); c.stroke();
        c.fillStyle = P.acc; c.fillText(label, bw + 21 + tw2 / 2, H / 2 + 0.5);
        c.globalAlpha = 1;
      }
      mono(c, 8.5, P.t4, "left"); c.fillText("HID →", bw + 14, H / 2 - 18);
    };
  };

  SIG["uc-couch"] = function (c, dim) {
    var prog = 0.18, playing = true, cx = 0, cy = 0, clickT = -9;
    return function (t, dt) {
      var D = dim(), W = D.W, H = D.H, K = DK;
      c.clearRect(0, 0, W, H);
      if (playing) prog = (prog + dt * 0.045) % 1;
      var ww = Math.min(W * 0.8, 220), wh = H - 18;
      c.fillStyle = K.e2; c.strokeStyle = K.borderHi; c.lineWidth = 1.2;
      rr(c, 0, 4, ww, wh, 8); c.fill(); c.stroke();
      c.fillStyle = K.e0; rr(c, 4, 16, ww - 8, wh - 20, 5); c.fill();
      c.fillStyle = K.t4;
      c.beginPath(); c.arc(12, 10.5, 2, 0, TAU); c.arc(20, 10.5, 2, 0, TAU); c.fill();
      var gx = ww / 2, gy = 8 + (wh - 16) / 2;
      c.fillStyle = K.t2;
      if (playing) { c.fillRect(gx - 7, gy - 8, 4.5, 16); c.fillRect(gx + 2.5, gy - 8, 4.5, 16); }
      else { c.beginPath(); c.moveTo(gx - 6, gy - 9); c.lineTo(gx + 9, gy); c.lineTo(gx - 6, gy + 9); c.closePath(); c.fill(); }
      c.strokeStyle = K.border; c.lineWidth = 3; c.lineCap = "round";
      c.beginPath(); c.moveTo(14, wh - 8); c.lineTo(ww - 14, wh - 8); c.stroke();
      c.strokeStyle = K.acc;
      c.beginPath(); c.moveTo(14, wh - 8); c.lineTo(14 + (ww - 28) * prog, wh - 8); c.stroke();
      var ph = (t % 5) / 5;
      var targX = gx + 1, targY = gy + 2;
      if (ph < 0.55) { cx = lerp(W * 0.86, targX, ez(ph / 0.55)); cy = lerp(H * 0.78, targY, ez(ph / 0.55)); }
      else { cx = targX; cy = targY; }
      if (ph >= 0.56 && ph < 0.585 && t - clickT > 2) { clickT = t; playing = !playing; }
      var rip = t - clickT;
      if (rip < 0.5) {
        c.strokeStyle = K.acc; c.globalAlpha = 1 - rip * 2; c.lineWidth = 1.2;
        c.beginPath(); c.arc(cx, cy, 4 + rip * 26, 0, TAU); c.stroke(); c.globalAlpha = 1;
      }
      c.fillStyle = K.text;
      c.beginPath(); c.moveTo(cx, cy); c.lineTo(cx + 8, cy + 8.5); c.lineTo(cx + 3.4, cy + 8.8); c.lineTo(cx + 1.4, cy + 12.6); c.closePath(); c.fill();
    };
  };

  SIG["uc-present"] = function (c, dim) {
    /* a slide is white in real life: fixed light surface in both themes */
    var SL = { bg: "oklch(0.965 0.003 265)", ink: "oklch(0.22 0.012 265)", edge: "oklch(0.84 0.006 265)" };
    var n = 12, slide = 0, tapT = -9;
    return function (t) {
      var D = dim(), W = D.W, H = D.H;
      c.clearRect(0, 0, W, H);
      var per = 2.6;
      var cur = Math.floor(t / per);
      if (cur !== slide) { slide = cur; tapT = t; }
      var sw = Math.min(W * 0.42, 110), sh = H - 22;
      c.fillStyle = SL.bg; c.strokeStyle = SL.edge; c.lineWidth = 1.2;
      rr(c, 0, 6, sw, sh, 7); c.fill(); c.stroke();
      var k = clamp((t - tapT) / 0.4, 0, 1);
      var num = n + slide;
      c.save(); c.beginPath(); rr(c, 0, 6, sw, sh, 7); c.clip();
      c.font = "600 26px " + P.mono; c.textAlign = "center"; c.textBaseline = "middle";
      c.fillStyle = SL.ink;
      c.fillText(String(num), sw / 2 + (1 - ez(k)) * sw * 0.6, 6 + sh / 2);
      if (k < 1) { c.globalAlpha = 1 - k; c.fillStyle = SL.edge; c.fillText(String(num - 1), sw / 2 - ez(k) * sw * 0.6, 6 + sh / 2); c.globalAlpha = 1; }
      c.restore();
      mono(c, 8.5, P.t4, "center"); c.fillText("SLIDE", sw / 2, H - 6);
      var nx = sw + 18;
      mono(c, 8.5, P.t4, "left"); c.fillText("NOTES", nx, 16);
      for (var i = 0; i < 3; i++) {
        c.strokeStyle = i === 0 ? P.t2 : P.border; c.lineWidth = i === 0 ? 2 : 1.6; c.lineCap = "round";
        c.beginPath(); c.moveTo(nx, 30 + i * 13); c.lineTo(nx + (W - nx - 12) * (i === 0 ? 0.92 : 0.7 - i * 0.12), 30 + i * 13); c.stroke();
      }
      var rip = t - tapT;
      if (rip < 0.5 && rip >= 0) {
        c.strokeStyle = P.acc; c.globalAlpha = 1 - rip * 2;
        c.beginPath(); c.arc(nx + 16, H - 14, 3 + rip * 18, 0, TAU); c.stroke(); c.globalAlpha = 1;
      }
      c.fillStyle = P.acc; c.beginPath(); c.arc(nx + 16, H - 14, 2.6, 0, TAU); c.fill();
      mono(c, 8.5, P.t4, "left"); c.fillText("tap → next", nx + 26, H - 14);
    };
  };

  SIG["uc-agent"] = function (c, dim) {
    /* a real session you watch: an MCP-driven cursor works a tiny UI by
       itself, with the actual tool call shown beside it */
    var PH = [
      { d: 1.2, call: "moveto 118,46" },
      { d: 0.35, call: "click left" },
      { d: 0.95, call: 'type "rel"' },
      { d: 1.0, call: "moveto 212,46" },
      { d: 0.35, call: "click left" },
      { d: 1.3, call: null }
    ];
    var pi = 0, pt = 0, typed = 0, cx = 24, cy = 70, sx = 24, sy = 70, clickR = -9;
    return function (t, dt) {
      var D = dim(), W = D.W, H = D.H, K = DK;
      c.clearRect(0, 0, W, H);
      pt += dt;
      if (pt >= PH[pi].d) {
        pt = 0; pi = (pi + 1) % PH.length;
        sx = cx; sy = cy;
        if (pi === 0) { typed = 0; sx = cx = 24; sy = cy = H * 0.75; }
        if (PH[pi].call === "click left") clickR = 0;
      }
      if (clickR >= 0) clickR += dt;

      var sw = Math.min(W * 0.72, 205), sh = H - 16;
      c.fillStyle = K.e2; c.strokeStyle = K.borderHi; c.lineWidth = 1.2;
      rr(c, 0, 4, sw, sh, 8); c.fill(); c.stroke();
      c.fillStyle = K.e0; rr(c, 4, 14, sw - 8, sh - 18, 5); c.fill();
      c.fillStyle = K.t4;
      c.beginPath(); c.arc(11, 9.5, 1.8, 0, TAU); c.arc(18, 9.5, 1.8, 0, TAU); c.fill();
      mono(c, 8, K.t4, "right"); c.fillText("agent session", sw - 8, 9.5);

      // the tiny UI it drives: a field and a GO button
      var fx = 14, fy = sh * 0.46, fw = sw * 0.5, fh = 18;
      var bx = fx + fw + 10, bw2 = 34;
      var done = pi === 5;
      c.fillStyle = K.e1; c.strokeStyle = K.border; c.lineWidth = 1;
      rr(c, fx, fy, fw, fh, 4); c.fill(); c.stroke();
      if (pi === 2) typed = clamp(Math.ceil(3 * pt / PH[2].d), 0, 3);
      mono(c, 9.5, K.acc, "left");
      c.fillText("rel".slice(0, typed), fx + 7, fy + fh / 2 + 0.5);
      c.fillStyle = done ? K.ghost : K.e1; c.strokeStyle = done ? K.acc : K.border;
      rr(c, bx, fy, bw2, fh, 4); c.fill(); c.stroke();
      mono(c, 8.5, done ? K.acc : K.t3, "center");
      c.fillText("GO", bx + bw2 / 2, fy + fh / 2 + 0.5);

      // the cursor, moving like a hand (eased, slightly curved)
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
      c.fillStyle = K.text;
      c.beginPath(); c.moveTo(cx, cy); c.lineTo(cx + 7.5, cy + 8); c.lineTo(cx + 3.2, cy + 8.3); c.lineTo(cx + 1.3, cy + 11.8); c.closePath(); c.fill();

      // the tool call that caused it, on the card edge (like the HID bytes)
      mono(c, 8.5, P.t4, "left"); c.fillText("MCP \u2192", sw + 12, H / 2 - 18);
      var call = PH[pi].call;
      if (call) {
        mono(c, 8.5, P.acc, "left");
        var tw2 = c.measureText(call).width;
        c.fillStyle = P.e1; c.strokeStyle = P.line; c.lineWidth = 1;
        rr(c, sw + 10, H / 2 - 9, Math.min(tw2 + 12, W - sw - 12), 18, 5); c.fill(); c.stroke();
        c.fillStyle = P.acc; c.fillText(call, sw + 16, H / 2 + 0.5);
      }
    };
  };

  SIG["uc-fleet"] = function (c, dim) {
    /* a real device directory: hostnames, live dots, latencies ticking,
       one machine joining and dropping off */
    var ROWS = [
      { n: "popos", on: 1, ms: 9 },
      { n: "mediapc", on: 1, ms: 14 },
      { n: "lab-3", on: 1, ms: 22 },
      { n: "kiosk", on: 0, ms: 31 }
    ];
    return function (t) {
      var D = dim(), W = D.W, H = D.H, K = DK;
      c.clearRect(0, 0, W, H);
      var kioskOn = (t % 6) > 3;
      var pw = Math.min(W * 0.92, 250), ph2 = H - 12;
      c.fillStyle = K.e0; c.strokeStyle = K.borderHi; c.lineWidth = 1.2;
      rr(c, 0, 6, pw, ph2, 8); c.fill(); c.stroke();
      mono(c, 8, K.t4, "left"); c.fillText("DEVICES", 12, 18);
      mono(c, 8, K.t4, "right"); c.fillText((3 + (kioskOn ? 1 : 0)) + "/4 up", pw - 12, 18);
      var n = ROWS.length, step = (ph2 - 32) / n;
      for (var i = 0; i < n; i++) {
        var r = ROWS[i];
        var on = r.on === 1 || (i === 3 && kioskOn);
        var ry = 31 + i * step + step / 2 - 4;
        if (i === 3) {
          var k = (t % 6) - 3;
          if (k >= 0 && k < 0.6) {
            c.fillStyle = K.ghost; c.globalAlpha = 1 - k / 0.6;
            rr(c, 6, ry - 7, pw - 12, 14, 3); c.fill(); c.globalAlpha = 1;
          }
        }
        if (on) {
          c.fillStyle = K.acc;
          c.globalAlpha = 0.55 + 0.45 * (0.5 + 0.5 * Math.sin(t * 2.4 + i * 2));
          c.beginPath(); c.arc(15, ry, 2.4, 0, TAU); c.fill(); c.globalAlpha = 1;
        } else {
          c.strokeStyle = K.t4; c.lineWidth = 1.1;
          c.beginPath(); c.arc(15, ry, 2.2, 0, TAU); c.stroke();
        }
        mono(c, 9.5, on ? K.t2 : K.t4, "left"); c.fillText(r.n, 26, ry);
        var ms = on ? (r.ms + Math.round(Math.sin(t * 1.7 + i * 9) * 2)) + " ms" : "offline";
        mono(c, 9, on ? K.acc : K.t4, "right"); c.fillText(ms, pw - 12, ry);
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
    var frame = B(c, function () { return { W: W, H: H }; });
    size();
    var raf = 0, last = 0, vis = false;
    function tick(ts) {
      if (!vis) { raf = 0; return; }
      var dt = last ? Math.min(0.05, (ts - last) / 1000) : 0.016;
      last = ts;
      frame(ts / 1000, dt);
      raf = requestAnimationFrame(tick);
    }
    function start() { if (!raf) { last = 0; raf = requestAnimationFrame(tick); } }
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
