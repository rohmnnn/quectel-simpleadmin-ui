(function () {
  var currentImei = "";
  var busy = false;
  var infoCommand = 'AT+CGMI;+CGMM;+QGMR;+CIMI;+ICCID;+CGSN;+QMAP="LANIP";+QMAP="WWAN";+CNUM';

  function setResult(id, message, kind) {
    var el = document.getElementById(id);
    el.textContent = message;
    el.className = "result" + (kind ? " is-" + kind : "");
  }

  function setBusy(buttons, value) { buttons.forEach(function (button) { button.disabled = value; }); }

  function sendAT(atcmd) {
    return fetch("/cgi-bin/get_atcommand?" + new URLSearchParams({ atcmd: atcmd }), { cache: "no-store" }).then(function (response) {
      if (!response.ok) throw new Error("Request failed (HTTP " + response.status + ").");
      return response.text();
    }).then(function (text) {
      if (/\b(ERROR|FAIL)\b|\+CME ERROR|\+CMS ERROR/i.test(text)) throw new Error(text.trim() || "The modem rejected the command.");
      return text;
    });
  }

  function lineValue(lines, index, prefix) {
    var line = lines[index] || "";
    if (prefix && line.indexOf(prefix) === 0) line = line.slice(prefix.length);
    return line.trim() || "—";
  }

  function refresh() {
    var button = document.getElementById("device-refresh");
    button.disabled = true;
    setResult("device-result", "Reading device information…");
    sendAT(infoCommand).then(function (text) {
      var lines = text.split(/\r?\n/);
      var fields = {
        manufacturer: lineValue(lines, 1),
        model: lineValue(lines, 3),
        firmware: lineValue(lines, 5),
        imsi: lineValue(lines, 7),
        iccid: lineValue(lines, 9, "+ICCID: "),
        imei: lineValue(lines, 11),
        lan: (lines[13] || "").trim().split(",")[3] || "—",
        ipv4: ((lines[15] || "").trim().split(",")[4] || "—").replace(/"/g, ""),
        ipv6: ((lines[16] || "").trim().split(",")[4] || "—").replace(/"/g, ""),
        phone: ((lines[18] || "").trim().split(",")[1] || "—").replace(/"/g, "")
      };
      ["manufacturer", "model", "firmware", "imsi", "iccid", "imei", "lan", "ipv4", "ipv6", "phone"].forEach(function (key) {
        document.getElementById("info-" + key).textContent = fields[key];
      });
      currentImei = fields.imei;
      setResult("device-result", "Device information loaded.", "success");
    }).catch(function (error) {
      setResult("device-result", error.message, "error");
    }).finally(function () { button.disabled = false; });
  }

  function updateImei() {
    var value = document.getElementById("new-imei").value.trim();
    if (!/^\d{15}$/.test(value)) {
      setResult("imei-result", "Enter a 15-digit IMEI.", "error");
      return;
    }
    if (value === currentImei) {
      setResult("imei-result", "The new IMEI matches the current IMEI.", "error");
      return;
    }
    if (!window.confirm("Change the modem IMEI to " + value + " and restart the modem?")) return;
    if (busy) return;
    var button = document.getElementById("imei-apply");
    busy = true;
    setBusy([button, document.getElementById("device-reboot"), document.getElementById("device-refresh")], true);
    var updateCommand = 'AT+EGMR=1,7,"' + value + '"';
    setResult("imei-result", "Updating IMEI…");
    sendAT(updateCommand).then(function (response) {
      setResult("imei-result", "IMEI updated. Restarting modem… " + response.trim());
      return sendAT("AT+CFUN=1,1");
    }).then(function (response) {
      setResult("imei-result", "IMEI update and modem restart command completed. " + response.trim(), "success");
    }).catch(function (error) {
      setResult("imei-result", error.message, "error");
    }).finally(function () {
      busy = false;
      setBusy([button, document.getElementById("device-reboot"), document.getElementById("device-refresh")], false);
    });
  }

  function reboot() {
    if (!window.confirm("Restart the modem now? Connectivity will be interrupted.")) return;
    var button = document.getElementById("device-reboot");
    setBusy([button, document.getElementById("imei-apply"), document.getElementById("device-refresh")], true);
    sendAT("AT+CFUN=1,1").then(function (text) {
      setResult("imei-result", "Modem restart command sent. " + text.trim(), "success");
    }).catch(function (error) {
      setResult("imei-result", error.message, "error");
    }).finally(function () {
      setBusy([button, document.getElementById("imei-apply"), document.getElementById("device-refresh")], false);
    });
  }

  document.getElementById("device-refresh").addEventListener("click", refresh);
  document.getElementById("imei-apply").addEventListener("click", updateImei);
  document.getElementById("device-reboot").addEventListener("click", reboot);
  document.getElementById("device-at-send").addEventListener("click", function () {
    var command = document.getElementById("device-at-command").value.trim();
    if (!command) {
      setResult("device-at-result", "Enter an AT command.", "error");
      return;
    }
    if (!window.confirm("Send this AT command to the modem?\n\n" + command)) return;
    var button = this;
    button.disabled = true;
    sendAT(command).then(function (text) {
      document.getElementById("device-at-output").value = text;
      setResult("device-at-result", "Command completed.", "success");
    }).catch(function (error) {
      setResult("device-at-result", error.message, "error");
      document.getElementById("device-at-output").value = error.message;
    }).finally(function () { button.disabled = false; });
  });
  refresh();
})();
