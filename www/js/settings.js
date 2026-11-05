(function () {
  var active = false;

  function result(id, message, kind) {
    var el = document.getElementById(id);
    el.textContent = message;
    el.className = "result" + (kind ? " is-" + kind : "");
  }

  function run(buttons, endpoint, params, confirmation, resultId, outputId) {
    if (active) {
      result(resultId, "A modem request is already in progress.", "error");
      return Promise.resolve(null);
    }
    if (!window.confirm(confirmation)) return Promise.resolve(null);
    active = true;
    buttons.forEach(function (button) { button.disabled = true; });
    result(resultId, "Waiting for the modem…");
    return fetch(endpoint + "?" + new URLSearchParams(params), { cache: "no-store" }).then(function (response) {
      if (!response.ok) throw new Error("Request failed (HTTP " + response.status + ").");
      return response.text();
    }).then(function (text) {
      if (/\b(ERROR|FAIL)\b|\+CME ERROR|\+CMS ERROR/i.test(text)) throw new Error(text.trim() || "The modem rejected the command.");
      if (outputId) document.getElementById(outputId).value = text;
      result(resultId, "Command completed. " + text.trim(), "success");
      return text;
    }).catch(function (error) {
      result(resultId, error.message, "error");
      return null;
    }).finally(function () {
      active = false;
      buttons.forEach(function (button) { button.disabled = false; });
    });
  }

  function applyAtCommand(command, button) {
    run([button], "/cgi-bin/get_atcommand", { atcmd: command }, "Apply this modem command?\n\n" + command, "settings-result", "settings-output")
      .then(function (text) { if (text !== null) return readSettings(); });
  }

  function readSettings() {
    return fetch("/cgi-bin/get_atcommand?" + new URLSearchParams({ atcmd: 'AT+QMAP="MPDN_RULE";+QMAP="DHCPV4DNS";+QCFG="usbnet"' }), { cache: "no-store" })
      .then(function (response) {
        if (!response.ok) throw new Error("Request failed (HTTP " + response.status + ").");
        return response.text();
      }).then(function (text) {
        if (/\b(ERROR|FAIL)\b|\+CME ERROR/i.test(text)) throw new Error(text.trim() || "The modem rejected the query.");
        document.getElementById("settings-output").textContent = text.trim() || "The modem returned an empty response.";
        var match = /\+QCFG:\s*"usbnet",(\d)/.exec(text);
        if (match) document.getElementById("usbnet-mode").value = match[1];
      }).catch(function (error) {
        document.getElementById("settings-output").textContent = error.message;
        result("settings-result", error.message, "error");
      });
  }

  function readTtl() {
    var button = document.getElementById("ttl-refresh");
    button.disabled = true;
    fetch("/cgi-bin/get_ttl_status", { cache: "no-store" }).then(function (response) {
      if (!response.ok) throw new Error("Request failed (HTTP " + response.status + ").");
      return response.json();
    }).then(function (data) {
      if (!data || data.ttl == null || typeof data.isEnabled !== "boolean" || !Number.isInteger(Number(data.ttl))) {
        throw new Error("The device returned an invalid TTL status.");
      }
      document.getElementById("ttl-value").value = Number(data.ttl);
      result("ttl-result", data.isEnabled ? "TTL override enabled: " + data.ttl : "TTL override disabled.", "success");
    }).catch(function (error) {
      result("ttl-result", error.message, "error");
    }).finally(function () { button.disabled = false; });
  }

  document.querySelectorAll("[data-at]").forEach(function (button) {
    button.addEventListener("click", function () { applyAtCommand(button.getAttribute("data-at"), button); });
  });
  document.getElementById("usbnet-apply").addEventListener("click", function () {
    var mode = document.getElementById("usbnet-mode").value;
    if (!/^[0-3]$/.test(mode)) {
      result("settings-result", "Select a USB networking mode first.", "error");
      return;
    }
    applyAtCommand('AT+QCFG="usbnet",' + mode + ";", this);
  });
  document.getElementById("ttl-refresh").addEventListener("click", readTtl);
  document.getElementById("ttl-apply").addEventListener("click", function () {
    var value = document.getElementById("ttl-value").value;
    if (!/^\d+$/.test(value)) {
      result("ttl-result", "Enter a whole-number TTL value of 0 or greater.", "error");
      return;
    }
    run([this, document.getElementById("ttl-refresh")], "/cgi-bin/set_ttl", { ttlvalue: value }, "Apply TTL value " + value + "?", "ttl-result")
      .then(function (text) { if (text !== null) return readTtl(); });
  });
  document.getElementById("user-at-send").addEventListener("click", function () {
    var command = document.getElementById("user-at-command").value.trim();
    if (!command) {
      result("terminal-result", "Enter an AT command.", "error");
      return;
    }
    run([this], "/cgi-bin/user_atcommand", { atcmd: command }, "Send this command to the modem?\n\n" + command, "terminal-result", "terminal-output");
  });
  document.getElementById("at-reset").addEventListener("click", function () {
    run([this], "/cgi-bin/get_atcommand", { atcmd: "AT&F" }, "Reset modem settings with AT&F? This may change device configuration.", "terminal-result", "terminal-output");
  });
  document.getElementById("modem-reboot").addEventListener("click", function () {
    run([this], "/cgi-bin/get_atcommand", { atcmd: "AT+CFUN=1,1" }, "Restart the modem now?", "terminal-result", "terminal-output");
  });

  readSettings();
  readTtl();
})();
