/**
 * Home-page polling and rendering.
 * Signal percentage uses the existing function in signal.js.
 * Meter tiers use the documented thresholds; boundary values enter the
 * higher tier with >= comparisons.
 */
(function () {
  var AT_CMD = 'AT+QSIMSTAT?;+CSQ;+QTEMP;+QUIMSLOT?;+QSPN;+CGCONTRDP=1;+QENG="servingcell";+QNWINFO;+QRSRP;+QRSRQ;+QSINR';
  var WINDOW_MS = 5 * 60 * 1000;
  var MAX_POINTS = 150;
  var GRADE_COLOR = { "Excellent": "#15803D", "Good": "#22C55E", "Fair": "#EAB308", "Poor": "#EF4444", "No signal": "#A3ABBE" };
  var DISPLAY = { "Excellent": "Excellent", "Good": "Good", "Fair": "Fair", "Poor": "Poor", "No signal": "No signal" };
  var TIER_COLOR = { "Excellent": "#15803D", "Good": "#22C55E", "Fair": "#EAB308", "Poor": "#EF4444" };
  var SCALES = {
    rsrp: { unit: "dBm", min: -120, max: -60, edges: [-100, -90, -80], label: "RSRP", hint: "Signal strength" },
    rsrq: { unit: "dB", min: -25, max: -3, edges: [-20, -15, -10], label: "RSRQ", hint: "Signal quality" },
    sinr: { unit: "dB", min: -10, max: 30, edges: [0, 13, 20], label: "SINR", hint: "Signal-to-noise ratio" }
  };

  var OPERATORS = {
    "46000": "China Mobile", "46002": "China Mobile", "46004": "China Mobile", "46007": "China Mobile", "46008": "China Mobile",
    "46001": "China Unicom", "46006": "China Unicom", "46009": "China Unicom",
    "46003": "China Telecom", "46005": "China Telecom", "46011": "China Telecom",
    "46015": "China Broadnet"
  };

  function opName() {
    var raw = state.network_provider && state.network_provider !== "-" ? String(state.network_provider).trim() : "";
    if (raw && !/[\u4e00-\u9fff]/.test(raw)) return raw;
    // The modem may return MCCMNC with quotes or spaces; normalize before lookup.
    var mapped = OPERATORS[String(state.mccmnc || "").replace(/["\s]/g, "")];
    if (mapped) return mapped;
    if (raw) return "MCCMNC " + String(state.mccmnc || "unknown").replace(/["\s]/g, "");
    return "—";
  }

  var state = createLiveState();
  var history = [];
  var rate = 2;
  var timer = 0;
  var paused = false;
  var failStreak = 0;
  var polling = false;

  function displayGrade(raw) {
    return DISPLAY[raw] || raw || "No data";
  }

  function num(value) {
    if (value == null || value === "-" || value === "") return null;
    var n = parseFloat(String(value).replace(/"/g, ""));
    return Number.isFinite(n) ? n : null;
  }

  /** Tier thresholds are ordered from poor to excellent. */
  function tierName(value, edges) {
    var names = ["Poor", "Fair", "Good", "Excellent"];
    var index = 0;
    for (var i = 0; i < edges.length; i++) {
      if (value >= edges[i]) index = i + 1;
      else break;
    }
    return names[index];
  }

  function formatMode(mode) {
    if (!mode || mode === "-") return "—";
    if (mode.indexOf("NSA") >= 0) return "4G + 5G";
    if (mode.indexOf("NR5G-SA") >= 0) return "5G only";
    if (mode.indexOf("LTE") >= 0) return "4G only";
    if (mode === "Network disconnected") return "Disconnected";
    return "—";
  }

  function formatBand(band) {
    if (!band || band === "-") return "";
    var nr = /BAND\s*(\d+)/i.exec(band);
    if (nr && /NR|5G/i.test(band)) return "n" + nr[1];
    if (nr) return "B" + nr[1];
    return band;
  }

  function formatUptime(text) {
    if (!text || text === "Unknown" || text === "Unknown uptime") return "";
    return String(text).replace(/\s*,\s*/g, " ").replace(/\s+/g, " ").trim();
  }

  function hexPart(value) {
    if (!value || value === "-") return "—";
    var last = String(value).split(",").pop();
    return last.split("(")[0].trim() || "—";
  }

  /**
   * SA uses NR. NSA prefers NR and falls back to LTE when NR is unavailable.
   * 4G-only uses LTE. The gauge continues to use signalQuality.
   */
  function scaleRat() {
    var mode = state.network_mode || "";
    var nr = num(state.rsrpNR) != null || num(state.sinrNR) != null || num(state.rsrqNR) != null;
    var lte = num(state.rsrpLTE) != null || num(state.sinrLTE) != null || num(state.rsrqLTE) != null;
    if (mode.indexOf("NR5G-SA") >= 0) return nr ? "5G" : "";
    if (mode.indexOf("NSA") >= 0) return nr ? "5G" : (lte ? "4G" : "");
    if (mode.indexOf("LTE") >= 0 || lte) return lte ? "4G" : "";
    return "";
  }

  function scaleValue(key, rat) {
    var map = {
      "5G": { rsrp: state.rsrpNR, rsrq: state.rsrqNR, sinr: state.sinrNR },
      "4G": { rsrp: state.rsrpLTE, rsrq: state.rsrqLTE, sinr: state.sinrLTE }
    };
    return rat && map[rat] ? num(map[rat][key]) : null;
  }

  function writeStatus(extra) {
    var raw = state.signalAssessment;
    var payload = {
      at: Date.now(),
      conn: state.internetConnection || "—",
      sim: state.sim || "—",
      op: opName(),
      mode: formatMode(state.network_mode),
      pct: state.signalPercentage,
      grade: displayGrade(raw),
      failStreak: failStreak,
      refreshing: false,
      banner: ""
    };
    if (extra) Object.keys(extra).forEach(function (key) { payload[key] = extra[key]; });
    sessionStorage.setItem(Shell.STATUS_KEY, JSON.stringify(payload));
    Shell.renderStatus();
  }

  function paintGauge() {
    var raw = state.signalAssessment;
    var color = GRADE_COLOR[raw] || "#A3ABBE";
    var pct = parseInt(state.signalPercentage, 10);
    if (!Number.isFinite(pct)) pct = 0;
    var arc = document.getElementById("gauge-arc");
    var r = 62;
    var c = 2 * Math.PI * r;
    arc.style.stroke = color;
    arc.style.strokeDasharray = c.toFixed(2);
    arc.style.strokeDashoffset = (c * (1 - Math.max(0, Math.min(100, pct)) / 100)).toFixed(2);
    var pctEl = document.getElementById("gauge-pct");
    if (raw === "Unknown" || raw === "") pctEl.textContent = "—";
    else pctEl.innerHTML = pct + "<small>%</small>";
    var grade = document.getElementById("gauge-grade");
    var unknown = raw === "Unknown" || raw === "";
    grade.innerHTML = unknown ? "—" : "<i></i>" + displayGrade(raw);
    grade.style.color = unknown ? "" : color;
    grade.style.background = unknown ? "" : hexAlpha(color, 0.14);
    document.querySelectorAll("[data-legend]").forEach(function (item) {
      var name = item.getAttribute("data-legend");
      var on = name === displayGrade(raw);
      item.classList.toggle("is-current", on);
      var text = item.lastChild;
      if (text && text.nodeType === 3) text.nodeValue = on && window.matchMedia("(min-width: 768px)").matches ? name + " (current)" : name;
    });
  }

  function paintMeter(key) {
    var spec = SCALES[key];
    var root = document.querySelector('[data-meter="' + key + '"]');
    var rat = scaleRat();
    var value = scaleValue(key, rat);
    root.querySelector(".m-name").textContent = (rat || "5G") + " " + spec.label;
    root.querySelector(".m-hint").textContent = spec.hint;
    var valEl = root.querySelector(".m-val");
    var bar = root.querySelector(".bar");
    var missing = value == null || !rat;
    root.classList.toggle("is-empty", missing);
    if (missing) {
      valEl.textContent = "No data";
      bar.querySelector(".needle").style.left = "0%";
      root.querySelectorAll(".tier-names span").forEach(function (el) { el.classList.remove("is-on"); el.style.color = ""; });
      return;
    }
    var tier = tierName(value, spec.edges);
    valEl.innerHTML = value + '<span class="unit">' + spec.unit + '</span><span class="tier" style="color:' + TIER_COLOR[tier] + '">· ' + tier + "</span>";
    var span = spec.max - spec.min;
    var ratio = (value - spec.min) / span;
    var left = Math.max(0, Math.min(1, ratio)) * 100;
    var needle = bar.querySelector(".needle");
    needle.style.left = left + "%";
    var names = ["Poor", "Fair", "Good", "Excellent"];
    root.querySelectorAll(".tier-names span").forEach(function (el, index) {
      var on = names[index] === tier;
      el.classList.toggle("is-on", on);
      el.style.color = on ? TIER_COLOR[tier] : "";
    });
    bar.querySelectorAll(".seg").forEach(function (seg, index) {
      seg.style.background = names[index] === tier ? TIER_COLOR[tier] : hexAlpha(TIER_COLOR[names[index]], 0.28);
    });
  }

  function hexAlpha(hex, alpha) {
    var n = parseInt(hex.slice(1), 16);
    var r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
    return "rgba(" + r + "," + g + "," + b + "," + alpha + ")";
  }

  function paintMeters() {
    var rat = scaleRat();
    var note = document.getElementById("meter-note");
    var mode = state.network_mode || "";
    if (mode.indexOf("NSA") >= 0 && rat === "5G") note.textContent = "Connected to 4G + 5G (NSA); showing 5G readings.";
    else if (mode.indexOf("NSA") >= 0 && rat === "4G") note.textContent = "5G readings unavailable; showing 4G readings.";
    else if (rat === "4G") note.textContent = "Connected to 4G only.";
    else if (rat === "5G") note.textContent = "Connected to 5G only.";
    else note.textContent = "";
    ["rsrp", "rsrq", "sinr"].forEach(paintMeter);
    layoutMeterSegments();
  }

  function layoutMeterSegments() {
    document.querySelectorAll("[data-meter]").forEach(function (root) {
      var spec = SCALES[root.getAttribute("data-meter")];
      var span = spec.max - spec.min;
      var points = [spec.min].concat(spec.edges).concat([spec.max]);
      var ticks = root.querySelector(".ticks");
      ticks.innerHTML = "";
      root.querySelectorAll(".seg").forEach(function (seg, index) {
        seg.style.flex = String((points[index + 1] - points[index]) / span);
      });
      root.querySelectorAll(".tier-names span").forEach(function (el, index) {
        el.style.flex = String((points[index + 1] - points[index]) / span);
      });
      spec.edges.forEach(function (point) {
        var tick = document.createElement("span");
        tick.style.left = ((point - spec.min) / span * 100) + "%";
        tick.textContent = point;
        ticks.appendChild(tick);
      });
      root.querySelector(".lo").textContent = "Poor " + spec.min + " " + spec.unit;
      root.querySelector(".hi").textContent = spec.max + " " + spec.unit + " Good";
    });
  }

  function pushHistory() {
    var rat = scaleRat();
    history.push({
      t: Date.now(),
      rsrp: scaleValue("rsrp", rat),
      sinr: scaleValue("sinr", rat)
    });
    var cutoff = Date.now() - WINDOW_MS;
    history = history.filter(function (point) { return point.t >= cutoff; });
    if (history.length > MAX_POINTS) history = history.slice(history.length - MAX_POINTS);
  }

  function pushGap() {
    history.push({ t: Date.now(), rsrp: null, sinr: null });
    var cutoff = Date.now() - WINDOW_MS;
    history = history.filter(function (point) { return point.t >= cutoff; });
    if (history.length > MAX_POINTS) history = history.slice(history.length - MAX_POINTS);
  }

  function finitePoints(key) {
    return history.filter(function (point) { return point[key] != null; });
  }

  var CHART = {
    rsrp: { lo: -104, hi: -76, step: 4 },
    sinr: { lo: -4, hi: 24, step: 4 }
  };

  function paintChart(key) {
    var spec = SCALES[key];
    var cfg = CHART[key];
    var host = document.getElementById("plot-" + key);
    var got = finitePoints(key);
    var stats = document.getElementById("chart-stats-" + key);
    if (!got.length) {
      stats.textContent = "Waiting for data…";
      host.innerHTML = '<p class="chart-empty">Waiting for data…</p>';
      return;
    }
    var min = got[0][key], max = got[0][key], sum = 0;
    got.forEach(function (point) {
      min = Math.min(min, point[key]);
      max = Math.max(max, point[key]);
      sum += point[key];
    });
    stats.textContent = "Min " + min + " · Avg " + Math.round(sum / got.length) + " · Max " + max + " " + spec.unit;
    var y0 = cfg.lo, y1 = cfg.hi;
    while (min < y0) y0 -= cfg.step;
    while (max > y1) y1 += cfg.step;
    var width = Math.max(280, host.clientWidth || 320);
    var pad = { l: 36, r: 8, t: 6, b: 22 };
    var plotH = 150;
    var height = pad.t + plotH + pad.b;
    var plotR = width - pad.r;
    var plotB = pad.t + plotH;
    var now = Date.now();
    // Keep the X axis fixed at five minutes; shorter histories begin at the right.
    var span = WINDOW_MS;
    var x0 = now - span;
    function xOf(t) { return pad.l + (t - x0) / span * (plotR - pad.l); }
    function yOf(v) { return pad.t + (y1 - v) / (y1 - y0) * plotH; }
    function clampY(v) { return Math.max(y0, Math.min(y1, v)); }
    var bands = [-Infinity].concat(spec.edges).concat([Infinity]);
    var names = ["Poor", "Fair", "Good", "Excellent"];
    var colors = ["#EF4444", "#EAB308", "#22C55E", "#15803D"];
    var svg = '<svg viewBox="0 0 ' + width + " " + height + '" width="100%" height="' + height + '">';
    svg += '<defs><linearGradient id="area-grad-' + key + '" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#5B6CFF" stop-opacity=".12"/><stop offset="1" stop-color="#5B6CFF" stop-opacity="0"/></linearGradient></defs>';
    var labels = "";
    for (var i = 0; i < 4; i++) {
      var lo = Math.max(y0, bands[i]), hi = Math.min(y1, bands[i + 1]);
      if (hi <= lo) continue;
      var top = yOf(hi), bot = yOf(lo);
      svg += '<rect class="band" x="' + pad.l + '" y="' + top.toFixed(1) + '" width="' + (plotR - pad.l) + '" height="' + (bot - top).toFixed(1) + '" style="fill:var(--tier-' + (4 - i) + ')"/>';
      if (bot - top >= 12) {
        labels += '<text class="band-name" x="' + (plotR - 14) + '" y="' + (top + 11).toFixed(1) + '" text-anchor="end" style="fill:var(--tier-' + (4 - i) + ')">' + names[i] + "</text>";
      }
    }
    for (var v = y0; v <= y1; v += cfg.step) {
      var gy = yOf(v).toFixed(1);
      svg += '<line class="grid" x1="' + pad.l + '" x2="' + plotR + '" y1="' + gy + '" y2="' + gy + '"/>';
      svg += '<text class="ax" x="' + (pad.l - 6) + '" y="' + (yOf(v) + 3.5).toFixed(1) + '" text-anchor="end">' + v + "</text>";
    }
    var gaps = "";
    var gi = 0;
    while (gi < history.length) {
      if (history[gi][key] != null) { gi++; continue; }
      var gs = gi;
      while (gi < history.length && history[gi][key] == null) gi++;
      var before = history[gs - 1], after = history[gi];
      var left = (before ? xOf(before.t) : xOf(history[gs].t)) + 3;
      var right = (after ? xOf(after.t) : xOf(history[gi - 1].t)) - 3;
      left = Math.max(pad.l, left);
      right = Math.min(plotR, right);
      if (right - left < 2) continue;
      var mid = (left + right) / 2;
      gaps += '<rect class="gap" x="' + left.toFixed(1) + '" y="' + pad.t + '" width="' + (right - left).toFixed(1) + '" height="' + plotH + '"/>';
      gaps += '<line class="gap-line" x1="' + mid.toFixed(1) + '" x2="' + mid.toFixed(1) + '" y1="' + pad.t + '" y2="' + plotB + '"/>';
      var tx = Math.max(pad.l, Math.min(plotR - 124, mid - 62));
      gaps += '<g class="gap-tip"><rect x="' + tx.toFixed(1) + '" y="' + (plotB - 8 - 24) + '" width="124" height="24" rx="8"/><text x="' + (tx + 62).toFixed(1) + '" y="' + (plotB - 8 - 8) + '" text-anchor="middle">No reading for this period</text></g>';
    }
    var lines = "";
    var run = [];
    function flush() {
      if (run.length >= 2) {
        var pts = run.map(function (p) { return xOf(p.t).toFixed(1) + "," + yOf(clampY(p[key])).toFixed(1); });
        lines += '<polygon class="area" fill="url(#area-grad-' + key + ')" points="' + xOf(run[0].t).toFixed(1) + "," + plotB + " " + pts.join(" ") + " " + xOf(run[run.length - 1].t).toFixed(1) + "," + plotB + '"/>';
        lines += '<polyline class="line" points="' + pts.join(" ") + '"/>';
      } else if (run.length === 1) {
        lines += '<circle class="solo" cx="' + xOf(run[0].t).toFixed(1) + '" cy="' + yOf(clampY(run[0][key])).toFixed(1) + '" r="2.5"/>';
      }
      run = [];
    }
    history.forEach(function (point) {
      if (point[key] == null) flush();
      else run.push(point);
    });
    flush();
    svg += gaps.replace(/<g class="gap-tip">[\s\S]*?<\/g>/g, "") + lines + labels;
    var last = history.length ? history[history.length - 1] : null;
    if (last && last[key] != null) {
      var tier = 0;
      spec.edges.forEach(function (edge) { if (last[key] >= edge) tier++; });
      svg += '<circle class="last-dot" cx="' + xOf(last.t).toFixed(1) + '" cy="' + yOf(clampY(last[key])).toFixed(1) + '" r="4.5" fill="' + colors[tier] + '"/>';
    }
    (gaps.match(/<g class="gap-tip">[\s\S]*?<\/g>/g) || []).forEach(function (tip) { svg += tip; });
    function ago(ms) {
      var m = ms / 60000;
      if (m >= 1) return (Math.round(m * 10) / 10) + " min ago";
      return Math.round(ms / 1000) + "s ago";
    }
    var ly = height - 6;
    svg += '<text class="ax" x="' + pad.l + '" y="' + ly + '" text-anchor="start">' + ago(span) + "</text>";
    svg += '<text class="ax" x="' + ((pad.l + plotR) / 2).toFixed(1) + '" y="' + ly + '" text-anchor="middle">' + ago(span / 2) + "</text>";
    svg += '<text class="ax" x="' + plotR + '" y="' + ly + '" text-anchor="end">Now</text>';
    svg += "</svg>";
    host.innerHTML = svg;
  }

  function cell(text) {
    return text && text !== "-" ? text : "—";
  }

  function paintTables() {
    var rat = scaleRat();
    var nsa = state.network_mode.indexOf("NSA") >= 0;
    var band = nsa && state.nrBand && state.nrBand !== "-" ? state.nrBand : formatBand(state.bands);
    setText("d-pci-4", rat === "4G" ? cell(state.pcc_pci) : (state.network_mode.indexOf("NSA") >= 0 ? cell(state.pcc_pci) : "—"));
    setText("d-pci-5", rat === "5G" && state.network_mode.indexOf("NSA") < 0 ? cell(state.pcc_pci) : cell(state.scc_pci));
    if (state.network_mode.indexOf("NSA") >= 0) {
      setText("d-pci-4", cell(state.pcc_pci));
      setText("d-pci-5", cell(state.scc_pci));
    }
    var id4 = state.network_mode.indexOf("NR5G-SA") >= 0 ? "—" : hexPart(state.cellID);
    var id5 = state.network_mode.indexOf("NR5G-SA") >= 0 ? hexPart(state.cellID) : "—";
    setText("d-id-4", id4);
    setText("d-id-5", id5);
    setText("d-tac-4", state.network_mode.indexOf("NR5G-SA") >= 0 ? "—" : hexPart(state.tac));
    setText("d-tac-5", state.network_mode.indexOf("NR5G-SA") >= 0 ? hexPart(state.tac) : "—");
    var sa = state.network_mode.indexOf("NR5G-SA") >= 0;
    setText("d-earfcn-4", sa ? "—" : cell(state.earfcns));
    setText("d-earfcn-5", sa ? cell(state.earfcns) : nsa ? cell(state.nrArfcn) : "—");
    setText("d-band-4", sa ? "—" : (formatBand(state.bands) || cell(state.bands)));
    setText("d-band-5", sa ? (formatBand(state.bands) || cell(state.bands)) : nsa ? cell(state.nrBand) : "—");
    var bw = state.bandwidth && state.bandwidth !== "-" ? state.bandwidth : "";
    var lteBw = /UL\s*([\d.]+)\s*MHz\s*\/\s*DL\s*([\d.]+)\s*MHz/.exec(bw);
    // Show one value when UL and DL bandwidth match.
    setText("d-bw-4", lteBw ? (lteBw[1] === lteBw[2] ? lteBw[1] + " MHz" : "UL " + lteBw[1] + " MHz / DL " + lteBw[2] + " MHz") : "—");
    setText("d-bw-5", bw.indexOf("NR ") === 0 ? bw.replace("NR ", "") : nsa ? cell(state.nrBw) : "—");
    paintSigCell("d-rsrp", state.rsrpLTE, state.rsrpNR, "rsrp");
    paintSigCell("d-rsrq", state.rsrqLTE, state.rsrqNR, "rsrq");
    paintSigCell("d-sinr", state.sinrLTE, state.sinrNR, "sinr");
    setText("d-csq-4", cell(state.csq));
    setText("d-csq-5", "—");
    setText("d-apn", cell(state.apn));
    setText("d-ip4", cell(state.ipv4));
    setText("d-ip6", cell(state.ipv6));
    setText("d-mcc", cell(state.mccmnc));
    setText("card-up", formatUptime(state.uptime) || "No data");
    setText("card-up-sub", "Uptime · " + (state.internetConnection || "Disconnected"));
    setText("card-net", formatMode(state.network_mode));
    setText("card-net-sub", (opName()) + (band ? " · Band " + band : ""));
    setText("card-temp", state.temperature && state.temperature !== "N/A" && state.temperature !== "0" ? state.temperature + "°C" : "No data");
    setText("card-sim", state.active_sim && state.active_sim !== "-" ? "Slot " + state.active_sim : "No data");
    setText("card-sim-sub", (state.sim || "—") + (state.apn && state.apn !== "-" ? " · APN " + state.apn : ""));
    setText("hero-conn", state.internetConnection || "Disconnected");
    setText("hero-up", formatUptime(state.uptime) ? "Up for " + formatUptime(state.uptime) : "Uptime unavailable");
    setText("hero-op", opName());
    setText("hero-mode", formatMode(state.network_mode) + (band ? " · Band " + band : ""));
    document.getElementById("hero-dot").classList.toggle("is-on", state.internetConnection === "Connected");
  }

  function paintSigCell(id, lte, nr, key) {
    setHtml(id + "-4", signalHtml(lte, key));
    setHtml(id + "-5", signalHtml(nr, key));
  }

  function signalHtml(value, key) {
    var n = num(value);
    if (n == null) return "—";
    var spec = SCALES[key];
    var tier = tierName(n, spec.edges);
    return '<i class="dot-tier" style="background:' + TIER_COLOR[tier] + '"></i>' + n + " " + spec.unit;
  }

  function setText(id, text) {
    var el = document.getElementById(id);
    if (el) el.textContent = text;
  }
  function setHtml(id, html) {
    var el = document.getElementById(id);
    if (el) el.innerHTML = html;
  }

  function showSimEmpty(on) {
    document.getElementById("sim-empty").hidden = !on;
    document.getElementById("home-body").hidden = on;
  }

  /* ---------- Antennas ---------- */
  var ANT_CHANNELS = ["Primary PRX", "Diversity DRX", "RX2", "RX3"];
  var ANT_RAT_LABEL = { NR5G: "5G", LTE: "4G" };
  var ANT_TIP = "No signal on this path. Check whether the antenna is connected securely.";
  var antSeg = "NR5G";
  var antTipOpen = "";

  function antKv(name, list, i, unit) {
    if (!list) return "";
    var v = list[i];
    return '<div><dt>' + name + '</dt><dd>' + (v == null ? "—" : v + " " + unit) + "</dd></div>";
  }

  function antCell(rat, data, i) {
    var v = data.rsrp[i];
    var key = rat + "-" + i;
    var head = '<div class="ant-name"><b>Antenna ' + (i + 1) + "</b><span>" + ANT_CHANNELS[i] + "</span></div>";
    var body;
    if (v == null) {
      body = '<div class="ant-rsrp"><i class="ant-dot" style="background:var(--tx3)"></i><span class="ant-none">No signal</span></div>' +
        '<div class="ant-bar"></div>';
    } else {
      var tier = tierName(v, SCALES.rsrp.edges);
      var pct = Math.max(0, Math.min(100, (v + 120) / 60 * 100));
      body = '<div class="ant-rsrp"><i class="ant-dot" style="background:' + TIER_COLOR[tier] + '"></i>' +
        '<span class="ant-v">' + v + '</span><span class="ant-u">dBm</span>' +
        '<span class="ant-t" style="color:' + TIER_COLOR[tier] + '">· ' + tier + "</span></div>" +
        '<div class="ant-bar"><i style="width:' + pct.toFixed(1) + "%;background:" + TIER_COLOR[tier] + '"></i></div>';
    }
    var kv = data.rsrq || data.sinr
      ? '<dl class="ant-kv">' + antKv("RSRQ", data.rsrq, i, "dB") + antKv("SINR", data.sinr, i, "dB") + "</dl>" : "";
    var off = v == null;
    return '<div class="ant-cell' + (off ? " is-off" + (antTipOpen === key ? " is-tip" : "") : "") + '" data-key="' + key + '"' +
      (off ? ' tabindex="0" role="button" aria-label="Antenna ' + (i + 1) + ' has no signal"' : "") + ">" +
      head + body + kv + (off ? '<div class="ant-tip" role="tooltip">' + ANT_TIP + "</div>" : "") + "</div>";
  }

  function paintAntennas() {
    var card = document.getElementById("ant-card");
    var segEl = document.getElementById("ant-seg");
    if (!card) return;
    var ants = state.antennas || {};
    var rats = ["NR5G", "LTE"].filter(function (r) { return ants[r]; });
    if (!rats.length) {
      card.className = "card ant-card is-empty";
      card.innerHTML = '<p class="ant-empty">No data</p>';
      segEl.hidden = true;
      return;
    }
    var both = rats.length > 1;
    if (!both) antSeg = rats[0];
    card.className = "card ant-card" + (both ? "" : " is-single");
    card.dataset.show = antSeg;
    segEl.hidden = !both;
    Array.prototype.forEach.call(segEl.querySelectorAll("button"), function (b) {
      var on = b.dataset.k === antSeg;
      b.classList.toggle("is-on", on);
      b.setAttribute("aria-selected", on ? "true" : "false");
    });
    card.innerHTML = rats.map(function (rat) {
      var data = ants[rat];
      return '<div class="ant-row" data-k="' + rat + '">' +
        (both ? '<span class="ant-tag">' + ANT_RAT_LABEL[rat] + "</span>" : "") +
        '<div class="ant-cells">' + [0, 1, 2, 3].map(function (i) { return antCell(rat, data, i); }).join("") + "</div></div>";
    }).join("");
  }

  function bindAntennas() {
    var segEl = document.getElementById("ant-seg");
    var card = document.getElementById("ant-card");
    if (!segEl || !card) return;
    segEl.addEventListener("click", function (e) {
      var b = e.target.closest("button");
      if (!b) return;
      antSeg = b.dataset.k;
      paintAntennas();
    });
    card.addEventListener("click", function (e) {
      e.antHandled = true;
      var cell = e.target.closest(".ant-cell.is-off");
      antTipOpen = cell && antTipOpen !== cell.dataset.key ? cell.dataset.key : "";
      paintAntennas();
    });
    document.addEventListener("click", function (e) {
      // Clicks inside the card are handled above; the redraw detaches e.target.
      if (antTipOpen && !e.antHandled) { antTipOpen = ""; paintAntennas(); }
    });
  }

  function renderAll() {
    document.getElementById("home-skeleton").hidden = true;
    document.getElementById("home-ready").hidden = false;
    var inactive = state.sim === "Inactive";
    showSimEmpty(inactive);
    paintGauge();
    if (!inactive) {
      paintMeters();
      paintAntennas();
      paintTables();
      paintChart("rsrp");
      paintChart("sinr");
    }
    document.getElementById("page").classList.toggle("is-stale", failStreak >= 3);
  }

  function parseUptime(data) {
    var days = data.match(/(\d+) day/);
    var hours = data.match(/(\d+) hour/);
    var minutes = data.match(/(\d+) min/);
    var hoursAndMinutes = data.match(/(\d+):(\d+),/);
    if (hoursAndMinutes) return (days ? days[1] + "d " : "") + hoursAndMinutes[1] + "h " + hoursAndMinutes[2] + "m";
    if (days) return days[1] + "d" + (hours ? ", " + hours[1] + "h" : "") + (minutes ? ", " + minutes[1] + "m" : "");
    if (hours) return hours[1] + "h" + (minutes ? ", " + minutes[1] + "m" : "");
    if (minutes) return minutes[1] + "m";
    return "Unknown uptime";
  }

  function fetchText(url, timeoutMs) {
    var controller = new AbortController();
    var timerId = setTimeout(function () { controller.abort(); }, timeoutMs);
    return fetch(url, { signal: controller.signal, cache: "no-store" }).then(function (response) {
      if (!response.ok) throw new Error(String(response.status));
      return response.text();
    }).finally(function () { clearTimeout(timerId); });
  }

  function poll() {
    if (state.networkFetchPending || paused || document.hidden) return;
    state.networkFetchPending = true;
    var url = "/cgi-bin/get_atcommand?" + new URLSearchParams({ atcmd: AT_CMD }).toString();
    /* Only the AT request has the ten-second timeout. Ping and uptime failures
       do not invalidate signal readings that were already received. */
    fetchText(url, 10000).then(function (text) {
      state.parseNetworkInfo(text.split("\n"));
      var ping = state.sim !== "Inactive" ? fetchText("/cgi-bin/get_ping", 8000) : Promise.resolve("");
      return ping.then(function (body) {
        if (body) state.internetConnection = body.trim() === "OK" ? "Connected" : "Disconnected";
        else state.internetConnection = "Disconnected";
      }).catch(function () {
        state.internetConnection = "Disconnected";
      }).then(function () {
        return fetchText("/cgi-bin/get_uptime", 8000).then(function (uptime) {
          state.uptime = parseUptime(uptime);
        }).catch(function () {
          state.uptime = "Unknown uptime";
        });
      }).then(function () {
        failStreak = 0;
        pushHistory();
        writeStatus();
        renderAll();
      });
    }).catch(function () {
      failStreak += 1;
      pushGap();
      writeStatus({ banner: "Device response timed out. Retrying…" });
      if (!document.getElementById("home-ready").hidden) {
        paintChart("rsrp");
        paintChart("sinr");
      }
      document.getElementById("page").classList.toggle("is-stale", failStreak >= 3);
    }).finally(function () {
      state.networkFetchPending = false;
    });
  }

  function schedule() {
    clearInterval(timer);
    if (paused || document.hidden) return;
    timer = setInterval(poll, rate * 1000);
  }

  var PAUSE_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 5v14M15 5v14"/></svg>';
  var PLAY_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5.5v13l10-6.5z"/></svg>';

  function setPauseLabel(btn) {
    btn.innerHTML = (paused ? PLAY_ICON : PAUSE_ICON) + "<span>" + (paused ? "Resume" : "Pause") + "</span>";
  }

  function boot() {
    setPauseLabel(document.getElementById("pause-btn"));
    var stored = parseInt(localStorage.getItem("refreshRate") || "2", 10);
    rate = Number.isFinite(stored) && stored >= 2 ? stored : 2;
    var input = document.getElementById("refresh-input");
    input.value = String(rate);
    var chip = document.getElementById("refresh-chip");
    chip.textContent = "Every " + rate + "s";
    chip.addEventListener("click", function () {
      var open = input.parentNode.classList.toggle("is-open");
      chip.setAttribute("aria-expanded", open ? "true" : "false");
      if (open) input.focus();
    });
    input.addEventListener("change", function () {
      var next = parseInt(input.value, 10);
      if (!Number.isFinite(next) || next < 2) next = 2;
      input.value = String(next);
      rate = next;
      chip.textContent = "Every " + next + "s";
      localStorage.setItem("refreshRate", String(next));
      schedule();
    });
    document.getElementById("pause-btn").addEventListener("click", function () {
      paused = !paused;
      setPauseLabel(this);
      this.setAttribute("aria-pressed", paused ? "true" : "false");
      if (!paused) poll();
      schedule();
    });
    document.getElementById("detail-toggle").addEventListener("click", function () {
      var open = document.getElementById("detail-wrap").classList.toggle("is-open");
      this.textContent = open ? "Hide details" : "Show details";
      this.setAttribute("aria-expanded", open ? "true" : "false");
    });
    document.addEventListener("visibilitychange", function () {
      if (document.hidden) {
        clearInterval(timer);
        return;
      }
      writeStatus({ refreshing: true, banner: "" });
      poll();
      schedule();
    });
    window.addEventListener("resize", function () {
      paintChart("rsrp");
      paintChart("sinr");
    });
    layoutMeterSegments();
    bindAntennas();
    writeStatus({ at: 0, refreshing: true, grade: "", pct: "", conn: "—", sim: "—", op: "—", mode: "—" });
    poll();
    schedule();
  }

  boot();
})();
