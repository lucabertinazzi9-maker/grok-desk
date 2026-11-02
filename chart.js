/* Hand-drawn canvas charts (no library). Every canvas is devicePixelRatio aware. */
(function (W) {
  "use strict";
  var GREEN = "#00d35a", RED = "#ff453a", ORANGE = "#ff9f0a", BLUE = "#0a84ff",
      SEC = "rgba(235,235,245,0.6)", TER = "rgba(235,235,245,0.3)", SEP = "rgba(84,84,88,0.55)";
  var reduce = W.matchMedia && W.matchMedia("(prefers-reduced-motion: reduce)").matches;

  function setup(cv) {
    var dpr = W.devicePixelRatio || 1, r = cv.getBoundingClientRect();
    var w = Math.max(1, Math.round(r.width)), h = Math.max(1, Math.round(r.height));
    if (cv.width !== w * dpr || cv.height !== h * dpr) { cv.width = w * dpr; cv.height = h * dpr; }
    var g = cv.getContext("2d"); g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, w, h);
    return { g: g, w: w, h: h };
  }
  function ease(t) { return 1 - Math.pow(1 - t, 3); }
  function fmtUsd(v) { return "$" + v.toFixed(2); }

  /* ---------- Home line chart ---------- */
  function LineChart(cv, wrap) {
    this.cv = cv; this.wrap = wrap; this.pts = []; this.marks = []; this.start = null;
    this.anim = 1; this.markAlpha = 1; this._raf = 0; this._lastN = 0; this._lastMarks = 0;
  }
  LineChart.prototype.set = function (pts, marks, start) {
    var grew = this.pts.length && pts.length > this._lastN && !reduce;
    var newMarks = marks.length > this._lastMarks && !reduce;
    this.pts = pts; this.marks = marks || []; this.start = start;
    this._lastN = pts.length; this._lastMarks = this.marks.length;
    var self = this, t0 = performance.now();
    if (grew || newMarks) {
      cancelAnimationFrame(this._raf);
      var step = function (now) {
        var a = Math.min(1, (now - t0) / 250), m = Math.min(1, (now - t0) / 200);
        self.anim = grew ? ease(a) : 1; self.markAlpha = newMarks ? m : 1; self.draw();
        if (a < 1 || m < 1) self._raf = requestAnimationFrame(step);
      };
      this.anim = grew ? 0 : 1; this.markAlpha = newMarks ? 0 : 1;
      this._raf = requestAnimationFrame(step);
    } else { this.anim = 1; this.markAlpha = 1; this.draw(); }
  };
  LineChart.prototype.draw = function () {
    var s = setup(this.cv), g = s.g, w = s.w, h = s.h, pts = this.pts;
    var top = 46, bot = h - 8;
    if (this.start == null && !pts.length) return;
    var vals = pts.map(function (p) { return p[1]; });
    if (this.start != null) vals.push(this.start);
    var lo = Math.min.apply(null, vals), hi = Math.max.apply(null, vals);
    if (hi - lo < 0.5) { hi += 0.25; lo -= 0.25; }
    var pad = (hi - lo) * 0.1; lo -= pad; hi += pad;
    var t0 = pts.length ? pts[0][0] : 0, t1 = pts.length ? pts[pts.length - 1][0] : 1;
    if (t1 === t0) t1 = t0 + 1;
    function X(t) { return (t - t0) / (t1 - t0) * (w - 4) + 2; }
    function Y(v) { return bot - (v - lo) / (hi - lo) * (bot - top); }
    // dashed start line
    if (this.start != null) {
      g.save(); g.strokeStyle = TER; g.setLineDash([3, 4]); g.lineWidth = 1;
      g.beginPath(); g.moveTo(0, Y(this.start)); g.lineTo(w, Y(this.start)); g.stroke(); g.restore();
    }
    if (pts.length < 2) return;
    // the newest point slides in: interpolate the last segment
    var n = pts.length, lastX = X(pts[n - 1][0]), lastY = Y(pts[n - 1][1]);
    if (this.anim < 1) {
      var px = X(pts[n - 2][0]), py = Y(pts[n - 2][1]);
      lastX = px + (lastX - px) * this.anim; lastY = py + (lastY - py) * this.anim;
    }
    g.beginPath();
    for (var i = 0; i < n - 1; i++) { var x = X(pts[i][0]), y = Y(pts[i][1]); i ? g.lineTo(x, y) : g.moveTo(x, y); }
    g.lineTo(lastX, lastY);
    g.save(); g.lineWidth = 2; g.strokeStyle = GREEN; g.lineJoin = "round"; g.stroke(); g.restore();
    // gradient fill under the line (the chart itself, not a card)
    g.lineTo(lastX, bot); g.lineTo(X(pts[0][0]), bot); g.closePath();
    var gr = g.createLinearGradient(0, top, 0, bot); gr.addColorStop(0, "rgba(0,211,90,0.28)"); gr.addColorStop(1, "rgba(0,211,90,0)");
    g.fillStyle = gr; g.fill();
    // dot on the last point
    g.fillStyle = GREEN; g.beginPath(); g.arc(lastX, lastY, 3.5, 0, 6.283); g.fill();
    // marks above the line; a later mark moves up a row when it would overlap
    g.font = "600 12px -apple-system, 'SF Pro Text', system-ui, sans-serif"; g.textBaseline = "middle";
    var rows = [], ROWH = 21, self = this;
    this.marks.forEach(function (m) {
      if (m.t < t0 || m.t > t1 + 60000) return;
      var x = Math.max(2, Math.min(w - 2, X(Math.min(m.t, t1)))), tw = g.measureText(m.label).width + 16;
      var vAt = valueAt(pts, m.t), baseY = Y(vAt) - 14;
      var bx = Math.max(0, Math.min(w - tw, x - tw / 2)), y = Math.max(10, Math.min(baseY, top - 4));
      // move up a row while the pill would touch one already drawn
      function hits(yy) { return rows.some(function (r) { return bx < r[1] + 4 && bx + tw > r[0] - 4 && Math.abs(yy - r[2]) < ROWH; }); }
      while (hits(y) && y - ROWH >= 10) y -= ROWH;
      if (hits(y)) { y = Math.max(10, Math.min(baseY, top - 4)); while (hits(y) && y + ROWH < h - 10) y += ROWH; }
      rows.push([bx, bx + tw, y]);
      var col = m.kind === "buy" ? BLUE : (m.kind === "win" ? GREEN : RED);
      g.globalAlpha = self.markAlpha;
      g.strokeStyle = col; g.lineWidth = 1; g.beginPath(); g.moveTo(x, y + 9); g.lineTo(x, Y(vAt)); g.stroke();
      g.fillStyle = col; roundRect(g, bx, y - 9, tw, 18, 9); g.fill();
      g.fillStyle = "#fff"; g.fillText(m.label, bx + 8, y + 0.5);
      g.globalAlpha = 1;
    });
  };
  function valueAt(pts, t) {
    for (var i = pts.length - 1; i >= 0; i--) if (pts[i][0] <= t) return pts[i][1];
    return pts[0][1];
  }
  function roundRect(g, x, y, w, h, r) {
    g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r);
    g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath();
  }

  /* ---------- Coin candles + volume + Risk trailing stop ---------- */
  function candles(cv, data, exitLine, entry) {
    var s = setup(cv), g = s.g, w = s.w, h = s.h;
    if (!data || !data.length) return false;
    var c = data.slice(-90), volH = Math.round(h * 0.2), top = 8, bot = h - volH - 10;
    var lo = Infinity, hi = -Infinity, vmax = 0;
    c.forEach(function (k) { lo = Math.min(lo, k[3]); hi = Math.max(hi, k[2]); vmax = Math.max(vmax, k[5] || 0); });
    if (exitLine) { lo = Math.min(lo, exitLine); hi = Math.max(hi, exitLine); }
    if (entry) { lo = Math.min(lo, entry); hi = Math.max(hi, entry); }
    if (hi === lo) { hi *= 1.01; lo *= 0.99; }
    var pad = (hi - lo) * 0.08; lo -= pad; hi += pad;
    var bw = (w - 60) / c.length, cw = Math.max(1, bw * 0.62);
    function Y(v) { return bot - (v - lo) / (hi - lo) * (bot - top); }
    g.strokeStyle = SEP; g.lineWidth = 1;
    for (var i = 0; i <= 3; i++) { var gy = top + (bot - top) * i / 3; g.beginPath(); g.moveTo(0, gy); g.lineTo(w - 60, gy); g.stroke(); }
    c.forEach(function (k, i) {
      var x = i * bw + bw / 2, up = k[4] >= k[1], col = up ? GREEN : RED;
      g.strokeStyle = col; g.fillStyle = col;
      g.beginPath(); g.moveTo(x, Y(k[2])); g.lineTo(x, Y(k[3])); g.stroke();
      var y1 = Y(Math.max(k[1], k[4])), y2 = Y(Math.min(k[1], k[4]));
      g.fillRect(x - cw / 2, y1, cw, Math.max(1, y2 - y1));
      if (vmax > 0 && k[5] > 0) { var vh = k[5] / vmax * volH; g.globalAlpha = 0.35; g.fillRect(x - cw / 2, h - vh, cw, vh); g.globalAlpha = 1; }
    });
    g.font = "11px ui-monospace, 'SF Mono', Menlo, monospace"; g.textBaseline = "middle"; g.fillStyle = TER;
    g.fillText(sig(hi - pad), w - 56, top + 6); g.fillText(sig(lo + pad), w - 56, bot - 6);
    if (entry) {
      g.save(); g.strokeStyle = TER; g.setLineDash([2, 3]); g.beginPath(); g.moveTo(0, Y(entry)); g.lineTo(w - 60, Y(entry)); g.stroke(); g.restore();
    }
    if (exitLine) {
      var ey = Y(exitLine);
      g.save(); g.strokeStyle = ORANGE; g.lineWidth = 1.5; g.setLineDash([6, 4]);
      g.beginPath(); g.moveTo(0, ey); g.lineTo(w - 60, ey); g.stroke(); g.restore();
      g.fillStyle = ORANGE; g.font = "600 11px -apple-system, system-ui, sans-serif";
      g.fillText("Risk trailing stop", 6, ey - 9);
    }
    return true;
  }
  // 0.0000164 -> 0.0₄164 so small prices fit the axis
  function sig(v) {
    if (v >= 1) return v.toFixed(4);
    if (v >= 0.001 || v <= 0) return v.toPrecision(3);
    // the subscript is the count of zeros after "0.", as on DexScreener
    var z = Math.floor(-Math.log10(v)), d = Math.round(v * Math.pow(10, z + 3));
    if (d >= 1000) { z -= 1; d = Math.round(d / 10); }
    return "0.0" + String(z).split("").map(function (c) { return "₀₁₂₃₄₅₆₇₈₉"[c]; }).join("") + d;
  }

  /* ---------- Analyst score ring 0-100, green from min ---------- */
  function ring(cv, score, min) {
    var s = setup(cv), g = s.g, w = s.w, h = s.h, r = Math.min(w, h) / 2 - 7, cx = w / 2, cy = h / 2;
    g.lineWidth = 9; g.lineCap = "round";
    g.strokeStyle = "#2c2c2e"; g.beginPath(); g.arc(cx, cy, r, 0, 6.283); g.stroke();
    if (score != null) {
      g.strokeStyle = score >= (min || 70) ? GREEN : "#ffd60a";
      g.beginPath(); g.arc(cx, cy, r, -Math.PI / 2, -Math.PI / 2 + 6.283 * Math.max(0.005, score / 100)); g.stroke();
    }
    g.fillStyle = "#fff"; g.textAlign = "center"; g.textBaseline = "middle";
    g.font = "600 " + Math.round(r * 0.72) + "px -apple-system, 'SF Pro Display', system-ui, sans-serif";
    g.fillText(score == null ? "–" : String(score), cx, cy + 1);
  }

  W.Charts = { LineChart: LineChart, candles: candles, ring: ring, fmtUsd: fmtUsd };
})(window);
