(function () {
  var output = document.getElementById("network-output");
  var busy = false;
  var supported = {};
  var locked = {};
  var initial = {};
  var bandTypes = { LTE: "lte_band", NSA: "nsa_nr5g_band", SA: "nr5g_band" };

  function setResult(id, message, kind) {
    var el = document.getElementById(id);
    el.textContent = message;
    el.className = "result" + (kind ? " is-" + kind : "");
  }

  function setBusy(buttons, value) {
    buttons.forEach(function (button) { button.disabled = value; });
  }

  function requestAT(atcmd) {
    return fetch("/cgi-bin/get_atcommand?" + new URLSearchParams({ atcmd: atcmd }), { cache: "no-store" })
      .then(function (response) {
        if (!response.ok) throw new Error("Request failed (HTTP " + response.status + ").");
        return response.text();
      });
  }

  function writeAT(atcmd) {
    if (!window.confirm("Apply this modem command?\n\n" + atcmd)) return Promise.resolve(null);
    if (busy) return Promise.reject(new Error("A modem request is already in progress."));
    busy = true;
    return requestAT(atcmd).then(function (text) {
      if (/\b(ERROR|FAIL)\b|\+CME ERROR|\+CMS ERROR/i.test(text)) throw new Error(text.trim() || "The modem rejected the command.");
      return text;
    }).finally(function () { busy = false; });
  }

  function extractBandMap(text) {
    var found = {};
    var pattern = /"([^"]+)",([0-9:]+)/g;
    var match;
    while ((match = pattern.exec(text)) !== null) found[match[1]] = match[2].split(":").filter(Boolean);
    return found;
  }

  function renderBands() {
    var mode = document.getElementById("networkModeBand").value;
    var list = supported[bandTypes[mode]] || [];
    var current = locked[bandTypes[mode]] || [];
    var root = document.getElementById("band-options");
    root.replaceChildren();
    if (!list.length) {
      root.textContent = "No supported bands were returned by the modem.";
      return;
    }
    list.forEach(function (band) {
      var label = document.createElement("label");
      label.className = "check-field";
      var input = document.createElement("input");
      input.type = "checkbox";
      input.value = band;
      input.checked = current.indexOf(band) !== -1;
      label.appendChild(input);
      label.appendChild(document.createTextNode((mode === "LTE" ? "B" : "n") + band));
      root.appendChild(label);
    });
  }

  function parseCurrent(text) {
    var match;
    match = /\+QUIMSLOT:\s*(\d+)/.exec(text);
    if (match) document.getElementById("sim-slot").value = match[1];
    match = /\+CGDCONT:\s*1,"([^"]+)","([^"]*)"/.exec(text);
    if (match) {
      document.getElementById("apn-ip").value = ({ IPV4: "1", IPV6: "2", IPV4V6: "3", PPP: "4" })[match[1]] || "3";
      document.getElementById("apn").value = match[2];
    }
    match = /\+QNWPREFCFG:\s*"mode_pref",([^,\r\n]+)/.exec(text);
    if (match) document.getElementById("pref-mode").value = match[1].replace(/"/g, "").trim();
    match = /\+QNWPREFCFG:\s*"nr5g_disable_mode",(\d+)/.exec(text);
    if (match) document.getElementById("nr-mode").value = match[1];
    initial = {
      apn: document.getElementById("apn").value,
      ip: document.getElementById("apn-ip").value,
      sim: document.getElementById("sim-slot").value,
      mode: document.getElementById("pref-mode").value,
      nr: document.getElementById("nr-mode").value
    };
  }

  function refresh() {
    output.textContent = "Reading network settings…";
    var provider = document.getElementById("providerBands").checked;
    var supportedCommand = provider ? 'AT+QNWPREFCFG="ue_capability_band"' : 'AT+QNWPREFCFG="policy_band"';
    return requestAT(supportedCommand).then(function (supportedText) {
      supported = extractBandMap(supportedText);
      return requestAT('AT+QNWPREFCFG="lte_band";+QNWPREFCFG= "nsa_nr5g_band";+QNWPREFCFG= "nr5g_band"');
    }).then(function (lockedText) {
      locked = extractBandMap(lockedText);
      renderBands();
      return requestAT('AT+QUIMSLOT?;+CGCONTRDP=1;+QNWLOCK="common/4g";+QNWLOCK="common/5g";+QNWPREFCFG="mode_pref";+QNWPREFCFG="nr5g_disable_mode";+QCAINFO;+CGDCONT?');
    }).then(function (settingsText) {
      parseCurrent(settingsText);
      output.textContent = settingsText.trim() || "The modem returned an empty response.";
      setResult("preferences-result", "Current network settings loaded.", "success");
    }).catch(function (error) {
      output.textContent = error.message;
      setResult("preferences-result", error.message, "error");
    });
  }

  function applyPreferences() {
    var apn = document.getElementById("apn").value.trim();
    if (/[";\r\n]/.test(apn)) {
      setResult("preferences-result", "APN cannot contain quotes, semicolons, or line breaks.", "error");
      return;
    }
    var commands = [];
    if (apn !== initial.apn || document.getElementById("apn-ip").value !== initial.ip) {
      var ip = { "1": "IPV4", "2": "IPV6", "3": "IPV4V6", "4": "PPP" }[document.getElementById("apn-ip").value];
      commands.push('+CGDCONT=1,"' + ip + '","' + apn + '"');
    }
    var sim = document.getElementById("sim-slot").value;
    if (sim !== initial.sim) commands.push("+QUIMSLOT=" + sim);
    var mode = document.getElementById("pref-mode").value;
    if (mode !== initial.mode) commands.push('+QNWPREFCFG="mode_pref",' + mode);
    var nr = document.getElementById("nr-mode").value;
    if (nr !== initial.nr) commands.push('+QNWPREFCFG="nr5g_disable_mode",' + nr);
    if (!commands.length) {
      setResult("preferences-result", "No changes to apply.", "");
      return;
    }
    if (sim !== initial.sim) commands.push("+CFUN=1,1");
    var button = document.getElementById("preferences-apply");
    setBusy([button], true);
    writeAT("AT+" + commands.join(";")).then(function (text) {
      if (text !== null) {
        setResult("preferences-result", "Settings applied. Modem response: " + text.trim(), "success");
        return refresh();
      }
    }).catch(function (error) {
      setResult("preferences-result", error.message, "error");
    }).finally(function () { setBusy([button], false); });
  }

  function applyBands(restore) {
    var mode = document.getElementById("networkModeBand").value;
    var command;
    if (restore) command = 'AT+QNWPREFCFG="restore_band"';
    else {
      var selected = Array.prototype.map.call(document.querySelectorAll("#band-options input:checked"), function (input) { return input.value; });
      if (!selected.length) {
        setResult("band-result", "Select at least one supported band.", "error");
        return;
      }
      command = 'AT+QNWPREFCFG="' + bandTypes[mode] + '",' + selected.join(":");
    }
    var buttons = [document.getElementById("band-apply"), document.getElementById("band-restore")];
    setBusy(buttons, true);
    writeAT(command).then(function (text) {
      if (text !== null) {
        setResult("band-result", "Band settings applied. " + text.trim(), "success");
        return refresh();
      }
    }).catch(function (error) {
      setResult("band-result", error.message, "error");
    }).finally(function () { setBusy(buttons, false); });
  }

  function applyCellLock(kind, action) {
    var command;
    if (action === "unlock") {
      command = kind === "lte" ? 'AT+QNWLOCK="common/4g",0' : 'AT+QNWLOCK="common/5g,0"';
    } else if (kind === "lte") {
      var count = Number(document.getElementById("lte-count").value);
      if (!Number.isInteger(count) || count < 1 || count > 10) throw new Error("Enter a cell count from 1 to 10.");
      var pairs = [];
      for (var i = 1; i <= count; i++) {
        var earfcn = document.getElementById("lte-earfcn-" + i).value.trim();
        var pci = document.getElementById("lte-pci-" + i).value.trim();
        if (!/^\d+$/.test(earfcn) || !/^\d+$/.test(pci)) throw new Error("Enter a numeric EARFCN and PCI for each cell.");
        pairs.push(earfcn, pci);
      }
      command = 'AT+QNWLOCK="common/4g",' + count + "," + pairs.join(",");
    } else {
      var values = ["nr-earfcn", "nr-pci", "nr-scs", "nr-band"].map(function (id) { return document.getElementById(id).value.trim(); });
      if (!values.every(function (value) { return /^\d+$/.test(value); })) throw new Error("Enter numeric EARFCN, PCI, SCS, and band values.");
      command = 'AT+QNWLOCK="common/5g",' + values.join(",");
    }
    var ids = kind === "lte" ? ["lte-lock-apply", "lte-unlock"] : ["nr-lock-apply", "nr-unlock"];
    var buttons = ids.map(function (id) { return document.getElementById(id); });
    setBusy(buttons, true);
    writeAT(command).then(function (text) {
      if (text !== null) setResult("cell-result", "Cell-lock command completed. " + text.trim(), "success");
    }).catch(function (error) {
      setResult("cell-result", error.message, "error");
    }).finally(function () { setBusy(buttons, false); });
  }

  function renderLteFields() {
    var count = Math.max(1, Math.min(10, Number(document.getElementById("lte-count").value) || 1));
    var root = document.getElementById("lte-lock-fields");
    root.replaceChildren();
    for (var i = 1; i <= count; i++) {
      var group = document.createElement("div");
      group.className = "form-grid";
      group.innerHTML = '<label class="field"><span>LTE cell ' + i + ' EARFCN</span><input id="lte-earfcn-' + i + '" type="number" min="0"></label>' +
        '<label class="field"><span>LTE cell ' + i + ' PCI</span><input id="lte-pci-' + i + '" type="number" min="0" max="503"></label>';
      root.appendChild(group);
    }
  }

  document.getElementById("network-refresh").addEventListener("click", refresh);
  document.getElementById("providerBands").addEventListener("change", refresh);
  document.getElementById("networkModeBand").addEventListener("change", renderBands);
  document.getElementById("band-apply").addEventListener("click", function () { applyBands(false); });
  document.getElementById("band-restore").addEventListener("click", function () { applyBands(true); });
  document.getElementById("preferences-apply").addEventListener("click", applyPreferences);
  document.getElementById("lte-count").addEventListener("change", renderLteFields);
  document.getElementById("lte-lock-apply").addEventListener("click", function () {
    try { applyCellLock("lte", "lock"); } catch (error) { setResult("cell-result", error.message, "error"); }
  });
  document.getElementById("nr-lock-apply").addEventListener("click", function () {
    try { applyCellLock("nr", "lock"); } catch (error) { setResult("cell-result", error.message, "error"); }
  });
  document.getElementById("lte-unlock").addEventListener("click", function () { applyCellLock("lte", "unlock"); });
  document.getElementById("nr-unlock").addEventListener("click", function () { applyCellLock("nr", "unlock"); });
  renderLteFields();
  refresh();
})();
