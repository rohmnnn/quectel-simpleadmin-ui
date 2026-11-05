/**
 * Global shell: sidebar, tablet rail, phone tabs, status bar, and themes.
 * Makes no CGI requests. The status bar reads sessionStorage written by home.
 */
(function () {
  var THEME_KEY = "theme";
  var STATUS_KEY = "cpe-status";
  var NAV = [
    { group: "Network", id: "home", href: "/", label: "Home", icon: "home" },
    { group: "Network", id: "network", href: "/network.html", label: "Network", icon: "radio" },
    { group: "Network", id: "scan", href: "/scanner.html", label: "Cell scan", icon: "scan" },
    { group: "Network", id: "sms", href: "/sms.html", label: "SMS", icon: "sms" },
    { group: "Device", id: "settings", href: "/settings.html", label: "Settings", icon: "gear" },
    { group: "Device", id: "device", href: "/deviceinfo.html", label: "Device info", icon: "chip" },
    { group: "Device", id: "watchcat", href: "/watchcat.html", label: "Watchcat", icon: "pulse" }
  ];
  var TABS = [
    { id: "home", href: "/", label: "Home", icon: "home" },
    { id: "network", href: "/network.html", label: "Network", icon: "radio" },
    { id: "scan", href: "/scanner.html", label: "Scan", icon: "scan" },
    { id: "sms", href: "/sms.html", label: "SMS", icon: "sms" },
    { id: "more", href: "/more.html", label: "More", icon: "more" }
  ];

  function icon(name) {
    var p = {
      home: '<path d="M4 10.5 12 4l8 6.5V20a1 1 0 0 1-1 1h-5v-6H10v6H5a1 1 0 0 1-1-1v-9.5z"/>',
      radio: '<path d="M12 14a2 2 0 1 0 0-4 2 2 0 0 0 0 4z"/><path d="M7.1 16.9a7 7 0 0 1 0-9.8M16.9 7.1a7 7 0 0 1 0 9.8M4.2 19.8a11 11 0 0 1 0-15.6M19.8 4.2a11 11 0 0 1 0 15.6"/>',
      scan: '<circle cx="11" cy="11" r="6"/><path d="m20 20-3.5-3.5"/>',
      sms: '<path d="M5 6h14a1 1 0 0 1 1 1v8a1 1 0 0 1-1 1H9l-4 3v-3H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1z"/>',
      gear: '<circle cx="12" cy="12" r="3"/><path d="M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6l1.4 1.4M17 17l1.4 1.4M18.4 5.6 17 7M7 17l-1.4 1.4"/>',
      chip: '<rect x="7" y="7" width="10" height="10" rx="2"/><path d="M9 3v4M15 3v4M9 17v4M15 17v4M3 9h4M3 15h4M17 9h4M17 15h4"/>',
      pulse: '<path d="M3 12h4l2-5 4 10 2-5h6"/>',
      more: '<circle cx="6" cy="12" r="1.4"/><circle cx="12" cy="12" r="1.4"/><circle cx="18" cy="12" r="1.4"/>',
      sun: '<circle cx="12" cy="12" r="3.5"/><path d="M12 3v2M12 19v2M3 12h2M19 12h2M5.2 5.2l1.4 1.4M17.4 17.4l1.4 1.4M18.8 5.2l-1.4 1.4M6.6 17.4l-1.4 1.4"/>',
      moon: '<path d="M16 3.5A8 8 0 1 0 20.5 14 6.5 6.5 0 0 1 16 3.5z"/>'
    };
    return '<svg viewBox="0 0 24 24" aria-hidden="true">' + (p[name] || "") + "</svg>";
  }

  function savedTheme() {
    var v = localStorage.getItem(THEME_KEY);
    return v === "light" || v === "dark" ? v : "";
  }

  function applyTheme(theme) {
    document.documentElement.setAttribute("data-theme", theme);
    document.documentElement.style.colorScheme = theme;
  }

  function effectiveTheme() {
    return document.documentElement.getAttribute("data-theme") === "dark" ? "dark" : "light";
  }

  function setUserTheme(theme) {
    localStorage.setItem(THEME_KEY, theme);
    applyTheme(theme);
    syncThemeControls();
  }

  function toggleTheme() {
    setUserTheme(effectiveTheme() === "dark" ? "light" : "dark");
  }

  function syncThemeControls() {
    var dark = effectiveTheme() === "dark";
    document.querySelectorAll("[data-theme-choice]").forEach(function (btn) {
      var on = btn.getAttribute("data-theme-choice") === effectiveTheme();
      btn.classList.toggle("is-on", on);
      btn.setAttribute("aria-pressed", on ? "true" : "false");
    });
    var sw = document.querySelector("[data-theme-switch]");
    if (sw) {
      sw.setAttribute("aria-checked", dark ? "true" : "false");
      sw.setAttribute("aria-label", dark ? "Dark mode, on" : "Dark mode, off");
    }
  }

  function readStatus() {
    try {
      return JSON.parse(sessionStorage.getItem(STATUS_KEY) || "null");
    } catch (e) {
      return null;
    }
  }

  function ageText(data, live) {
    if (!data || !data.at) return live ? "Reading device status…" : "Not read yet";
    var sec = Math.max(0, Math.round((Date.now() - data.at) / 1000));
    if (data.refreshing) return "Refreshing…";
    return '<span class="t-full">' + (live ? "Updated " : "Last read ") + "</span>" + sec + "s ago";
  }

  function renderStatus() {
    var slot = document.getElementById("status-slot");
    if (!slot) return;
    var live = document.body.getAttribute("data-page") === "home";
    var data = readStatus();
    var stale = data && data.failStreak >= 3;
    if (!slot.firstChild) {
      slot.innerHTML =
        '<div class="status" id="status-bar">' +
          '<div class="status-pills">' +
            '<span class="pill" id="st-conn">—</span>' +
            '<span class="pill" id="st-sim">—</span>' +
            '<span class="pill" id="st-op">—</span>' +
            '<span class="pill" id="st-mode">—</span>' +
            '<span class="pill" id="st-sig"><span class="pill-k">Signal </span><b class="sig-pct"></b> <span class="sig-word pill-v">—</span></span>' +
          "</div>" +
          '<div class="status-time" id="st-time"><i class="dot"></i><span></span></div>' +
        "</div>" +
        '<div class="banner" id="st-banner" hidden></div>';
    }
    var bar = document.getElementById("status-bar");
    bar.classList.toggle("is-stale", !!stale);
    bar.classList.toggle("is-live", live);
    document.getElementById("st-conn").textContent = data && data.conn ? data.conn : "—";
    document.getElementById("st-conn").classList.toggle("is-ok", !!data && data.conn === "Connected");
    document.getElementById("st-sim").innerHTML = '<span class="pill-k">SIM </span><span class="pill-v"></span>';
    document.querySelector("#st-sim .pill-v").textContent = data && data.sim ? data.sim : "—";
    document.getElementById("st-op").textContent = data && data.op ? data.op : "—";
    document.getElementById("st-mode").innerHTML = '<span class="pill-k">Mode </span><span class="pill-v"></span>';
    document.querySelector("#st-mode .pill-v").textContent = data && data.mode ? data.mode : "—";
    document.querySelector("#st-sig .sig-pct").textContent = data && data.pct != null && data.pct !== "" ? data.pct + "%" : "";
    var word = document.querySelector("#st-sig .sig-word");
    var grade = data && data.grade ? data.grade : "";
    var tiers = { "Excellent": "var(--tier-1)", "Good": "var(--tier-2)", "Fair": "var(--tier-3)", "Poor": "var(--tier-4)" };
    word.textContent = grade || "—";
    word.style.color = tiers[grade] || "var(--tx3)";
    var time = document.getElementById("st-time");
    time.querySelector("span").innerHTML = ageText(data, live);
    time.classList.toggle("is-warn", !!stale);
    var banner = document.getElementById("st-banner");
    if (data && data.banner) {
      banner.hidden = false;
      banner.textContent = data.banner;
    } else {
      banner.hidden = true;
    }
  }

  function linkClass(id, active) {
    return id === active ? " is-current" : "";
  }

  function mount() {
    var page = document.body.getAttribute("data-page") || "";
    var aside = document.getElementById("sidebar");
    var tabs = document.getElementById("tabbar");
    if (aside) {
      var groups = ["Network", "Device"];
      var nav = groups.map(function (name) {
        var items = NAV.filter(function (item) { return item.group === name; }).map(function (item) {
          return '<a class="nav-item' + linkClass(item.id, page) + '" href="' + item.href + '" aria-label="' + item.label + '"' +
            (item.id === page ? ' aria-current="page"' : "") + ">" +
            icon(item.icon) + "<span>" + item.label + "</span>" +
            (item.badge ? '<em class="badge">' + item.badge + "</em>" : "") +
            "</a>";
        }).join("");
        return '<div class="nav-group"><p class="nav-label">' + name + "</p>" + items + "</div>";
      }).join("");
      aside.innerHTML =
        '<a class="brand" href="/"><i class="brand-logo">' + icon("radio") + "</i><span><strong>SimpleAdmin</strong><small>192.168.225.1</small></span></a>" +
        '<div class="nav-scroll" id="nav-scroll">' + nav + "</div>" +
        '<div class="side-foot" id="side-foot">' +
          '<p class="nav-label">Appearance</p>' +
          '<div class="theme-seg" role="group" aria-label="Appearance">' +
            '<button type="button" data-theme-choice="light" title="Switch to light mode">' + icon("sun") + 'Light</button>' +
            '<button type="button" data-theme-choice="dark" title="Switch to dark mode">' + icon("moon") + 'Dark</button>' +
          "</div>" +
          '<div class="theme-icons">' +
            '<button type="button" data-theme-choice="light" title="Switch to light mode" aria-label="Switch to light mode">' + icon("sun") + "</button>" +
            '<button type="button" data-theme-choice="dark" title="Switch to dark mode" aria-label="Switch to dark mode">' + icon("moon") + "</button>" +
          "</div>" +
          '<small class="version">SimpleAdmin Rev-Alpha-0.9 · <a href="https://github.com/iamromulan/quectel-rgmii-toolkit">By iamromulan</a></small>' +
        "</div>";
      aside.querySelectorAll("[data-theme-choice]").forEach(function (btn) {
        btn.addEventListener("click", function () {
          setUserTheme(btn.getAttribute("data-theme-choice"));
        });
      });
      var scroller = document.getElementById("nav-scroll");
      var foot = document.getElementById("side-foot");
      var syncMask = function () {
        var overflow = scroller.scrollHeight > scroller.clientHeight + 1;
        foot.classList.toggle("has-mask", overflow);
      };
      syncMask();
      window.addEventListener("resize", syncMask);
    }
    if (tabs) {
      var tabPage = TABS.some(function (item) { return item.id === page; }) ? page : "more";
      tabs.innerHTML = TABS.map(function (item) {
        return '<a class="' + (item.id === tabPage ? "is-current" : "") + '" href="' + item.href + '"' +
          (item.id === tabPage ? ' aria-current="page"' : "") + ' aria-label="' + item.label + '">' +
          icon(item.icon) + "<span>" + item.label + "</span></a>";
      }).join("");
    }
    var row = document.querySelector("[data-theme-row]");
    if (row) {
      row.addEventListener("click", function () { toggleTheme(); });
    }
    syncThemeControls();
    renderStatus();
    setInterval(renderStatus, 1000);
    var media = window.matchMedia("(prefers-color-scheme: dark)");
    var onScheme = function (event) {
      if (savedTheme()) return;
      applyTheme(event.matches ? "dark" : "light");
      syncThemeControls();
    };
    if (media.addEventListener) media.addEventListener("change", onScheme);
    else if (media.addListener) media.addListener(onScheme);
  }

  window.Shell = {
    mount: mount,
    renderStatus: renderStatus,
    setUserTheme: setUserTheme,
    icon: icon,
    STATUS_KEY: STATUS_KEY
  };
  mount();
})();
