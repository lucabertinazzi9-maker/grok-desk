/* Grok Bot desk · iPhone web app (Plan B: reads the desk's JSON files from a secret gist).
   No framework, no build step. Every FOMO link comes from a "link" field the desk built with links.py;
   this file never builds one. The data id (#d=) and the app token (#t=) arrive only in the URL fragment,
   are kept in localStorage and never shown, logged or sent anywhere but the gist host. */
(function () {
  "use strict";
  var OWNER = "lucabertinazzi9-maker", POLL_MS = 15000, API_EVERY_MS = 75000, STALE_S = 180;
  var AGENTS = ["scanner", "auditor", "analyst", "executor", "risk"];
  var NAMES = { scanner: "Scanner", auditor: "Auditor", analyst: "Analyst", executor: "Executor", risk: "Risk" };
  var COLORS = { scanner: "#64d2ff", auditor: "#ffffff", analyst: "#ffd60a", executor: "#00d35a", risk: "#ff6b9a" };
  var reduce = window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches;
  var $ = function (s, r) { return (r || document).querySelector(s); };

  /* ---------- fragment: #d= data id, #t= app token ---------- */
  (function () {
    var h = location.hash, d = h.match(/[#&]d=([0-9a-zA-Z]+)/), t = h.match(/[#&]t=([^&]+)/);
    if (d) localStorage.setItem("desk.data", d[1]);
    // iOS gives a home-screen app its own storage and installs it with the URL on screen, so the fragment
    // stays in Safari until the app runs standalone; there it is moved to storage and dropped from the URL.
    var standalone = navigator.standalone || (window.matchMedia && matchMedia("(display-mode: standalone)").matches);
    if (t) localStorage.setItem("desk.token", decodeURIComponent(t[1]));
    if ((d || t) && standalone) history.replaceState(null, "", location.pathname + location.search);
  })();
  var DATA_ID = localStorage.getItem("desk.data");
  // Local preview only (screenshots / development): ?src=/folder/ is honoured on localhost and nowhere else.
  var LOCAL_SRC = null;
  if (/^(localhost|127\.0\.0\.1)$/.test(location.hostname)) {
    var m = location.search.match(/[?&]src=([^&]+)/); if (m) LOCAL_SRC = decodeURIComponent(m[1]);
  }
  var PREVIEW = LOCAL_SRC ? (location.search.match(/[?&]screen=(\w+)(?:&mint=(\w+))?/) || null) : null;
  function rawUrl(f) {
    if (LOCAL_SRC) return LOCAL_SRC + f + "?t=" + Date.now();
    return "https://gist.githubusercontent.com/" + OWNER + "/" + DATA_ID + "/raw/" + f + "?t=" + Date.now();
  }
  function getJson(f) {
    return fetch(rawUrl(f), { cache: "no-store", referrerPolicy: "no-referrer" }).then(function (r) {
      if (!r.ok) { var e = new Error("HTTP " + r.status); e.status = r.status; throw e; }
      return r.json();
    });
  }

  /* ---------- store ---------- */
  var D = { state: null, activity: null, chart: null, agents: null, account: null, coins: null, coin: {} };
  var lastOk = 0, lastFail = 0, nextPoll = 0, lastApi = 0, everLoaded = false, missing = {};
  function newer(a, b) { return !b || !a || !a.ts || !b.ts || Date.parse(a.ts) >= Date.parse(b.ts); }

  function poll() {
    nextPoll = Date.now() + POLL_MS;
    if (!DATA_ID && !LOCAL_SRC) { render(); return; }
    var jobs = [
      getJson("state.json").then(function (j) { if (newer(j, D.state)) D.state = j; lastOk = Date.now(); everLoaded = true; }),
      soft("activity.json", function (j) { D.activity = j; }),
      soft("chart.json", function (j) { D.chart = j; }),
      soft("agents.json", function (j) { D.agents = j; }),
      soft("coins.json", function (j) { D.coins = j; }),
      soft("account.json", function (j) { D.account = j; })
    ];
    if (cur().name === "coin" || cur().name === "auditor") jobs.push(loadCoin(cur().mint));
    Promise.all(jobs.map(function (p) { return p.catch(function (e) { return e; }); })).then(function (res) {
      if (res[0] instanceof Error) lastFail = Date.now();
      if (!LOCAL_SRC && Date.now() - lastApi >= API_EVERY_MS) viaApi();
      update();
    });
  }
  function soft(f, set) {   // a file the running desk may not write yet: missing = empty, not offline
    return getJson(f).then(function (j) { delete missing[f]; set(j); }, function (e) { if (e.status === 404) missing[f] = 1; });
  }
  function viaApi() {       // the gist API is fresher than raw but allows 60 calls/h per phone
    lastApi = Date.now();
    fetch("https://api.github.com/gists/" + DATA_ID, { cache: "no-store" }).then(function (r) { return r.ok ? r.json() : null; })
      .then(function (g) {
        if (!g || !g.files) return;
        var f = g.files["state.json"]; if (!f || f.truncated) return;
        var s = JSON.parse(f.content); if (!newer(s, D.state)) return;
        D.state = s; lastOk = Date.now(); everLoaded = true;
        [["activity.json", "activity"], ["chart.json", "chart"], ["agents.json", "agents"], ["coins.json", "coins"], ["account.json", "account"]]
          .forEach(function (p) { var x = g.files[p[0]]; if (x && !x.truncated) try { D[p[1]] = JSON.parse(x.content); } catch (e) {} });
        update();
      }).catch(function () {});
  }
  function loadCoin(mint) {
    return getJson("coin_" + mint + ".json").then(function (j) { D.coin[mint] = j; },
      function (e) { if (e.status === 404 && !D.coin[mint]) D.coin[mint] = { missing: true }; throw e; });
  }

  /* ---------- formatting (escape everything that came from the chain) ---------- */
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  function safeLink(u) { return typeof u === "string" && /^https:\/\//.test(u) ? esc(u) : null; }
  function usd(v) { if (v == null || isNaN(v)) return "–"; var a = Math.abs(v); return (v < 0 ? "-" : "") + "$" + a.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
  function usdShort(v) { if (v == null) return "n/a"; var a = Math.abs(v); return "$" + (a >= 1e9 ? (a / 1e9).toFixed(2) + "B" : a >= 1e6 ? (a / 1e6).toFixed(2) + "M" : a >= 1e3 ? (a / 1e3).toFixed(1) + "K" : a.toFixed(0)); }
  function pct(v) { if (v == null) return "–"; return (v >= 0 ? "+" : "") + v.toFixed(2) + "%"; }
  function price(v) { if (v == null) return "–"; if (v >= 1) return "$" + v.toFixed(4); var s = v.toPrecision(4); if (s.indexOf("e") > -1) s = v.toFixed(12).replace(/0+$/, ""); return "$" + s; }
  function hm(ts) { if (!ts) return ""; var d = new Date(ts); return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false }); }
  function hms(ms) { return new Date(ms).toLocaleTimeString([], { hour12: false }); }
  function ageS(ts) { return ts ? (Date.now() - Date.parse(ts)) / 1000 : Infinity; }
  function initials(s) { return esc((s || "G").replace(/^@/, "").charAt(0).toUpperCase()); }
  function sk(h, w, mt) { return '<div class="sk" style="height:' + h + "px;" + (w ? "width:" + w + ";" : "") + "margin-top:" + (mt || 0) + 'px"></div>'; }
  function toast(t) { var e = $("#toast"); e.textContent = t; e.hidden = false; clearTimeout(e._t); e._t = setTimeout(function () { e.hidden = true; }, 1800); }

  /* ---------- odometer: each changed digit rolls 600ms ease-out, 30ms stagger right to left ---------- */
  function Odometer() { this.el = document.createElement("span"); this.el.className = "odo big"; this.val = null; }
  Odometer.prototype.set = function (text) {
    if (text === this.val) return;
    var el = this.el, old = this.val; this.val = text;
    if (old == null || old.length !== text.length || reduce) {
      el.innerHTML = text.split("").map(function (ch) {
        if (!/\d/.test(ch)) return '<span class="c">' + esc(ch) + "</span>";
        return '<span class="d"><span class="strip" style="transform:translateY(-' + ch + 'em)">' + "0123456789".split("").map(function (n) { return "<span>" + n + "</span>"; }).join("") + "</span></span>";
      }).join("");
      return;
    }
    var nodes = el.children, n = text.length;
    for (var i = 0; i < n; i++) {
      var ch = text[i], node = nodes[i];
      if (/\d/.test(ch) && node.classList.contains("d")) {
        var strip = node.firstChild;
        if (old[i] !== ch) { strip.style.transitionDelay = ((n - 1 - i) * 30) + "ms"; strip.style.transform = "translateY(-" + ch + "em)"; }
      } else if (node.textContent !== ch) { this.val = null; return this.set(text); }
    }
  };
  var odo = new Odometer(), line = null;

  /* ---------- navigation ---------- */
  var stack = [{ name: "home" }], tab = "home", rangeSel = localStorage.getItem("desk.range") || "LIVE", actPage = 1, beamDone = {};
  function cur() { return stack[stack.length - 1]; }
  function go(s) { stack.push(s); history.pushState({ d: stack.length }, ""); mount(); window.scrollTo(0, 0); if (s.mint) loadCoin(s.mint).then(update, update); }
  function back() { if (stack.length > 1) { history.back(); } }
  window.addEventListener("popstate", function () { if (stack.length > 1) { stack.pop(); mount(); } });
  function setTab(t) {
    tab = t; stack = [{ name: t }];
    document.querySelectorAll(".tabs button").forEach(function (b) { b.classList.toggle("on", b.dataset.tab === t); });
    if (t === "activity") localStorage.setItem("desk.seen", String(maxActId()));
    mount(); window.scrollTo(0, 0);
  }
  document.querySelectorAll(".tabs button").forEach(function (b) { b.addEventListener("click", function () { setTab(b.dataset.tab); }); });
  document.addEventListener("click", function (e) {
    var a = e.target.closest("[data-go]");
    if (a) { e.preventDefault(); var g = a.dataset.go;
      if (g === "back") return back();
      if (g === "account" || g === "agents" || g === "activity") return setTab(g);
      if (g === "search") return openSearch();
      if (g === "coin" || g === "auditor") return go({ name: g, mint: a.dataset.mint });
      if (g === "range") { rangeSel = a.dataset.r; localStorage.setItem("desk.range", rangeSel); return update(); }
      if (g === "more") { actPage++; return update(); }
      if (g === "invite") return invite(a.dataset.url);
      if (g === "settings") { setTab("account"); setTimeout(function () { var x = document.getElementById("set-" + a.dataset.agent); if (x) x.scrollIntoView(); }, 30); return; }
      if (g === "locked") return toast(a.dataset.msg);
    }
  });
  function maxActId() { return (D.activity || []).reduce(function (m, r) { return Math.max(m, r.id || 0); }, 0); }
  function invite(url) {
    if (!url) return;
    if (navigator.share) navigator.share({ title: "FOMO", text: "New to FOMO?", url: url }).catch(function () {});
    else if (navigator.clipboard) navigator.clipboard.writeText(url).then(function () { toast("Link copied"); });
  }

  /* ---------- offline banner (keeps the last good numbers on screen) ---------- */
  function offline() {
    if (!DATA_ID && !LOCAL_SRC) return false;
    var stale = D.state && !PREVIEW ? ageS(D.state.ts) > STALE_S : false;
    return (lastFail > lastOk) || stale;
  }
  function banner() {
    var b = $("#banner"), off = offline() && (everLoaded || lastFail);
    b.hidden = !off; if (!off) return;
    var n = Math.max(0, Math.ceil((nextPoll - Date.now()) / 1000)), last = D.state && D.state.ts ? hms(Date.parse(D.state.ts)) : "never";
    b.textContent = "Desk offline · retrying in " + n + "s · last update " + last;
  }
  setInterval(banner, 1000);

  /* ---------- screens ---------- */
  var V = $("#view");
  function mount() {
    var s = cur(); V.dataset.screen = s.name;
    V.innerHTML = (SCREENS[s.name].layout || function () { return ""; })(s);
    update();
  }
  function update() { var s = cur(); try { SCREENS[s.name].update(s); } catch (e) { console.error(e); } banner(); }

  function noData() {
    return '<div class="card" style="margin-top:40px"><b>No data link yet</b><p class="muted">Open the app once with the private link from Grok Bot (it ends in #d=…). It is kept on this phone.</p></div>';
  }
  function agentsRunning(st) {
    if (!st || !st.agents) return 0;
    var ref = Date.parse(st.ts) || Date.now();
    return st.agents.filter(function (a) { return !a.paused && a.heartbeat && (ref - Date.parse(a.heartbeat)) < 120000; }).length;
  }

  /* agent card bodies (content per agent prompt) */
  function cardInner(a, st) {
    var paused = a.paused, hb = a.heartbeat && ((Date.parse(st.ts) || Date.now()) - Date.parse(a.heartbeat)) < 120000;
    var head = '<div class="head"><span class="sd' + (paused || !hb ? " off" : "") + '"></span><span class="who" style="color:' + COLORS[a.agent] + '">' + NAMES[a.agent] + "</span><span class=\"faint\">" + (paused ? "Paused" : hb ? "Running" : "No heartbeat") + "</span></div>";
    var b = "";
    if (a.agent === "scanner") {
      var feed = (a.feed || []).slice(0, 4);
      b = '<div class="big2">' + esc(a.title || "0 pools") + '</div><div class="line">' + (a.waiting != null ? a.waiting + " waiting" : "watching graduations") + "</div>" +
        '<div class="body"><div class="feed">' + (feed.length ? feed.map(function (f) {
          return f.verdict === "kill" ? '<div><span class="k">' + esc(f.name) + '</span><span class="r">' + esc(f.reason) + "</span></div>"
            : "<div><span>" + esc(f.name) + '</span><span class="up">→ auditor</span></div>';
        }).join("") : '<div class="muted">Listening for graduations</div>') + "</div></div>";
    } else if (a.agent === "auditor") {
      var L = a.last, strips = L && L.strips ? L.strips : [];
      var passed = strips.length === 8 && strips.every(function (x) { return x === true; });
      var failAt = strips.indexOf(false);
      b = '<div class="big2">' + esc(a.title || "0 taken apart") + '</div><div class="line">' + (L ? esc(L.name) : "No coin taken apart yet") + "</div>" +
        '<div class="body"><div class="strips">' + [0, 1, 2, 3, 4, 5, 6, 7].map(function (i) { var v = strips[i]; return '<i class="' + (v === true ? "ok" : v === false ? "no" : "") + '"></i>'; }).join("") + "</div>" +
        '<div class="line">' + (L ? (passed ? '<span class="up">8/8 → Executor</span>' : failAt > -1 ? '<span class="down">' + esc(L.reason || ("layer " + (failAt + 1))) + "</span>" : "taking apart...") : "") +
        ' · ' + (a.rejected || 0) + " rejected</div></div>";
    } else if (a.agent === "analyst") {
      var last = a.last;
      b = '<div class="big2">Scoring</div><div class="line">' + (last ? esc(last.name) + " · " + (last.pass ? '<span class="up">passed</span>' : '<span class="down">' + esc(last.reason || "rejected") + "</span>") : "No coin scored yet") + "</div>" +
        '<div class="body"><div class="ringbox"><canvas class="ring" data-score="' + (a.last_score == null ? "" : a.last_score) + '" data-min="' + (a.minScore || 70) + '"></canvas><div class="line">' + (a.count || 0) + " scored tonight<br>green from " + (a.minScore || 70) + "</div></div></div>";
    } else if (a.agent === "executor") {
      var e = a.last;
      b = '<div class="big2">' + esc(a.title || "0 trades") + '</div><div class="line">' + (e ? usd(e.size) + " · " + (e.pct != null ? e.pct : a.stack_pct) + "% of stack" : "$0 · " + (a.stack_pct || 0) + "% of stack") + "</div>" +
        '<div class="body">' + (e ? '<div class="line">' + esc(e.name) + '</div><div class="bar"><i style="width:100%"></i></div><div class="up">✓ Filled</div>' : '<div class="muted">No trade yet tonight</div>') + "</div>";
    } else if (a.agent === "risk") {
      var r = a.last;
      b = '<div class="big2">' + (a.open ? "Guarding" : "Idle") + '</div><div class="line">' + (a.open ? a.open + " open" : "nothing open") +
        (r ? " · last: " + (r.reason === "trail" ? "Trailed out" : r.reason === "stop" ? "Stopped" : r.reason === "timeout" ? "Timed out" : esc(r.reason)) + " " + esc(r.name) : "") + "</div>" +
        '<div class="body"><div class="pills"><span class="pill mono red">stop -' + (a.stop_pct != null ? a.stop_pct : "–") + '%</span><span class="pill mono green">trail ' + (a.trail_pct != null ? a.trail_pct : "–") + "%</span></div></div>";
    }
    return head + b;
  }
  function drawRings() {
    document.querySelectorAll("canvas.ring").forEach(function (c) { var s = c.dataset.score; Charts.ring(c, s === "" ? null : +s, +c.dataset.min); });
  }
  // "$47.50 · 23.8% of stack" -> amount on top, the rest small below it, so titles keep their room
  function valLines(v) {
    var p = String(v == null ? "" : v).split(" · ");
    return esc(p[0]) + (p.length > 1 ? '<small class="v2">' + esc(p.slice(1).join(" · ")) + "</small>" : "");
  }
  function actRow(r) {
    var trade = r.kind !== "rejected", ic = { bought: "B", sold: "+", stopped: "−", rejected: "×" }[r.kind] || "•";
    var cls = r.kind === "sold" ? "up" : (r.kind === "stopped" ? "down" : (r.kind === "rejected" ? "muted" : ""));
    return '<button class="row" data-go="' + (trade ? "coin" : "auditor") + '" data-mint="' + esc(r.mint) + '"><span class="ic ' + esc(r.kind) + '">' + ic + '</span><span class="main"><div class="t1">' + esc(r.title) +
      '</div><div class="t2">' + esc(r.subtitle) + " · " + hm(r.ts) + '</div></span><span class="v ' + cls + '">' + valLines(r.value) + "</span></button>";
  }
  function chartPoints(ch, range) {
    var pts = (ch.points || []).slice(), all = (ch.history || []).concat(pts).sort(function (a, b) { return a[0] - b[0]; });
    var now = pts.length ? pts[pts.length - 1][0] : Date.now(), H = 3600000;
    if (range === "LIVE") return pts;
    var span = { "1H": H, "4H": 4 * H, "1D": 24 * H, "1W": 168 * H }[range];
    var src = (range === "1H" || range === "4H") ? (pts.length && pts[0][0] <= now - span ? pts : all) : all;
    return span ? src.filter(function (p) { return p[0] >= now - span; }) : all;
  }

  var SCREENS = {};
  SCREENS.home = {
    layout: function () {
      return '<div class="nav"><button class="iconbtn" data-go="account" aria-label="Account"><span class="avatar" id="av">G</span></button>' +
        '<button class="title" data-go="agents">Grok Bot <span class="chev">›</span></button>' +
        '<button class="iconbtn" data-go="search" aria-label="Search"><svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="6.5"/><path d="m16 16 4.5 4.5"/></svg></button>' +
        '<button class="iconbtn" data-go="activity" aria-label="Notifications"><svg viewBox="0 0 24 24"><path d="M6 16V11a6 6 0 1 1 12 0v5l1.5 2h-15zM10 20.5a2 2 0 0 0 4 0"/></svg><span class="dot" id="bell" hidden></span></button></div>' +
        '<div id="hb"></div><div class="chart"><canvas id="lc"></canvas><div class="empty" id="lce" hidden>Waiting for the first trade</div></div>' +
        '<div class="ranges">' + ["LIVE", "1H", "4H", "1D", "1W", "ALL"].map(function (r) { return '<button data-go="range" data-r="' + r + '">' + r + "</button>"; }).join("") + "</div>" +
        '<h2 class="sec"><span>Agents<span class="sub" id="running"></span></span></h2><div class="carousel" id="car">' +
        AGENTS.map(function (a) { return '<div class="acard" id="card-' + a + '">' + sk(30, "50%") + sk(40, "70%", 14) + "</div>"; }).join("") + "</div>" +
        '<h2 class="sec"><span>Activity</span><button data-go="activity">See all</button></h2><div class="list" id="act5">' + sk(60) + sk(60, 0, 1) + sk(60, 0, 1) + "</div>";
    },
    update: function () {
      var st = D.state;
      if (!DATA_ID && !LOCAL_SRC) { $("#hb").innerHTML = noData(); return; }
      var acc = D.account;
      if (acc && acc.fomoHandle) $("#av").innerHTML = initials(acc.fomoHandle);
      $("#bell").hidden = !(maxActId() > +(localStorage.getItem("desk.seen") || 0));
      document.querySelectorAll(".ranges button").forEach(function (b) { b.classList.toggle("on", b.dataset.r === rangeSel); });
      var hb = $("#hb");
      if (!st) { hb.innerHTML = sk(66, "70%") + sk(22, "40%", 10); return; }
      if (!hb.querySelector(".odo")) {
        hb.innerHTML = '<div class="bal" id="balrow"></div><div class="today" id="today"></div>';
        $("#balrow").appendChild(odo.el); odo.val = null;
        $("#balrow").insertAdjacentHTML("beforeend", '<span class="pill paper" id="paper">PAPER</span>');
      }
      odo.set(usd(st.balance));
      $("#paper").hidden = st.mode !== "PAPER";
      var tp = st.todayPct;
      $("#today").innerHTML = '<span class="' + (tp >= 0 ? "up" : "down") + '">' + pct(tp) + ' today</span>' + (st.multiplier != null ? '<span class="pill mult">' + st.multiplier.toFixed(2) + "×</span>" : "");
      // chart
      var ch = D.chart || {}, cv = $("#lc");
      if (!line || line.cv !== cv) line = new Charts.LineChart(cv);
      var pts = chartPoints(ch, rangeSel), lo = pts.length ? pts[0][0] : 0;
      line.set(pts, (ch.marks || []).filter(function (m) { return m.t >= lo; }), st.nightStart);
      $("#lce").hidden = !!((ch.marks || []).length);
      // cards
      $("#running").textContent = " · " + agentsRunning(st) + " running";
      (st.agents || []).forEach(function (a) { var el = document.getElementById("card-" + a.agent); if (el) el.innerHTML = cardInner(a, st); });
      drawRings();
      // activity
      var rows = (D.activity || []).slice(0, 5);
      $("#act5").innerHTML = D.activity == null && !missing["activity.json"] ? sk(60) : rows.length ? rows.map(actRow).join("") : '<div class="empty-row">Nothing yet tonight</div>';
    }
  };
  window.addEventListener("resize", function () { if (line && cur().name === "home") line.draw(); });

  SCREENS.agents = {
    layout: function () { return '<h1 class="large">Agents</h1><div id="ag">' + AGENTS.map(function () { return sk(150, 0, 12); }).join("") + "</div>"; },
    update: function () {
      var st = D.state, dec = D.agents || {};
      if (!st) return;
      var open = st.positions ? st.positions.length : 0;
      $("#ag").innerHTML = (st.agents || []).map(function (a) {
        var hb = a.heartbeat && ((Date.parse(st.ts) || Date.now()) - Date.parse(a.heartbeat)) < 120000;
        var lockMsg = a.agent === "risk" && open ? "Risk can't be paused while a position is open" : "Pause from Telegram: send \"" + (a.paused ? "resume " : "pause ") + a.agent + "\"";
        var d = (dec[a.agent] && dec[a.agent].decisions) || [];
        return '<div class="agent"><div class="top"><span class="sd" style="width:10px;height:10px;border-radius:5px;background:' + (a.paused || !hb ? "rgba(235,235,245,.3)" : "#00d35a") + '"></span>' +
          '<span class="nm" style="color:' + COLORS[a.agent] + '">' + NAMES[a.agent] + '</span><span class="cnt">' + ((dec[a.agent] && dec[a.agent].today) != null ? dec[a.agent].today : (a.count || 0)) + " today</span>" +
          '<button class="tapwrap" data-go="locked" data-msg="' + esc(lockMsg) + '" aria-label="pause"><span class="switch ' + (a.paused ? "" : "on") + (a.agent === "risk" && open ? " locked" : "") + '"></span></button></div>' +
          '<div class="muted" style="margin:2px 0 8px">' + (a.paused ? "Paused" : hb ? "Running" : "No heartbeat") + " · " + esc(a.title || "") + "</div>" +
          (d.length ? d.map(function (x) {
            var L = safeLink(x.link), col = /^(pass|bought|sold|trail)$/.test(x.verdict) ? "up" : /^(kill|reject|stop|skipped|missed)/.test(x.verdict) ? "down" : "";
            return '<div class="dec"><span class="tm">' + hm(x.ts) + "</span>" + (L ? '<a href="' + L + '" target="_blank" rel="noopener">' + esc(x.name) + "</a>" : "<span>" + esc(x.name) + "</span>") +
              '<span class="rs"><span class="' + col + '">' + esc(x.verdict) + "</span>" + (x.reason ? " · " + esc(x.reason) : "") + "</span></div>";
          }).join("") : '<div class="dec"><span></span><span class="muted">' + (a.agent === "scanner" ? "Listening for graduations" : "No decision yet tonight") + "</span><span></span></div>") +
          '<button class="link" data-go="settings" data-agent="' + a.agent + '">Settings ›</button></div>';
      }).join("") + '<p class="note">Plan B hosting: pause, resume and settings go through Telegram. This screen is read-only.</p>';
    }
  };

  SCREENS.activity = {
    layout: function () { return '<h1 class="large">Activity</h1><div class="list" id="al">' + sk(60) + sk(60, 0, 1) + sk(60, 0, 1) + sk(60, 0, 1) + "</div><div id=\"am\"></div>"; },
    update: function () {
      if (D.activity == null && !missing["activity.json"]) return;
      var rows = D.activity || [], n = actPage * 30;
      $("#al").innerHTML = rows.length ? rows.slice(0, n).map(actRow).join("") : '<div class="empty-row">Nothing yet tonight</div>';
      $("#am").innerHTML = rows.length > n ? '<button class="more" data-go="more">Show 30 more</button>' : "";
      localStorage.setItem("desk.seen", String(maxActId()));
    }
  };

  function coinName(mint) {
    var c = (D.coins || []).filter(function (x) { return x.mint === mint; })[0];
    return c ? c.name : mint.slice(0, 4) + "…" + mint.slice(-4);
  }
  function backBar(extra) { return '<div class="nav"><button class="back" data-go="back"><svg viewBox="0 0 24 24"><path d="M15 5l-7 7 7 7"/></svg>Back</button><span style="flex:1"></span>' + (extra || "") + "</div>"; }

  SCREENS.coin = {
    layout: function (s) { return backBar() + '<div id="cc">' + sk(32, "60%") + sk(44, "50%", 14) + sk(260, 0, 12) + sk(120, 0, 12) + "</div>"; },
    update: function (s) {
      var c = D.coin[s.mint], el = $("#cc");
      if (!c) return;
      var meta = (D.coins || []).filter(function (x) { return x.mint === s.mint; })[0] || {};
      if (c.missing) {
        var L0 = safeLink(meta.link);
        el.innerHTML = '<div class="coinhead"><h1>' + esc(meta.name || coinName(s.mint)) + "</h1></div><p class=\"muted\">The desk has no screen data for this coin tonight.</p>" + (L0 ? '<a class="cta" href="' + L0 + '" target="_blank" rel="noopener">Open on FOMO</a>' : "");
        return;
      }
      var p = c.position, open = p && p.status !== "closed", L = safeLink(c.link), a = c.audit;
      var chip = a ? '<button class="chip' + (a.passed ? "" : " red") + '" data-go="auditor" data-mint="' + esc(c.mint) + '">' + (a.passed ? "🛡 8/8" : "🛡 " + (a.checked ? a.checked - 1 : 0) + "/8") + "</button>" : "";
      var since = c.sinceEntryPct;
      var html = '<div class="coinhead"><h1>' + esc(c.name) + '</h1><span class="pill paper"' + (((D.state && D.state.mode) || (p && p.mode)) === "PAPER" ? "" : " hidden") + ">PAPER</span>" + chip + "</div>" +
        '<div class="muted">' + esc(c.symbol) + " · " + esc(c.chain || "Solana") + (c.ageH != null ? " · " + (c.ageH < 1 ? Math.round(c.ageH * 60) + "m" : Math.round(c.ageH) + "h") + " old" : "") + "</div>" +
        '<div class="price">' + price(c.price) + "</div>" +
        (since != null ? '<div class="' + (since >= 0 ? "up" : "down") + '">' + (since >= 0 ? "▲ " : "▼ ") + Math.abs(since).toFixed(2) + "% since entry</div>" : '<div class="muted">' + (c.priceTs ? "price at " + hm(c.priceTs) : "no price yet") + "</div>") +
        '<div class="candles"><canvas id="cv"></canvas></div><div class="faint" id="cvn" style="font-size:12px;margin-top:4px">1-minute candles from the desk\'s DexScreener polls · volume = change of 5m volume</div>' +
        '<div class="stats"><div><span>Market cap</span><b>' + usdShort(c.stats && c.stats.mcap) + "</b></div><div><span>Liquidity</span><b>" + usdShort(c.stats && c.stats.liq) + "</b></div>" +
        "<div><span>24h volume</span><b>" + usdShort(c.stats && c.stats.vol24) + "</b></div><div><span>Holders</span><b>" + (c.stats && c.stats.holders != null ? c.stats.holders.toLocaleString() : "n/a") + "</b></div></div>";
      if (p) {
        html += '<div class="card"><div class="kv"><b>Your position · ' + usd(p.size) + ' in · Executor</b></div>' +
          '<div class="kv"><span>Entry</span>' + price(p.entry) + "</div>" +
          (open ? '<div class="kv"><span>Now</span><span class="' + (p.pnlPct >= 0 ? "up" : "down") + '">' + usd(p.valueUsd) + " · " + pct(p.pnlPct) + "</span></div>" :
            '<div class="kv"><span>Closed</span><span class="' + ((c.exit && c.exit.pnl) >= 0 ? "up" : "down") + '">' + (c.exit ? usd(c.exit.pnl) + " · " + esc(c.exit.reason) : "") + "</span></div>") + "</div>";
        if (open) {
          var left = p.timeoutAt ? Math.max(0, (Date.parse(p.timeoutAt) - Date.now()) / 60000) : null;
          html += '<div class="card"><div class="kv"><b>Exit</b></div><div class="kv"><span>Stop line · -' + (p.stopPct != null ? p.stopPct : "–") + "%</span>" + price(p.stop) + "</div>" +
            '<div class="kv"><span>Trail line · ' + (p.trail ? p.trailPct + "% under peak" : "starts at +" + p.trailStartPct + "%") + "</span>" + (p.trail ? price(p.trailLine) : "not active") + "</div>" +
            '<div class="kv"><span>Time to timeout</span>' + (left == null ? "–" : Math.floor(left / 60) + "h " + Math.round(left % 60) + "m") + "</div></div>";
        }
      }
      if (L) html += '<a class="cta' + (open ? " sell" : "") + '" href="' + L + '" target="_blank" rel="noopener">Open on FOMO</a>';
      if (open) html += '<p class="note">The desk sells this position itself from its wallet when Risk fires. "Open on FOMO" is for watching the coin.</p>';
      el.innerHTML = html;
      var exitLine = open ? (p.trail ? p.trailLine : p.stop) : null;
      if (!Charts.candles($("#cv"), c.candles, exitLine, p && p.entry)) $("#cvn").textContent = "No candles yet · the desk polls this coin every minute";
    }
  };

  SCREENS.auditor = {
    layout: function () { return backBar() + '<div id="au">' + sk(32, "60%") + sk(200, 0, 14) + sk(300, 0, 12) + "</div>"; },
    update: function (s) {
      var c = D.coin[s.mint], el = $("#au");
      if (!c) return;
      var a = c.audit;
      if (c.missing || !a) {
        el.innerHTML = '<h1 class="large">' + esc(c.name || coinName(s.mint)) + '</h1><div class="empty-row">No coin taken apart yet</div>' +
          (c.scan ? '<p class="muted">Scanner: ' + esc(c.scan.verdict) + (c.scan.reason ? " · " + esc(c.scan.reason) : "") + "</p>" : "");
        return;
      }
      if (el.dataset.mint === s.mint && el.dataset.ts === a.ts) return;   // don't replay the beam on every poll
      el.dataset.mint = s.mint; el.dataset.ts = a.ts;
      var layers = a.layers || [], L = safeLink(c.link), en = settingVal("auditor.enabled");
      var sig = c.signal;
      el.innerHTML = '<div class="coinhead"><h1>' + esc(c.name) + "</h1></div><div class=\"muted\">taken apart " + hm(a.ts) + "</div>" +
        '<div class="discs" id="discs">' + layers.map(function (x) { return '<div class="disc" data-n="' + x.n + '"><b></b></div>'; }).join("") + "</div>" +
        '<div id="vd"></div>' +
        '<div class="card layers">' + layers.map(function (x) {
          var cls = x.pass === true ? "up" : x.pass === false ? "down" : "faint", mk = x.pass === true ? "✓" : x.pass === false ? "✕" : "–";
          return '<div class="kv" data-row="' + x.n + '"><span>' + x.n + " · " + esc(x.name) + '</span><span class="val ' + cls + '"><span>' + esc(x.value) + '</span><i class="mk" style="visibility:hidden">' + mk + "</i></span></div>";
        }).join("") + "</div>" +
        '<div class="card"><div class="kv"><span>Take apart before buying</span><span class="switch ' + (en === false ? "" : "on") + '"></span></div><p class="note" style="margin:6px 0 0">Change from Telegram: "set auditor enabled to off" (asks twice).</p></div>' +
        (L ? '<a class="cta" href="' + L + '" target="_blank" rel="noopener">Open on FOMO</a>' : "");
      var verdict = a.passed ? '<div class="verdict up">Cleared · 8/8 parts</div><div class="muted">' + (sig && sig.size ? "Sent to Executor · " + usd(sig.size) : sig ? "Sent to Executor · " + esc(sig.status) : (c.verdict && !c.verdict.pass ? "Analyst said no · " + esc(c.verdict.reason || "") : "Sent to Analyst")) + "</div>"
        : '<div class="verdict down">Rejected · ' + esc(a.reason) + '</div><div class="muted">Grok Bot won\'t buy ' + esc(c.name) + "</div>";
      beam(layers, verdict, beamDone[s.mint + a.ts]); beamDone[s.mint + a.ts] = 1;
    }
  };
  function settingVal(k) {
    var g = (D.account && D.account.settings) || [], v;
    g.forEach(function (x) { x.items.forEach(function (i) { if (i.key === k) v = i.value; }); });
    return v;
  }
  /* audit beam: 350ms per layer top to bottom, then 150ms to green or red. Only layers the desk sent. */
  function beam(layers, verdictHtml, instant) {
    var discs = document.querySelectorAll("#discs .disc"), i = 0;
    function paint(k) {
      var x = layers[k], d = discs[k], row = document.querySelector('[data-row="' + x.n + '"] .mk');
      d.classList.remove("beam"); d.classList.add(x.pass === true ? "ok" : x.pass === false ? "no" : "na");
      d.firstChild.textContent = x.pass === true ? "✓" : x.pass === false ? "✕" : "";
      if (row) row.style.visibility = "visible";
    }
    function done() { $("#vd").innerHTML = verdictHtml; }
    if (reduce || instant) { layers.forEach(function (_, k) { paint(k); }); return done(); }
    (function next() {
      if (i >= layers.length) return done();
      var k = i++; discs[k].classList.add("beam");
      setTimeout(function () { setTimeout(function () { paint(k); next(); }, 150); }, 350);
    })();
  }

  SCREENS.account = {
    layout: function () { return '<h1 class="large">Account</h1><div id="ac">' + sk(90) + sk(120, 0, 12) + sk(300, 0, 12) + "</div>"; },
    update: function () {
      var a = D.account, el = $("#ac");
      if (!DATA_ID && !LOCAL_SRC) { el.innerHTML = noData(); return; }
      if (!a) { if (missing["account.json"]) el.innerHTML = '<div class="empty-row">The desk publishes account data after its next restart.</div>'; return; }
      var prof = safeLink(a.profileUrl), sign = safeLink(a.signupUrl), tg = a.telegram || {};
      var html = '<div class="list"><div class="row"><span class="main"><div class="t1">Mode</div><div class="t2">LIVE needs ' + (a.fullPaperNights >= 1 ? "you to type LIVE" : "1 full PAPER night first") + " · switch from Telegram</div></span>" +
        '<div class="seg" style="width:140px"><span class="' + (a.mode === "PAPER" ? "on" : "") + '">PAPER</span><span class="' + (a.mode === "LIVE" ? "on" : "") + '">LIVE</span></div></div>' +
        '<div class="row"><span class="main"><div class="t1">Stack</div><div class="t2">' + (a.mode === "LIVE" ? "LIVE stack · set with \"stack 1240\"" : "PAPER · started at " + usd(a.paperStartStack)) + "</div></span><span class=\"v\">" + usd(a.mode === "LIVE" ? a.liveStack : a.paperStack) + "</span></div>" +
        (prof ? '<a class="row" href="' + prof + '" target="_blank" rel="noopener"><span class="main"><div class="t1">Your FOMO profile</div><div class="t2">@' + esc(a.fomoHandle) + '</div></span><span class="chev">›</span></a>' : "") +
        (sign ? '<button class="row" data-go="invite" data-url="' + sign + '"><span class="main"><div class="t1">Invite a friend</div><div class="t2">10% off FOMO fees for life</div></span><span class="chev">›</span></button>' : "") + "</div>";
      html += '<h2 class="sec">Notifications</h2><div class="list"><div class="row"><span class="main"><div class="t1">Telegram</div><div class="t2">' + (tg.connected ? "connected" + (tg.lastOk ? " · last push " + hm(tg.lastOk) : "") : "not connected") + '</div></span><span class="v ' + (tg.connected ? "up" : "down") + '">' + (tg.connected ? "●" : "○") + "</span></div>" +
        (tg.bot ? '<a class="row" href="https://t.me/' + esc(tg.bot) + '" target="_blank" rel="noopener"><span class="main"><div class="t1">Send test push</div><div class="t2">Opens the bot · send "status", the desk answers</div></span><span class="chev">›</span></a>' : "") +
        '<div class="row"><span class="main"><div class="t1">Enable notifications</div><div class="t2">' + esc((a.webPush && a.webPush.note) || "Not available on Plan B. Pushes go to Telegram.") + "</div></span></div></div>";
      html += '<h2 class="sec">Settings<span class="sub">read-only · change in Telegram</span></h2>';
      (a.settings || []).forEach(function (g) {
        html += '<div class="setgrp" id="set-' + esc(g.group) + '"><h3>' + esc(NAMES[g.group] || g.group.charAt(0).toUpperCase() + g.group.slice(1)) + '</h3><div class="list">' + g.items.map(function (i) {
          var val = i.kind === "bool" ? (i.value ? "on" : "off") : String(i.value);
          return '<div class="set"><div class="lab"><span>' + esc(i.label) + '</span><span class="exact">' + esc(val) + "</span></div>" +
            (i.kind === "num" && i.min != null ? '<input type="range" disabled min="' + i.min + '" max="' + i.max + '" step="any" value="' + esc(i.value) + '" aria-label="' + esc(i.label) + '">' : "") + "</div>";
        }).join("") + "</div></div>";
      });
      html += '<p class="note">Example: send "set stop to -8%" to the bot. Morning report at ' + esc(a.reportTime || "08:00") + ".</p>";
      el.innerHTML = html;
    }
  };

  /* ---------- search (name, symbol or mint) ---------- */
  function openSearch() {
    var sh = $("#sheet"); sh.hidden = false;
    sh.innerHTML = '<div class="search"><input id="q" placeholder="Name, symbol or mint" autocomplete="off" autocapitalize="off" spellcheck="false"><button class="link" id="qx">Cancel</button></div><div class="list" id="qr" style="margin-top:12px"></div>';
    var q = $("#q"); q.focus();
    $("#qx").onclick = function () { sh.hidden = true; sh.innerHTML = ""; };
    function run() {
      var s = q.value.trim().toLowerCase(), all = D.coins || [];
      var res = !s ? all.slice(0, 20) : all.filter(function (c) { return (c.name || "").toLowerCase().indexOf(s) > -1 || (c.symbol || "").toLowerCase().indexOf(s) > -1 || c.mint.toLowerCase() === s; });
      $("#qr").innerHTML = res.length ? res.map(function (c) {
        var rej = /reject|killed/.test(c.stage);
        return '<button class="row" data-go="' + (rej ? "auditor" : "coin") + '" data-mint="' + esc(c.mint) + '"><span class="main"><div class="t1">' + esc(c.name) + '</div><div class="t2">' + esc(c.symbol) + " · " + esc(c.stage.replace("_", " ")) + '</div></span><span class="chev">›</span></button>';
      }).join("") : '<div class="empty-row">' + (all.length ? "No coin tonight matches" : "Nothing yet tonight") + "</div>";
    }
    q.oninput = run; run();
    $("#qr").addEventListener("click", function () { sh.hidden = true; sh.innerHTML = ""; }, true);
  }

  /* ---------- service worker: app shell only, never the data ---------- */
  if ("serviceWorker" in navigator && location.protocol === "https:") navigator.serviceWorker.register("sw.js").catch(function () {});

  if (PREVIEW) { if (/^(home|agents|activity|account)$/.test(PREVIEW[1])) setTab(PREVIEW[1]); else { stack = [{ name: "home" }, { name: PREVIEW[1], mint: PREVIEW[2] }]; loadCoin(PREVIEW[2]).then(update, update); } }
  mount(); poll(); setInterval(poll, POLL_MS);
  document.addEventListener("visibilitychange", function () { if (!document.hidden) poll(); });
})();
