/* signal.js · Relay's live figures.
   Every illustration on this site is drawn at runtime from the product's
   real internals: actual wire-protocol lines, real HID usage codes,
   keystrokes landing letter by letter. No stock art, no icon grids.
   Canvas 2D, theme-aware (reads the site tokens), pauses off-screen,
   honors prefers-reduced-motion. */
(function () {
  "use strict";

  var REDUCED = matchMedia("(prefers-reduced-motion: reduce)").matches;
  var DPR = Math.min(devicePixelRatio || 1, 2);
  var TAU = Math.PI * 2;
  function lerp(a, b, t) { return a + (b - a) * t; }
  function clamp(v, a, b) { return Math.min(b, Math.max(a, v)); }
  function ez(t) { return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2; }

  /* ---- palette from the site tokens (refreshes on theme change) ---- */
  var P = {};
  function palette() {
    var cs = getComputedStyle(document.documentElement);
    function g(k, d) { var v = cs.getPropertyValue(k).trim(); return v || d; }
    P.e0 = g("--e0", "#131318"); P.e1 = g("--e1", "#1b1b22");
    P.e2 = g("--e2", "#22222a"); P.e3 = g("--e3", "#2a2a33");
    P.border = g("--border", "#3a3a44"); P.borderHi = g("--border-hi", "#55555f");
    P.text = g("--text", "#f4f4f6"); P.t2 = g("--text-2", "#b9b9c0");
    P.t3 = g("--text-3", "#8b8b93"); P.t4 = g("--text-4", "#67676f");
    P.acc = g("--accent", "#65ea92"); P.acc2 = g("--accent-2", "#3ec877");
    P.ghost = g("--accent-ghost", "rgba(101,234,146,.13)");
    P.line = g("--accent-line", "rgba(101,234,146,.32)");
    P.mono = g("--font-mono", "ui-monospace, monospace");
  }
  palette();
  new MutationObserver(palette).observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });

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
  function glowDot(c, x, y, r) {
    c.save();
    c.shadowColor = P.acc; c.shadowBlur = 12;
    c.fillStyle = P.acc;
    c.beginPath(); c.arc(x, y, r, 0, TAU); c.fill();
    c.restore();
  }
  function cubic(p0, p1, p2, p3, t) {
    var u = 1 - t, a = u * u * u, b = 3 * u * u * t, d = 3 * u * t * t, e = t * t * t;
    return { x: a * p0.x + b * p1.x + d * p2.x + e * p3.x, y: a * p0.y + b * p1.y + d * p2.y + e * p3.y };
  }
  function phone(c, x, y, w, h) {
    c.fillStyle = P.e2; c.strokeStyle = P.borderHi; c.lineWidth = 1.4;
    rr(c, x, y, w, h, Math.min(12, w * 0.16)); c.fill(); c.stroke();
    c.fillStyle = P.e0; rr(c, x + 4, y + 7, w - 8, h - 14, 7); c.fill();
    c.strokeStyle = P.border; c.lineWidth = 2; c.lineCap = "round";
    c.beginPath(); c.moveTo(x + w * 0.38, y + h - 11); c.lineTo(x + w * 0.62, y + h - 11); c.stroke();
  }
  // flash one pseudo-random key cell on a phone screen for the char in flight
  function keyFlash(c, x, y, w, h, ch, a) {
    var cols = 5, rows = 4, gx = 4, gy = 4;
    var kw = (w - gx * (cols + 1)) / cols, kh = (h - gy * (rows + 1)) / rows;
    for (var r = 0; r < rows; r++) for (var q = 0; q < cols; q++) {
      var kx = x + gx + q * (kw + gx), ky = y + gy + r * (kh + gy);
      c.fillStyle = P.e3; c.globalAlpha = 0.6;
      rr(c, kx, ky, kw, kh, 3); c.fill(); c.globalAlpha = 1;
    }
    if (ch && a > 0) {
      var n = (ch.charCodeAt(0) * 7) % (cols * rows);
      var fq = n % cols, fr = (n / cols) | 0;
      var fx = x + gx + fq * (kw + gx), fy = y + gy + fr * (kh + gy);
      c.globalAlpha = a;
      c.fillStyle = P.ghost; rr(c, fx, fy, kw, kh, 3); c.fill();
      c.strokeStyle = P.acc; c.lineWidth = 1.2; rr(c, fx, fy, kw, kh, 3); c.stroke();
      c.globalAlpha = 1;
    }
  }
  // a keystroke-typing loop: launches a char, it travels, then it lands
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
  SIG.hero = function (c, dim) {
    var loop = typeLoop(["wake the dead box", "BIOS> boot from usb", "search: interstellar", "hello from a phone"], 0.34, 1.6);
    var scroll = 0;
    return function (t, dt) {
      var D = dim(), W = D.W, H = D.H;
      c.clearRect(0, 0, W, H);
      loop.update(dt); scroll += dt * 26;

      var m = Math.max(22, W * 0.045);
      var phW = clamp(W * 0.105, 64, 92), phH = phW * 1.95;
      var py = (H - 30 - phH) / 2 + 6;
      var px = m;
      // monitor
      var moW = clamp(W * 0.34, 200, 320), moH = moW * 0.62;
      var mx = W - m - moW, my = (H - 30 - moH - 14) / 2 + 2;

      // link path
      var a = { x: px + phW + 6, y: py + phH * 0.42 };
      var b = { x: mx - 8, y: my + moH * 0.5 };
      var c1 = { x: lerp(a.x, b.x, 0.38), y: a.y - 26 };
      var c2 = { x: lerp(a.x, b.x, 0.66), y: b.y + 22 };
      c.strokeStyle = P.border; c.lineWidth = 1.3;
      c.beginPath(); c.moveTo(a.x, a.y); c.bezierCurveTo(c1.x, c1.y, c2.x, c2.y, b.x, b.y); c.stroke();
      mono(c, 10, P.t4, "center");
      c.fillText("encrypted · 9 ms", lerp(a.x, b.x, 0.5), Math.min(a.y, b.y) - 18);

      // phone + key flash
      phone(c, px, py, phW, phH);
      keyFlash(c, px + 7, py + phH * 0.46, phW - 14, phH * 0.44, loop.flight, loop.mode === "type" ? 1 - loop.p : 0);
      mono(c, 10, P.t3, "center");
      c.fillText("your phone", px + phW / 2, py + phH + 16);

      // pulse in flight
      if (loop.mode === "type" && loop.flight) {
        var q = cubic(a, c1, c2, b, ez(clamp(loop.p / 0.85, 0, 1)));
        glowDot(c, q.x, q.y, 3.4);
      }

      // monitor frame + stand
      c.fillStyle = P.e2; c.strokeStyle = P.borderHi; c.lineWidth = 1.4;
      rr(c, mx, my, moW, moH, 10); c.fill(); c.stroke();
      c.fillStyle = P.e0; rr(c, mx + 6, my + 6, moW - 12, moH - 12, 6); c.fill();
      c.strokeStyle = P.borderHi;
      c.beginPath(); c.moveTo(mx + moW * 0.42, my + moH); c.lineTo(mx + moW * 0.40, my + moH + 12); c.moveTo(mx + moW * 0.58, my + moH); c.lineTo(mx + moW * 0.60, my + moH + 12); c.stroke();
      mono(c, 10, P.t3, "center");
      c.fillText("any machine · nothing installed", mx + moW / 2, my + moH + 24);

      // terminal content
      var tx = mx + 18, ty = my + 24;
      mono(c, 10, P.t4, "left");
      c.fillText("relay · link up · 47600", tx, ty);
      mono(c, 13, P.t3, "left");
      c.fillText(">", tx, ty + 24);
      mono(c, 13, P.acc, "left");
      var typed = loop.typed;
      c.fillText(typed, tx + 14, ty + 24);
      // caret
      if ((t * 2 | 0) % 2 === 0) {
        var cw = c.measureText(typed).width;
        c.fillRect(tx + 18 + cw, ty + 18, 7, 12);
      }

      // wire stream along the bottom: the real protocol, scrolling
      var line = WIRE.join("   ");
      mono(c, 10, P.t4, "left");
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
      var D = dim(), W = D.W, H = D.H;
      c.clearRect(0, 0, W, H);
      loop.update(dt);

      var phW = clamp(W * 0.14, 54, 70), phH = phW * 1.95;
      var px = 8, py = (H - phH) / 2 - 6;
      // laptop
      var lsW = clamp(W * 0.42, 160, 210), lsH = lsW * 0.62;
      var lx = W - lsW - 18, ly = (H - lsH) / 2 - 12;

      var a = { x: px + phW + 6, y: py + phH * 0.4 };
      var b = { x: lx - 10, y: ly + lsH * 0.55 };
      var c1 = { x: lerp(a.x, b.x, 0.4), y: a.y - 20 };
      var c2 = { x: lerp(a.x, b.x, 0.6), y: b.y + 16 };
      c.strokeStyle = P.border; c.lineWidth = 1.2;
      c.beginPath(); c.moveTo(a.x, a.y); c.bezierCurveTo(c1.x, c1.y, c2.x, c2.y, b.x, b.y); c.stroke();
      mono(c, 9.5, P.t4, "center");
      c.fillText("your network · encrypted", lerp(a.x, b.x, 0.5), Math.min(a.y, b.y) - 14);

      phone(c, px, py, phW, phH);
      keyFlash(c, px + 6, py + phH * 0.46, phW - 12, phH * 0.44, loop.flight, loop.mode === "type" ? 1 - loop.p : 0);

      // the JSON packet in flight: the actual protocol line for this key
      if (loop.mode === "type" && loop.flight) {
        var q = cubic(a, c1, c2, b, ez(clamp(loop.p / 0.85, 0, 1)));
        var label = '{"t":"key","k":"' + loop.flight + '"}';
        mono(c, 9.5, P.acc, "center");
        var tw = c.measureText(label).width;
        c.save(); c.shadowColor = P.acc; c.shadowBlur = 8;
        c.fillStyle = P.e0; c.strokeStyle = P.line; c.lineWidth = 1;
        rr(c, q.x - tw / 2 - 7, q.y - 9, tw + 14, 18, 6); c.fill(); c.stroke();
        c.restore();
        c.fillStyle = P.acc;
        c.fillText(label, q.x, q.y + 0.5);
      }

      // laptop: screen + base
      c.fillStyle = P.e2; c.strokeStyle = P.borderHi; c.lineWidth = 1.4;
      rr(c, lx, ly, lsW, lsH, 8); c.fill(); c.stroke();
      c.fillStyle = P.e0; rr(c, lx + 5, ly + 5, lsW - 10, lsH - 10, 5); c.fill();
      c.fillStyle = P.e2; c.strokeStyle = P.borderHi;
      rr(c, lx - 10, ly + lsH, lsW + 20, 7, 3); c.fill(); c.stroke();

      // receiver window: the word lands letter by letter
      mono(c, 9.5, P.t4, "left");
      c.fillText("receiver · open source", lx + 14, ly + 18);
      mono(c, 14, P.text, "left");
      c.fillText(loop.typed, lx + 14, ly + lsH * 0.55);
      if ((t * 2 | 0) % 2 === 0) {
        c.fillStyle = P.acc;
        c.fillRect(lx + 16 + c.measureText(loop.typed).width, ly + lsH * 0.55 - 6, 7, 12);
      }
      mono(c, 9, P.t4, "left");
      c.fillText("uinput · SendInput · CGEvent", lx + 14, ly + lsH - 14);
    };
  };

  /* ============ MODE 2: out-of-band, HID bytes drive a BIOS menu ============ */
  SIG.oob = function (c, dim) {
    var ROWS = ["NVME SSD", "USB DRIVE", "NETWORK"];
    // real HID usage IDs: 0x51 down, 0x52 up, 0x28 enter
    var SEQ = [
      { code: "0x51", move: 1 }, { code: "0x51", move: 1 },
      { code: "0x28", move: 0 }, { code: "0x52", move: -1 },
      { code: "0x52", move: -1 }, { code: "0x28", move: 0 }
    ];
    var si = 0, p = 0, hl = 0, flash = 0;
    return function (t, dt) {
      var D = dim(), W = D.W, H = D.H;
      c.clearRect(0, 0, W, H);
      var step = 1.05;
      p += dt / step; flash = Math.max(0, flash - dt * 2.2);
      if (p >= 1) {
        p = 0;
        var ev = SEQ[si];
        if (ev.move) hl = clamp(hl + ev.move, 0, ROWS.length - 1);
        else flash = 1;
        si = (si + 1) % SEQ.length;
      }

      var phW = clamp(W * 0.115, 46, 60), phH = phW * 1.95;
      var px = 6, py = 12;
      var brW = clamp(W * 0.2, 86, 112), brH = 54;
      var bx = W * 0.30, by = H * 0.52 - brH / 2;
      var moW = clamp(W * 0.36, 168, 220), moH = moW * 0.66;
      var mx = W - moW - 14, my = (H - moH) / 2 - 8;

      // phone -> bridge
      var a = { x: px + phW / 2, y: py + phH + 4 };
      var b = { x: bx + brW * 0.3, y: by - 4 };
      c.strokeStyle = P.border; c.lineWidth = 1.2;
      c.beginPath(); c.moveTo(a.x, a.y); c.bezierCurveTo(a.x, a.y + 26, b.x - 30, b.y - 22, b.x, b.y); c.stroke();
      mono(c, 9, P.t4, "left"); c.fillText("wifi", a.x + 8, (a.y + b.y) / 2);

      phone(c, px, py, phW, phH);

      // bridge
      c.save(); c.shadowColor = P.acc; c.shadowBlur = 14;
      c.fillStyle = P.e2; c.strokeStyle = P.acc; c.lineWidth = 1.3;
      rr(c, bx, by, brW, brH, 10); c.fill(); c.restore();
      c.strokeStyle = P.line; rr(c, bx, by, brW, brH, 10); c.stroke();
      mono(c, 10.5, P.text, "center"); c.fillText("BRIDGE", bx + brW / 2, by + 21);
      mono(c, 9, P.t3, "center"); c.fillText("pi · dongle", bx + brW / 2, by + 37);

      // usb path (bridge -> target) with HID byte chips
      var u0 = { x: bx + brW + 4, y: by + 16 };
      var u1 = { x: mx - 8, y: my + moH * 0.3 };
      c.strokeStyle = P.acc2; c.lineWidth = 1.3; c.globalAlpha = 0.7;
      c.beginPath(); c.moveTo(u0.x, u0.y); c.bezierCurveTo(u0.x + 40, u0.y - 14, u1.x - 40, u1.y - 8, u1.x, u1.y); c.stroke();
      c.globalAlpha = 1;
      mono(c, 9, P.t4, "center"); c.fillText("USB · a real keyboard", (u0.x + u1.x) / 2, u0.y - 18);

      var q = cubic(u0, { x: u0.x + 40, y: u0.y - 14 }, { x: u1.x - 40, y: u1.y - 8 }, u1, ez(p));
      var code = SEQ[si].code;
      mono(c, 9.5, P.acc, "center");
      var tw = c.measureText(code).width;
      c.save(); c.shadowColor = P.acc; c.shadowBlur = 7;
      c.fillStyle = P.e0; c.strokeStyle = P.line; rr(c, q.x - tw / 2 - 6, q.y - 8.5, tw + 12, 17, 5); c.fill(); c.stroke();
      c.restore();
      c.fillStyle = P.acc; c.fillText(code, q.x, q.y + 0.5);

      // hdmi capture path (target -> bridge), frames flowing back
      var h0 = { x: mx - 8, y: my + moH * 0.78 };
      var h1 = { x: bx + brW * 0.7, y: by + brH + 4 };
      c.strokeStyle = P.t4; c.lineWidth = 1.1; c.setLineDash([4, 4]);
      c.beginPath(); c.moveTo(h0.x, h0.y); c.bezierCurveTo(h0.x - 50, h0.y + 14, h1.x + 40, h1.y + 22, h1.x, h1.y); c.stroke();
      c.setLineDash([]);
      mono(c, 9, P.t4, "center"); c.fillText("HDMI capture · the eyes", (h0.x + h1.x) / 2 + 10, h0.y + 26);
      for (var k = 0; k < 3; k++) {
        var fp = ((t * 0.35 + k / 3) % 1);
        var fq = cubic(h0, { x: h0.x - 50, y: h0.y + 14 }, { x: h1.x + 40, y: h1.y + 22 }, h1, fp);
        c.fillStyle = P.t3; c.globalAlpha = 0.8;
        c.fillRect(fq.x - 2.5, fq.y - 2, 5, 4); c.globalAlpha = 1;
      }

      // target: dashed monitor with a live BIOS menu
      c.fillStyle = P.e2; c.strokeStyle = P.borderHi; c.lineWidth = 1.3;
      c.setLineDash([4, 4]); rr(c, mx, my, moW, moH, 10); c.fill(); c.stroke(); c.setLineDash([]);
      c.fillStyle = P.e0; rr(c, mx + 6, my + 6, moW - 12, moH - 12, 6); c.fill();

      var tx = mx + 18, ty = my + 22;
      mono(c, 9.5, P.t3, "left"); c.fillText("BOOT ORDER · F2 SETUP", tx, ty);
      for (var r = 0; r < ROWS.length; r++) {
        var ry = ty + 18 + r * 19;
        if (r === hl) {
          c.fillStyle = P.ghost;
          rr(c, tx - 5, ry - 8.5, moW - 38, 17, 4); c.fill();
          if (flash > 0) { c.strokeStyle = P.acc; c.globalAlpha = flash; rr(c, tx - 5, ry - 8.5, moW - 38, 17, 4); c.stroke(); c.globalAlpha = 1; }
        }
        mono(c, 10.5, r === hl ? P.acc : P.t2, "left");
        c.fillText((r + 1) + ". " + ROWS[r], tx, ry);
      }
      mono(c, 9, P.t4, "center");
      c.fillText("no OS · nothing runs here", mx + moW / 2, my + moH + 13);
    };
  };

  /* =================== USE-CASE VIGNETTES (small, alive) =================== */
  SIG["uc-tv"] = function (c, dim) {
    var loop = typeLoop(["interstellar", "wifi password", "jazz radio"], 0.22, 1.3);
    return function (t, dt) {
      var D = dim(), W = D.W, H = D.H;
      c.clearRect(0, 0, W, H);
      loop.update(dt);
      var tw = Math.min(W * 0.74, 210), th = H - 26;
      c.fillStyle = P.e2; c.strokeStyle = P.borderHi; c.lineWidth = 1.2;
      rr(c, 0, 4, tw, th, 8); c.fill(); c.stroke();
      c.fillStyle = P.e0; rr(c, 4, 8, tw - 8, th - 8, 5); c.fill();
      // search field
      c.strokeStyle = P.border; c.fillStyle = P.e1;
      rr(c, 14, 18, tw - 28, 22, 5); c.fill(); c.stroke();
      mono(c, 10.5, P.acc, "left");
      c.fillText(loop.typed, 22, 29.5);
      if ((t * 2 | 0) % 2 === 0) c.fillRect(24 + c.measureText(loop.typed).width, 24, 6, 11);
      mono(c, 9, P.t4, "left"); c.fillText("SEARCH", 22, 52);
      // phone, bottom right
      var px = W - 34, py = H - 58;
      phone(c, px, py, 26, 50);
      if (loop.mode === "type" && loop.flight) {
        c.globalAlpha = 1 - loop.p;
        glowDot(c, px + 13, py + 30, 2.6);
        c.globalAlpha = 1;
      }
      // little arc tv<-phone
      c.strokeStyle = P.border; c.lineWidth = 1;
      c.beginPath(); c.moveTo(px - 4, py + 24); c.quadraticCurveTo(tw + 16, H * 0.4, tw - 2, 30); c.stroke();
    };
  };

  SIG["uc-bios"] = function (c, dim) {
    var rows = ["NVME SSD", "USB DRIVE", "PXE BOOT"];
    var hl = 0, p = 0, dir = 1, chip = 0;
    return function (t, dt) {
      var D = dim(), W = D.W, H = D.H;
      c.clearRect(0, 0, W, H);
      p += dt / 0.9; chip = Math.max(0, chip - dt * 1.6);
      if (p >= 1) { p = 0; hl += dir; if (hl >= rows.length - 1 || hl <= 0) dir *= -1; chip = 1; }
      var bw = Math.min(W * 0.66, 190);
      c.fillStyle = P.e0; c.strokeStyle = P.borderHi; c.lineWidth = 1.2;
      c.setLineDash([4, 4]); rr(c, 0, 4, bw, H - 12, 7); c.fill(); c.stroke(); c.setLineDash([]);
      mono(c, 8.5, P.t4, "left"); c.fillText("BOOT MENU", 12, 18);
      for (var r = 0; r < rows.length; r++) {
        var ry = 33 + r * 17;
        if (r === hl) { c.fillStyle = P.ghost; rr(c, 8, ry - 7.5, bw - 16, 15, 3); c.fill(); }
        mono(c, 9.5, r === hl ? P.acc : P.t3, "left");
        c.fillText(rows[r], 13, ry);
      }
      // the byte that did it
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
      var D = dim(), W = D.W, H = D.H;
      c.clearRect(0, 0, W, H);
      if (playing) prog = (prog + dt * 0.045) % 1;
      var ww = Math.min(W * 0.8, 220), wh = H - 18;
      c.fillStyle = P.e2; c.strokeStyle = P.borderHi; c.lineWidth = 1.2;
      rr(c, 0, 4, ww, wh, 8); c.fill(); c.stroke();
      c.fillStyle = P.e0; rr(c, 4, 16, ww - 8, wh - 20, 5); c.fill();
      c.fillStyle = P.t4;
      c.beginPath(); c.arc(12, 10.5, 2, 0, TAU); c.arc(20, 10.5, 2, 0, TAU); c.fill();
      // play / pause glyph
      var gx = ww / 2, gy = 8 + (wh - 16) / 2;
      c.fillStyle = P.t2;
      if (playing) { c.fillRect(gx - 7, gy - 8, 4.5, 16); c.fillRect(gx + 2.5, gy - 8, 4.5, 16); }
      else { c.beginPath(); c.moveTo(gx - 6, gy - 9); c.lineTo(gx + 9, gy); c.lineTo(gx - 6, gy + 9); c.closePath(); c.fill(); }
      // progress
      c.strokeStyle = P.border; c.lineWidth = 3; c.lineCap = "round";
      c.beginPath(); c.moveTo(14, wh - 8); c.lineTo(ww - 14, wh - 8); c.stroke();
      c.strokeStyle = P.acc;
      c.beginPath(); c.moveTo(14, wh - 8); c.lineTo(14 + (ww - 28) * prog, wh - 8); c.stroke();
      // gliding cursor: eased wander, click toggles play
      var ph = (t % 5) / 5;
      var targX = gx + 1, targY = gy + 2;
      if (ph < 0.55) { cx = lerp(W * 0.86, targX, ez(ph / 0.55)); cy = lerp(H * 0.78, targY, ez(ph / 0.55)); }
      else { cx = targX; cy = targY; }
      if (ph >= 0.56 && ph < 0.585 && t - clickT > 2) { clickT = t; playing = !playing; }
      var rip = t - clickT;
      if (rip < 0.5) {
        c.strokeStyle = P.acc; c.globalAlpha = 1 - rip * 2; c.lineWidth = 1.2;
        c.beginPath(); c.arc(cx, cy, 4 + rip * 26, 0, TAU); c.stroke(); c.globalAlpha = 1;
      }
      c.fillStyle = P.text;
      c.beginPath(); c.moveTo(cx, cy); c.lineTo(cx + 8, cy + 8.5); c.lineTo(cx + 3.4, cy + 8.8); c.lineTo(cx + 1.4, cy + 12.6); c.closePath(); c.fill();
    };
  };

  SIG["uc-present"] = function (c, dim) {
    var n = 12, slide = 0, tapT = -9;
    return function (t, dt) {
      var D = dim(), W = D.W, H = D.H;
      c.clearRect(0, 0, W, H);
      var per = 2.6, ph = (t % per) / per;
      var cur = Math.floor(t / per);
      if (cur !== slide) { slide = cur; tapT = t; }
      var sw = Math.min(W * 0.42, 110), sh = H - 22;
      c.fillStyle = P.e2; c.strokeStyle = P.borderHi; c.lineWidth = 1.2;
      rr(c, 0, 6, sw, sh, 7); c.fill(); c.stroke();
      // slide number with a wipe on advance
      var k = clamp((t - tapT) / 0.4, 0, 1);
      var num = n + slide;
      c.save(); c.beginPath(); rr(c, 0, 6, sw, sh, 7); c.clip();
      c.font = "600 26px " + P.mono; c.textAlign = "center"; c.textBaseline = "middle";
      c.fillStyle = P.text;
      c.fillText(String(num), sw / 2 + (1 - ez(k)) * sw * 0.6, 6 + sh / 2);
      if (k < 1) { c.globalAlpha = 1 - k; c.fillStyle = P.t4; c.fillText(String(num - 1), sw / 2 - ez(k) * sw * 0.6, 6 + sh / 2); c.globalAlpha = 1; }
      c.restore();
      mono(c, 8.5, P.t4, "center"); c.fillText("SLIDE", sw / 2, H - 6);
      // notes beside
      var nx = sw + 18;
      mono(c, 8.5, P.t4, "left"); c.fillText("NOTES", nx, 16);
      for (var i = 0; i < 3; i++) {
        c.strokeStyle = i === 0 ? P.t2 : P.border; c.lineWidth = i === 0 ? 2 : 1.6; c.lineCap = "round";
        c.beginPath(); c.moveTo(nx, 30 + i * 13); c.lineTo(nx + (W - nx - 12) * (i === 0 ? 0.92 : 0.7 - i * 0.12), 30 + i * 13); c.stroke();
      }
      // tap dot
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
    var NODES = ["see", "decide", "act"];
    return function (t) {
      var D = dim(), W = D.W, H = D.H;
      c.clearRect(0, 0, W, H);
      var y = H * 0.42, x0 = 16, x1 = W - 16;
      var xs = NODES.map(function (_, i) { return lerp(x0 + 26, x1 - 26, i / (NODES.length - 1)); });
      // forward line + return arc
      c.strokeStyle = P.border; c.lineWidth = 1.2;
      c.beginPath(); c.moveTo(xs[0], y); c.lineTo(xs[2], y); c.stroke();
      c.setLineDash([3, 4]);
      c.beginPath(); c.moveTo(xs[2], y + 12); c.quadraticCurveTo(W / 2, H + 16, xs[0], y + 12); c.stroke();
      c.setLineDash([]);
      // token: forward along the line, back along the arc
      var per = 3.2, ph = (t % per) / per;
      var qx, qy;
      if (ph < 0.55) { var f = ez(ph / 0.55); qx = lerp(xs[0], xs[2], f); qy = y; }
      else { var g = ez((ph - 0.55) / 0.45); var u = 1 - g;
        qx = u * u * xs[2] + 2 * u * g * (W / 2) + g * g * xs[0];
        qy = u * u * (y + 12) + 2 * u * g * (H + 16) + g * g * (y + 12); }
      // nodes
      for (var i = 0; i < NODES.length; i++) {
        var near = ph < 0.55 && Math.abs(lerp(xs[0], xs[2], ez(ph / 0.55)) - xs[i]) < 14;
        c.fillStyle = near ? P.ghost : P.e2;
        c.strokeStyle = near ? P.acc : P.borderHi; c.lineWidth = 1.2;
        rr(c, xs[i] - 24, y - 12, 48, 24, 7); c.fill(); c.stroke();
        mono(c, 9.5, near ? P.acc : P.t2, "center");
        c.fillText(NODES[i], xs[i], y + 0.5);
      }
      glowDot(c, qx, qy, 2.8);
      mono(c, 8.5, P.t4, "center");
      c.fillText("MCP · a body on a real machine", W / 2, 12);
    };
  };

  SIG["uc-fleet"] = function (c, dim) {
    return function (t) {
      var D = dim(), W = D.W, H = D.H;
      c.clearRect(0, 0, W, H);
      var cols = 4, rows = 2, gw = 10, gh = 10;
      var bw = Math.min((W * 0.7 - gw * (cols - 1)) / cols, 44), bh = (H - 26 - gh) / rows;
      var per = 4.2, lit = Math.floor(((t % per) / per) * (cols * rows + 2));
      var x0 = 2, y0 = 8;
      var on = 0;
      for (var r = 0; r < rows; r++) for (var q = 0; q < cols; q++) {
        var i = r * cols + q;
        var x = x0 + q * (bw + gw), y = y0 + r * (bh + gh);
        var isOn = i < lit;
        if (isOn) on++;
        c.fillStyle = isOn ? P.ghost : P.e2;
        c.strokeStyle = isOn ? P.line : P.border; c.lineWidth = 1.1;
        rr(c, x, y, bw, bh, 5); c.fill(); c.stroke();
        if (isOn) {
          c.strokeStyle = P.acc; c.lineWidth = 1.6; c.lineCap = "round";
          c.beginPath(); c.moveTo(x + bw / 2 - 5, y + bh / 2); c.lineTo(x + bw / 2 - 1, y + bh / 2 + 4); c.lineTo(x + bw / 2 + 6, y + bh / 2 - 4); c.stroke();
        } else {
          c.fillStyle = P.t4; c.beginPath(); c.arc(x + bw / 2, y + bh / 2, 1.6, 0, TAU); c.fill();
        }
      }
      var rx = x0 + cols * (bw + gw) + 6;
      mono(c, 9.5, P.t3, "left");
      c.fillText(Math.min(on, cols * rows) + "/" + (cols * rows), rx, H * 0.38);
      mono(c, 8.5, P.t4, "left");
      c.fillText("reachable", rx, H * 0.38 + 14);
      mono(c, 8.5, P.t4, "left");
      c.fillText("one directory", x0, H - 4);
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
