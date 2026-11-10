(function () {
  "use strict";

  var currentImei = "";
  var busy = false;

  function $(id) { return document.getElementById(id); }

  function setResult(id, message, kind) {
    var el = $(id);
    el.textContent = message;
    el.className = "result" + (id === "device-result" ? "" : " field-wide") + (kind ? " is-" + kind : "");
  }

  function guard(resultId, task) {
    if (busy) return Promise.resolve();
    busy = true;
    Array.prototype.forEach.call(document.querySelectorAll("#page button"), function (b) { b.disabled = true; });
    return Promise.resolve().then(task).catch(function (error) {
      setResult(resultId, error && error.message ? error.message : "Unexpected error.", "error");
    }).finally(function () {
      busy = false;
      Array.prototype.forEach.call(document.querySelectorAll("#page button"), function (b) { b.disabled = false; });
    });
  }

  function rebootFlow(resultId) {
    return AT.reboot({ command: "AT+CFUN=1,1", seconds: 40, onStatus: function (m) { setResult(resultId, m); } }).then(function (back) {
      setResult(resultId, back ? "The modem is back online." : "The modem did not answer after 90 s. Check the device, then reload this page.", back ? "success" : "error");
      if (back) return refresh();
    });
  }

  // First line of a plain response that is not the echoed command or OK.
  function plainValue(text, cmd) {
    var lines = String(text || "").split(/\r?\n/).map(function (l) { return l.trim(); }).filter(Boolean);
    for (var i = 0; i < lines.length; i++) {
      if (/^OK$/i.test(lines[i])) continue;
      if (lines[i].toUpperCase() === String(cmd).toUpperCase()) continue;
      return lines[i].replace(/^"|"$/g, "");
    }
    return "";
  }

  function prefixValue(text, prefix) {
    var line = AT.line(text, prefix);
    return line ? line.slice(prefix.length).replace(/"/g, "").trim() : "";
  }

  function firstOk(commands, handle) {
    // tries the commands in order and stops at the first one the modem accepts
    return commands.reduce(function (chain, cmd) {
      return chain.then(function (found) {
        if (found) return found;
        return AT.soft(cmd).then(function (r) { return r.ok ? handle(r.text, cmd) || "" : ""; });
      });
    }, Promise.resolve(""));
  }

  function set(key, value) { $("info-" + key).textContent = value || "—"; }

  // Each value is read with its OWN command and parsed by prefix. The old page sent one chained
  // command and read fixed line numbers, so a single rejected command shifted every field.
  function refresh() {
    setResult("device-result", "Reading device information…");
    var missing = [];
    function track(name, value) { if (!value) missing.push(name); return value; }

    return firstOk(["AT+CGMI"], plainValue).then(function (v) { set("manufacturer", track("manufacturer", v));
      return firstOk(["AT+CGMM"], plainValue);
    }).then(function (v) { set("model", track("model", v));
      return firstOk(["AT+QGMR", "AT+CGMR"], plainValue);
    }).then(function (v) { set("firmware", track("firmware", v));
      return firstOk(["AT+CIMI"], plainValue);
    }).then(function (v) { set("imsi", track("IMSI", v));
      return firstOk(["AT+QCCID", "AT+ICCID"], function (text) { return prefixValue(text, "+QCCID:") || prefixValue(text, "+ICCID:") || plainValue(text, ""); });
    }).then(function (v) { set("iccid", track("ICCID", v));
      return firstOk(["AT+CGSN"], function (text) { var m = /\b(\d{15})\b/.exec(text); return m ? m[1] : plainValue(text, "AT+CGSN"); });
    }).then(function (v) { currentImei = v; set("imei", track("IMEI", v));
      return firstOk(['AT+QMAP="LANIP"'], function (text) { return AT.fields(AT.line(text, "+QMAP:"))[3] || ""; });
    }).then(function (v) { set("lan", track("LAN IP", v));
      return AT.soft('AT+QMAP="WWAN"');
    }).then(function (r) {
      var found = r.ok ? AT.parseAddresses(r.text) : { v4: "", v6: "" };
      if (found.v4 && found.v6) return found;
      return AT.soft("AT+CGPADDR=1").then(function (r2) {
        var more = r2.ok ? AT.parseAddresses(r2.text) : { v4: "", v6: "" };
        return { v4: found.v4 || more.v4, v6: found.v6 || more.v6 };
      });
    }).then(function (found) {
      set("ipv4", found.v4);
      set("ipv6", found.v6);
      if (!found.v4 && !found.v6) missing.push("WWAN IP");
      return firstOk(["AT+CNUM"], function (text) { return AT.fields(AT.line(text, "+CNUM:"))[1] || ""; });
    }).then(function (v) {
      set("phone", v);   // a SIM often has no stored number: not reported as missing
      setResult("device-result", missing.length ? "Loaded. Not available on this modem or SIM: " + missing.join(", ") + "." : "Device information loaded.", "success");
    }).catch(function (error) {
      setResult("device-result", error.message, "error");
    });
  }

  function updateImei() {
    var value = $("new-imei").value.trim();
    if (!/^\d{15}$/.test(value)) { setResult("imei-result", "Enter a 15-digit IMEI.", "error"); return; }
    if (value === currentImei) { setResult("imei-result", "The new IMEI matches the current IMEI.", "error"); return; }
    if (!window.confirm("Change the modem IMEI to " + value + " and restart the modem?\n\nNote: AT+EGMR is not documented for the RG50xQ, so the modem may reject it. Changing an IMEI is not allowed in some countries.")) return;
    guard("imei-result", function () {
      setResult("imei-result", "Updating IMEI…");
      return AT.at('AT+EGMR=1,7,"' + value + '"', { timeout: 12000 }).then(function () {
        return rebootFlow("imei-result");   // restart only after the IMEI command was accepted
      });
    });
  }

  function reboot() {
    if (!window.confirm("Restart the modem now? Connectivity will be interrupted.")) return;
    guard("imei-result", function () { return rebootFlow("imei-result"); });
  }

  function sendTerminal() {
    var command = $("device-at-command").value.trim();
    if (!command) { setResult("device-at-result", "Enter an AT command.", "error"); return; }
    if (!window.confirm("Send this AT command to the modem?\n\n" + command)) return;
    guard("device-at-result", function () {
      var parts = command.split(";").map(function (p) { return p.trim(); }).filter(Boolean).map(function (p, i) { return i === 0 || /^AT/i.test(p) ? p : "AT" + p; });
      var log = [];
      $("device-at-output").value = "";
      setResult("device-at-result", "Waiting for the modem…");
      return parts.reduce(function (chain, part) {
        return chain.then(function (stop) {
          if (stop) return true;
          if (AT.isRestartCommand(part)) {
            log.push("> " + part + "\n(restart command sent)");
            $("device-at-output").value = log.join("\n\n");
            return rebootFlow("device-at-result").then(function () { return true; });
          }
          return AT.at(part, { timeout: 15000 }).then(function (text) {
            log.push("> " + part + "\n" + (text.trim() || "OK"));
            $("device-at-output").value = log.join("\n\n");
            return false;
          }, function (error) {
            log.push("> " + part + "\n" + error.message);
            $("device-at-output").value = log.join("\n\n");
            setResult("device-at-result", error.message, "error");
            return true;
          });
        });
      }, Promise.resolve(false)).then(function (stopped) {
        if (!stopped) setResult("device-at-result", "Command completed.", "success");
      });
    });
  }

  $("device-refresh").addEventListener("click", function () { guard("device-result", refresh); });
  $("imei-apply").addEventListener("click", updateImei);
  $("device-reboot").addEventListener("click", reboot);
  $("device-at-send").addEventListener("click", sendTerminal);
  refresh();
})();
