(function () {
  "use strict";

  var busy = false;
  // null = not checked yet, true = the modem answered, false = the modem rejected the query
  var support = { mpdn: null, dns: null, usbnet: null };
  var FEATURE_LABEL = { mpdn: "IP passthrough (MPDN rules)", dns: "DHCPv4 DNS proxy", usbnet: "USB modem protocol" };

  function $(id) { return document.getElementById(id); }

  function result(id, message, kind) {
    var el = $(id);
    el.textContent = message;
    el.className = "result" + (id === "ttl-result" || id === "terminal-result" || id === "security-result" ? " field-wide" : "") + (kind ? " is-" + kind : "");
  }

  function shortText(text) {
    var clean = String(text || "").replace(/\s+/g, " ").trim();
    return clean.length > 200 ? clean.slice(0, 200) + "…" : clean;
  }

  function featureOf(button) {
    if (button.id === "usbnet-apply") return "usbnet";
    var cmd = button.getAttribute("data-at") || "";
    if (/DHCPV4DNS/i.test(cmd)) return "dns";
    if (/MPDN_RULE|QMAPWAC/i.test(cmd)) return "mpdn";
    return null;
  }

  // Controls whose read command was rejected by the modem stay disabled.
  function applyFeatureState() {
    var missing = Object.keys(support).filter(function (key) { return support[key] === false; });
    $("settings-support").textContent = missing.length
      ? "Not supported by this modem (the AT query was rejected): " + missing.map(function (key) { return FEATURE_LABEL[key]; }).join(", ") +
        ". These commands are not in the RG50xQ AT manual. Use the interface status card below for the options your modem documents."
      : "";
    if (busy) return;   // while an action runs every button stays disabled
    Array.prototype.forEach.call(document.querySelectorAll("#page button"), function (button) {
      var feature = featureOf(button);
      var off = !!feature && support[feature] === false;
      button.disabled = off;
      if (feature) button.title = off ? "Not supported by this modem" : "";
    });
    $("usbnet-mode").disabled = support.usbnet === false;
  }

  // One action at a time. Buttons are ALWAYS re-enabled afterwards, even after an error.
  function guard(task) {
    if (busy) return Promise.resolve();
    busy = true;
    Array.prototype.forEach.call(document.querySelectorAll("#page button"), function (button) { button.disabled = true; });
    return Promise.resolve().then(task).catch(function (error) {
      result("settings-result", error && error.message ? error.message : "Unexpected error.", "error");
    }).finally(function () {
      busy = false;
      Array.prototype.forEach.call(document.querySelectorAll("#page button"), function (button) { button.disabled = false; });
      applyFeatureState();
    });
  }

  // "AT+A;+B" -> ["AT+A", "AT+B"]: every command is sent on its own.
  function splitCommands(command) {
    return String(command).split(";").map(function (part) { return part.trim(); }).filter(Boolean).map(function (part, index) {
      return index === 0 || /^AT/i.test(part) ? part : "AT" + part;
    });
  }

  function rebootFlow(resultId) {
    return AT.reboot({ command: "AT+CFUN=1,1", seconds: 40, onStatus: function (message) { result(resultId, message); } }).then(function (back) {
      result(resultId, back ? "The modem is back online." : "The modem did not answer after 90 s. Check the device, then reload this page.", back ? "success" : "error");
      if (back) return Promise.all([readSettings(), readTtl()]);
    });
  }

  /* ---------- settings read ---------- */

  var READS = [
    { key: "mpdn", cmd: 'AT+QMAP="MPDN_RULE"' },
    { key: "dns", cmd: 'AT+QMAP="DHCPV4DNS"' },
    { key: "usbnet", cmd: 'AT+QCFG="usbnet"' }
  ];

  // Each query is sent on its own and read by prefix, never by line number,
  // so one rejected command cannot break the others.
  function readSettings() {
    $("settings-output").textContent = "Reading current modem settings…";
    var out = [];
    return READS.reduce(function (chain, item) {
      return chain.then(function () {
        return AT.soft(item.cmd).then(function (r) {
          if (r.ok) support[item.key] = true;
          else if (!r.timedOut) support[item.key] = false;
          out.push("> " + item.cmd + "\n" + (r.ok ? (r.text.trim() || "(empty response)") : "Not available: " + r.error));
          if (r.ok && item.key === "usbnet") {
            var match = /\+QCFG:\s*"usbnet",(\d)/i.exec(r.text);
            if (match) $("usbnet-mode").value = match[1];
          }
        });
      });
    }, Promise.resolve()).then(function () {
      $("settings-output").textContent = out.join("\n\n");
      applyFeatureState();
    });
  }

  /* ---------- writes ---------- */

  // Sends the commands one after another and stops at the first error.
  function sendChain(command) {
    var parts = splitCommands(command);
    var log = [];
    return parts.reduce(function (chain, part) {
      return chain.then(function () {
        return AT.at(part, { timeout: 12000 }).then(function (text) {
          log.push(text.trim() || "OK");
        });
      });
    }, Promise.resolve()).then(function () { return log.join("\n"); });
  }

  function applyAtCommand(command, afterSuccess) {
    if (!window.confirm("Apply this modem command?\n\n" + command)) return;
    guard(function () {
      result("settings-result", "Sending…");
      return sendChain(command).then(function (text) {
        result("settings-result", "Command completed. " + shortText(text), "success");
        if (afterSuccess) return afterSuccess();
        return AT.sleep(1500).then(readSettings);
      }, function (error) {
        if (error.timedOut) {
          // Some changes briefly drop the network, so the answer may never arrive.
          result("settings-result", "Command sent. The modem did not answer in time, it may still be applying the change. Re-reading in a few seconds…");
          return AT.sleep(4000).then(readSettings);
        }
        result("settings-result", error.message, "error");
      });
    });
  }

  function applyUsbnet() {
    var mode = $("usbnet-mode").value;
    if (!/^[0-3]$/.test(mode)) {
      result("settings-result", "Select a USB networking mode first.", "error");
      return;
    }
    applyAtCommand('AT+QCFG="usbnet",' + mode, function () {
      // Same as the original page: the new USB mode needs a restart. The restart is sent only
      // AFTER the setting was accepted (the old page sent both at once).
      if (window.confirm("The new USB mode takes effect after a restart. Restart the modem now?")) return rebootFlow("settings-result");
      return readSettings();
    });
  }

  /* ---------- interface status (commands documented for the RG50xQ) ---------- */

  var IFACE = [
    { cmd: 'AT+QCFG="data_interface"', timeout: 8000 },
    { cmd: 'AT+QCFG="pcie/mode"', timeout: 8000 },
    { cmd: 'AT+QETH="rgmii"', timeout: 25000 },   // manual: up to 20 s
    { cmd: 'AT+QETH="ipptmac"', timeout: 8000 }
  ];

  function readInterface() {
    guard(function () {
      var out = $("iface-output");
      out.textContent = "Reading…";
      var lines = [];
      return IFACE.reduce(function (chain, item) {
        return chain.then(function () {
          out.textContent = lines.join("\n\n") + (lines.length ? "\n\n" : "") + "> " + item.cmd + "\n…";
          return AT.soft(item.cmd, { timeout: item.timeout }).then(function (r) {
            lines.push("> " + item.cmd + "\n" + (r.ok ? (r.text.trim() || "(empty response)") : "Not available: " + r.error));
          });
        });
      }, Promise.resolve()).then(function () { out.textContent = lines.join("\n\n"); });
    });
  }

  /* ---------- TTL ---------- */

  function readTtl() {
    return AT.fetchText("/cgi-bin/get_ttl_status", 8000).then(function (body) {
      var data = JSON.parse(body);
      if (!data || data.ttl == null || typeof data.isEnabled !== "boolean" || !Number.isInteger(Number(data.ttl))) {
        throw new Error("The device returned an invalid TTL status.");
      }
      $("ttl-value").value = Number(data.ttl);
      result("ttl-result", data.isEnabled ? "TTL override enabled: " + data.ttl : "TTL override disabled.", "success");
    }).catch(function (error) {
      result("ttl-result", error.message, "error");
    });
  }

  function applyTtl() {
    var value = $("ttl-value").value;
    if (!/^\d+$/.test(value)) {
      result("ttl-result", "Enter a whole-number TTL value of 0 or greater.", "error");
      return;
    }
    if (!window.confirm("Apply TTL value " + value + "?")) return;
    guard(function () {
      result("ttl-result", "Applying…");
      return AT.fetchText("/cgi-bin/set_ttl?" + new URLSearchParams({ ttlvalue: value }), 15000).then(function (text) {
        if (/\b(ERROR|FAIL)\b|\+CME ERROR|\+CMS ERROR/i.test(text)) throw new Error(text.trim() || "The device rejected the TTL value.");
        return readTtl();
      }).catch(function (error) {
        result("ttl-result", error.message, "error");
      });
    });
  }

  /* ---------- AT terminal ---------- */

  function runTerminal(command) {
    var out = $("terminal-output");
    var parts = splitCommands(command);
    var log = [];
    out.value = "";
    result("terminal-result", "Waiting for the modem…");
    return parts.reduce(function (chain, part) {
      return chain.then(function (stop) {
        if (stop) return true;
        if (AT.isRestartCommand(part)) {
          // never wait for the answer of a restart command: the connection dies with the modem
          log.push("> " + part + "\n(restart command sent)");
          out.value = log.join("\n\n");
          return rebootFlow("terminal-result").then(function () { return true; });
        }
        return AT.at(part, { timeout: 15000 }).then(function (text) {
          log.push("> " + part + "\n" + (text.trim() || "OK"));
          out.value = log.join("\n\n");
          return false;
        }, function (error) {
          log.push("> " + part + "\n" + error.message);
          out.value = log.join("\n\n");
          result("terminal-result", error.message, "error");
          return true;
        });
      });
    }, Promise.resolve(false)).then(function (stopped) {
      if (!stopped) result("terminal-result", "Command completed.", "success");
    });
  }

  function resetModem() {
    if (!window.confirm("Reset modem settings with AT&F? This may change device configuration.")) return;
    guard(function () {
      result("terminal-result", "Sending AT&F…");
      return AT.at("AT&F", { timeout: 12000 }).then(function (text) {
        $("terminal-output").value = "> AT&F\n" + (text.trim() || "OK");
        result("terminal-result", "Settings reset.", "success");
        if (window.confirm("Restart the modem now so the reset takes full effect?")) return rebootFlow("terminal-result");
      }, function (error) {
        result("terminal-result", error.message, "error");
      });
    });
  }

  /* ---------- wiring ---------- */

  Array.prototype.forEach.call(document.querySelectorAll("[data-at]"), function (button) {
    button.addEventListener("click", function () { applyAtCommand(button.getAttribute("data-at")); });
  });
  $("usbnet-apply").addEventListener("click", applyUsbnet);
  $("iface-refresh").addEventListener("click", readInterface);
  $("ttl-refresh").addEventListener("click", readTtl);
  $("ttl-apply").addEventListener("click", applyTtl);
  $("user-at-send").addEventListener("click", function () {
    var command = $("user-at-command").value.trim();
    if (!command) { result("terminal-result", "Enter an AT command.", "error"); return; }
    if (!window.confirm("Send this command to the modem?\n\n" + command)) return;
    guard(function () { return runTerminal(command); });
  });
  $("at-reset").addEventListener("click", resetModem);
  $("modem-reboot").addEventListener("click", function () {
    if (!window.confirm("Restart the modem now? Connectivity will be interrupted.")) return;
    guard(function () { return rebootFlow("terminal-result"); });
  });


  /* ---------- security (login password) ---------- */

  if (window.SA_AUTH) {
    SA_AUTH.ready.then(function () {
      if (SA_AUTH.mode !== "session") return;
      $("security-card").style.display = "";
    });
  }

  $("logout-btn").addEventListener("click", function () { SA_AUTH.logout(); });
  $("password-form").addEventListener("submit", function (event) {
    event.preventDefault();
    var current = $("pw-current").value;
    var next = $("pw-new").value;
    if (!current || !next) { result("security-result", "Fill in both password fields.", "error"); return; }
    if (next.length < 8) { result("security-result", "The new password needs at least 8 characters.", "error"); return; }
    if (next !== $("pw-repeat").value) { result("security-result", "The two new passwords are different.", "error"); return; }
    $("pw-save").disabled = true;
    result("security-result", "Saving…");
    var controller = typeof AbortController === "function" ? new AbortController() : null;
    var timer = controller ? setTimeout(function () { controller.abort(); }, 15000) : null;
    fetch("/cgi-bin/auth_password", { method: "POST", body: new URLSearchParams({ current: current, new: next }), credentials: "same-origin", cache: "no-store", signal: controller ? controller.signal : undefined })
      .then(function (response) {
        if (response.status === 401 && window.SA_AUTH && SA_AUTH.mode === "session") {
          return response.json().catch(function () { return {}; }).then(function (data) {
            if (data && data.error) throw new Error(data.error);
            SA_AUTH.goLogin();
          });
        }
        return response.json().catch(function () { return {}; }).then(function (data) {
          if (!response.ok || !data.ok) throw new Error(data && data.error ? data.error : "The password was not changed (HTTP " + response.status + ").");
          $("pw-current").value = $("pw-new").value = $("pw-repeat").value = "";
          result("security-result", "Password changed. Other sessions were signed out.", "success");
        });
      }).catch(function (error) {
        result("security-result", error && error.name === "AbortError" ? "The device did not answer in time." : error.message, "error");
      }).finally(function () { if (timer) clearTimeout(timer); $("pw-save").disabled = false; });
  });

  readSettings();
  readTtl();
})();
