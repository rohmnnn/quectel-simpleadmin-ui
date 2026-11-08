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
    fields: fields
  };
})();
