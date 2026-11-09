/**
 * Shared modem request layer (loaded before every page script).
 *
 * Why it exists:
 *  - The modem has ONE AT port. Parallel requests queue up inside the device and time out,
 *    so every AT request goes through a single queue here.
 *  - Every request has a timeout, so a page can never stay on "loading" forever.
 *  - An AT response is judged by its FINAL result line only. A text that merely contains the
 *    word "ERROR" (for example inside an SMS) is not a failure.
 *  - Commands that restart or disconnect the modem (AT+CFUN=1,1 ...) are sent fire-and-forget.
 *    The page then counts down and waits for the modem to answer again.
 */
(function () {
  "use strict";

  var queue = Promise.resolve();
  var DEFAULT_TIMEOUT = 8000;
  var COOLDOWN_MS = 3000;
  var lastTimeoutAt = 0;

  // The device script (cgi-bin/get_atcommand) keeps re-sending the command in a loop until the modem
  // answers OK or ERROR, and it keeps running after the browser gave up. So after a timeout the next
  // request waits a few seconds, otherwise two scripts fight over the single AT port.
  function enqueue(task) {
    var run = queue.then(function () {
      var wait = lastTimeoutAt + COOLDOWN_MS - Date.now();
      return wait > 0 ? sleep(wait).then(task) : task();
    });
    queue = run.catch(function () {});
    return run;
  }

  // options.allowHttpError: return the body even for HTTP 4xx/5xx. cgi-bin/send_sms prints no
  // Content-type header, so the web server may answer 500 although the SMS was sent.
  function fetchText(url, timeoutMs, options) {
    options = options || {};
    var controller = typeof AbortController === "function" ? new AbortController() : null;
    var timer = controller ? setTimeout(function () { controller.abort(); }, timeoutMs || DEFAULT_TIMEOUT) : null;
    var init = { cache: "no-store" };
    if (controller) init.signal = controller.signal;
    return fetch(url, init).then(function (response) {
      if (response.status === 401) {
        // Session login (login.html): go back to the login page. With plain web-server auth the browser handles it.
        if (window.SA_AUTH && window.SA_AUTH.mode === "session" && window.SA_AUTH.goLogin) window.SA_AUTH.goLogin();
        var denied = new Error("You are not logged in or the session expired (HTTP 401).");
        denied.unauthorized = true;
        throw denied;
      }
      if (!response.ok && !options.allowHttpError) throw new Error("Request failed (HTTP " + response.status + ").");
      return response.text();
    }).catch(function (error) {
      if (error && error.name === "AbortError") {
        lastTimeoutAt = Date.now();
        var timeout = new Error("The device did not answer within " + Math.round((timeoutMs || DEFAULT_TIMEOUT) / 1000) + " s.");
        timeout.timedOut = true;
        throw timeout;
      }
      throw error;
    }).finally(function () { if (timer) clearTimeout(timer); });
  }

  function nonEmptyLines(text) {
    return String(text || "").split(/\r?\n/).map(function (line) { return line.trim(); }).filter(Boolean);
  }

  var ERROR_LINE = /^(\+CM[ES] ERROR.*|ERROR)$/i;

  // "" when the final result line is not an error.
  function finalError(text) {
    var lines = nonEmptyLines(text);
    if (!lines.length) return "";
    var last = lines[lines.length - 1];
    return ERROR_LINE.test(last) ? last : "";
  }

  // First error line anywhere (for endpoints that never echo message text, such as send_sms).
  function anyErrorLine(text) {
    var lines = nonEmptyLines(text);
    for (var i = 0; i < lines.length; i++) {
      if (/\+CM[ES] ERROR/i.test(lines[i]) || /^ERROR$/i.test(lines[i])) return lines[i];
    }
    return "";
  }

  // ONE AT command per request: a failing command never hides the results of the others.
  function at(cmd, options) {
    options = options || {};
    var endpoint = options.endpoint || "/cgi-bin/get_atcommand";
    return enqueue(function () {
      return fetchText(endpoint + "?" + new URLSearchParams({ atcmd: cmd }), options.timeout || DEFAULT_TIMEOUT);
    }).then(function (text) {
      var problem = finalError(text);
      if (problem) {
        var error = new Error(problem);
        error.modemError = true;
        throw error;
      }
      return text;
    });
  }

  // Like at() but never rejects: {ok, text, error, timedOut}.
  function soft(cmd, options) {
    return at(cmd, options).then(function (text) {
      return { ok: true, text: text, error: "", timedOut: false };
    }, function (error) {
      return { ok: false, text: "", error: error.message, timedOut: !!error.timedOut };
    });
  }

  function sleep(ms) { return new Promise(function (resolve) { setTimeout(resolve, ms); }); }

  // Fire-and-forget for commands that restart or disconnect the modem.
  function send(cmd) {
    return enqueue(function () {
      fetch("/cgi-bin/get_atcommand?" + new URLSearchParams({ atcmd: cmd }), { cache: "no-store" }).then(function (r) { return r.text(); }).catch(function () {});
      return sleep(800);
    });
  }

  function waitForModem(maxMs, onStatus) {
    var started = Date.now();
    function attempt() {
      var left = maxMs - (Date.now() - started);
      if (left <= 0) return Promise.resolve(false);
      if (onStatus) onStatus("Waiting for the modem to answer… (" + Math.ceil(left / 1000) + " s left)");
      return soft("ATI", { timeout: 4000 }).then(function (r) {
        if (r.ok) return true;
        return sleep(3000).then(attempt);
      });
    }
    return attempt();
  }

  /**
   * Send a restart command, count down, then wait until the modem answers again.
   * options: { command, seconds (default 40), maxWait (default 90000), onStatus(message) }
   * Resolves true when the modem answers again, false when it never does.
   */
  function reboot(options) {
    options = options || {};
    var seconds = options.seconds == null ? 40 : options.seconds;
    var onStatus = options.onStatus || function () {};
    onStatus("Restart command sent…");
    return send(options.command || "AT+CFUN=1,1").then(function () {
      return new Promise(function (resolve) {
        var left = seconds;
        onStatus("The modem is restarting. Please wait " + left + " s.");
        var timer = setInterval(function () {
          left--;
          if (left <= 0) { clearInterval(timer); resolve(); }
          else onStatus("The modem is restarting. Please wait " + left + " s.");
        }, 1000);
      });
    }).then(function () {
      return waitForModem(options.maxWait || 90000, onStatus);
    });
  }

  // Needs an immediate-restart command (so the caller must not wait for its answer).
  function isRestartCommand(cmd) {
    return /(^|;)\s*(AT)?\+?CFUN\s*=\s*1\s*,\s*1\b/i.test(String(cmd || "")) || /QPOWD/i.test(String(cmd || ""));
  }

  /* ---------- response helpers ---------- */

  function lines(text, prefix) {
    return nonEmptyLines(text).filter(function (line) { return line.indexOf(prefix) === 0; });
  }

  function line(text, prefix) { return lines(text, prefix)[0] || ""; }

  // Split the payload after "+CMD:" on commas, respecting quotes. Quotes are removed.
  function fields(lineText) {
    var payload = String(lineText || "");
    payload = payload.substring(payload.indexOf(":") + 1);
    var values = [];
    var current = "";
    var quoted = false;
    for (var i = 0; i < payload.length; i++) {
      var ch = payload.charAt(i);
      if (ch === '"') quoted = !quoted;
      else if (ch === "," && !quoted) { values.push(current.trim()); current = ""; }
      else current += ch;
    }
    values.push(current.trim());
    return values;
  }


  /* ---------- IP addresses (+CGPADDR / +CGCONTRDP) ---------- */

  // 3GPP allows an IPv6 address to be printed as 16 dotted decimal bytes ("32.1.13.184.0.0..."),
  // and +CGCONTRDP appends the subnet mask (8 bytes for IPv4, 32 for IPv6). Convert to normal text.
  function bytesToIpv6(bytes) {
    var groups = [];
    for (var i = 0; i < 16; i += 2) groups.push(((bytes[i] << 8) | bytes[i + 1]).toString(16));
    var best = -1, bestLen = 0, cur = -1, curLen = 0;
    for (var g = 0; g < 8; g++) {
      if (groups[g] === "0") {
        if (cur < 0) { cur = g; curLen = 0; }
        curLen++;
        if (curLen > bestLen) { best = cur; bestLen = curLen; }
      } else { cur = -1; curLen = 0; }
    }
    if (bestLen < 2) return groups.join(":");
    return groups.slice(0, best).join(":") + "::" + groups.slice(best + bestLen).join(":");
  }

  // -> {family: 4|6, value} or null
  function classifyAddress(token) {
    var t = String(token || "").replace(/"/g, "").trim().split("/")[0];
    if (!t) return null;
    if (t.indexOf(":") !== -1) return /^[0-9a-f:.]+$/i.test(t) ? { family: 6, value: t.toLowerCase() } : null;
    if (!/^\d{1,3}(\.\d{1,3})+$/.test(t)) return null;
    var nums = t.split(".").map(Number);
    if (nums.some(function (n) { return n > 255; })) return null;
    if (nums.length === 4 || nums.length === 8) {
      var v4 = nums.slice(0, 4).join(".");
      return v4 === "0.0.0.0" ? null : { family: 4, value: v4 };
    }
    if (nums.length === 16 || nums.length === 32) {
      var allZero = nums.slice(0, 16).every(function (n) { return n === 0; });
      return allZero ? null : { family: 6, value: bytesToIpv6(nums.slice(0, 16)) };
    }
    return null;
  }

  // Reads every "+CGPADDR:" / "+CGCONTRDP:" line of a response. Prefers a global IPv6 over fe80::.
  function parseAddresses(text) {
    var found = { v4: "", v6: "", all: [] };
    function add(token) {
      var a = classifyAddress(token);
      if (!a) return;
      found.all.push(a.value);
      if (a.family === 4 && !found.v4) found.v4 = a.value;
      if (a.family === 6 && (!found.v6 || (/^fe80/.test(found.v6) && !/^fe80/.test(a.value)))) found.v6 = a.value;
    }
    lines(text, "+CGPADDR:").forEach(function (l) { fields(l).slice(1).forEach(add); });
    lines(text, "+CGCONTRDP:").forEach(function (l) { add(fields(l)[3]); });
    return found;
  }

  /* ---------- cell lock (AT+QNWLOCK) ---------- */

  var NR_ORDER_KEY = "nr-lock-order";

  // Typical NR subcarrier spacing by band: FDD low bands 15 kHz, mid-band TDD 30 kHz, mmWave 120 kHz.
  function defaultScs(band) {
    var b = Number(String(band).replace(/\D/g, ""));
    if ([38, 40, 41, 46, 48, 77, 78, 79, 90, 96, 102, 104].indexOf(b) !== -1) return 30;
    if (b >= 257 && b <= 262) return 120;
    return 15;
  }

  function lockLte(earfcn, pci) {
    return at('AT+QNWLOCK="common/4g",1,' + Number(earfcn) + "," + Number(pci), { timeout: 12000 });
  }

  // Quectel documents common/5g as <PCI>,<ARFCN>,<SCS>,<BAND>; the original SimpleAdmin sent ARFCN first.
  // PCI (0-1007) and ARFCN (large) cannot be swapped by accident: a wrong order is rejected, so the other
  // order is tried once and the one that works is remembered.
  function lockNr(pci, arfcn, scs, band) {
    var order = "pci-first";
    try { order = localStorage.getItem(NR_ORDER_KEY) === "arfcn-first" ? "arfcn-first" : "pci-first"; } catch (e) { /* ignore */ }
    function build(o) {
      var pair = o === "arfcn-first" ? [Number(arfcn), Number(pci)] : [Number(pci), Number(arfcn)];
      return 'AT+QNWLOCK="common/5g",' + pair[0] + "," + pair[1] + "," + Number(scs) + "," + Number(String(band).replace(/\D/g, ""));
    }
    var other = order === "pci-first" ? "arfcn-first" : "pci-first";
    return at(build(order), { timeout: 12000 }).then(function () {
      return { command: build(order) };
    }, function (error) {
      if (!error.modemError) throw error;
      return at(build(other), { timeout: 12000 }).then(function () {
        try { localStorage.setItem(NR_ORDER_KEY, other); } catch (e) { /* ignore */ }
        return { command: build(other) };
      }, function () { throw error; });
    });
  }

  function unlockCell(kind) {
    return at('AT+QNWLOCK="common/' + (kind === "4g" ? "4g" : "5g") + '",0', { timeout: 12000 });
  }

  // Deregister and register again so a new lock is used right away.
  function reattach() {
    return at("AT+COPS=2", { timeout: 15000 }).then(function () { return at("AT+COPS=0", { timeout: 90000 }); });
  }

  window.AT = {
    enqueue: enqueue,
    fetchText: fetchText,
    at: at,
    soft: soft,
    send: send,
    sleep: sleep,
    reboot: reboot,
    waitForModem: waitForModem,
    isRestartCommand: isRestartCommand,
    finalError: finalError,
    anyErrorLine: anyErrorLine,
    lines: lines,
    line: line,
    fields: fields,
    parseAddresses: parseAddresses,
    cellLock: { defaultScs: defaultScs, lockLte: lockLte, lockNr: lockNr, unlock: unlockCell, reattach: reattach }
  };
})();
