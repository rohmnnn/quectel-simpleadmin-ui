(function () {
  "use strict";

  var output = document.getElementById("network-output");
  var busy = false;
  var refreshing = false;
  var refreshAgain = false;
  var supported = {};
  var locked = {};
  var initial = {};
  var bandTypes = { LTE: "lte_band", NSA: "nsa_nr5g_band", SA: "nr5g_band" };

  function $(id) { return document.getElementById(id); }

  function setResult(id, message, kind) {
    var el = $(id);
    el.textContent = message;
    el.className = "result" + (id === "preferences-result" ? "" : " field-wide") + (kind ? " is-" + kind : "");
  }

  function setAllButtons(disabled) {
    Array.prototype.forEach.call(document.querySelectorAll("#page button"), function (button) { button.disabled = disabled; });
  }

  // One action at a time. Buttons are ALWAYS re-enabled afterwards.
  function guard(resultId, task) {
    if (busy) return Promise.resolve();
    busy = true;
    setAllButtons(true);
    return Promise.resolve().then(task).catch(function (error) {
      setResult(resultId, error && error.message ? error.message : "Unexpected error.", "error");
    }).finally(function () {
      busy = false;
      setAllButtons(false);
      syncSlotControl();
    });
  }

  function rebootFlow(resultId) {
    return AT.reboot({ command: "AT+CFUN=1,1", seconds: 40, onStatus: function (message) { setResult(resultId, message); } }).then(function (back) {
      setResult(resultId, back ? "The modem is back online." : "The modem did not answer after 90 s. Check the device, then reload this page.", back ? "success" : "error");
      if (back) return refresh();
    });
  }

  function setSelect(id, value) {
    var select = $(id);
    var has = Array.prototype.some.call(select.options, function (option) { return option.value === value; });
    if (has) select.value = value;
  }

  var slotSupported = true;
  function syncSlotControl() {
    $("sim-slot").disabled = !slotSupported;
    $("sim-slot").title = slotSupported ? "" : "This modem did not answer AT+QUIMSLOT?";
  }

  /* ---------- reading ---------- */

  function extractBandMap(text) {
    var found = {};
    var pattern = /"([^"]+)",([0-9:]+)/g;
    var match;
    while ((match = pattern.exec(text)) !== null) found[match[1]] = match[2].split(":").filter(Boolean);
    return found;
  }

  function renderBands() {
    var mode = $("networkModeBand").value;
    var list = supported[bandTypes[mode]] || [];
    var current = locked[bandTypes[mode]] || [];
    var root = $("band-options");
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
    var match = /\+QU(?:IM|SIM)SLOT:\s*(\d+)/i.exec(text);
    if (match) setSelect("sim-slot", match[1]);
    match = /\+CGDCONT:\s*1,"([^"]+)","([^"]*)"/.exec(text);
    if (match) {
      setSelect("apn-ip", ({ IPV4: "1", IPV6: "2", IPV4V6: "3", PPP: "4" })[match[1]] || "3");
      $("apn").value = match[2];
    }
    match = /\+QNWPREFCFG:\s*"mode_pref",([^,\r\n]+)/.exec(text);
    if (match) setSelect("pref-mode", match[1].replace(/"/g, "").trim());
    match = /\+QNWPREFCFG:\s*"nr5g_disable_mode",(\d+)/.exec(text);
    if (match) setSelect("nr-mode", match[1]);
    initial = { apn: $("apn").value, ip: $("apn-ip").value, sim: $("sim-slot").value, mode: $("pref-mode").value, nr: $("nr-mode").value };
  }

  // Every query is sent on its own (one failing command must not hide the others).
  function refresh() {
    if (refreshing) { refreshAgain = true; return Promise.resolve(); }
    refreshing = true;
    output.textContent = "Reading network settings…";
    var provider = $("providerBands").checked;
    var log = [];
    var combined = "";
    var okCount = 0;
    var failed = {};

    function read(cmd, timeout) {
      return AT.soft(cmd, { timeout: timeout }).then(function (r) {
        log.push("> " + cmd + "\n" + (r.ok ? (r.text.trim() || "(empty response)") : "Not available: " + r.error));
        if (r.ok) { okCount++; combined += "\n" + r.text; } else failed[cmd] = r.error;
        return r;
      });
    }

    return read(provider ? 'AT+QNWPREFCFG="ue_capability_band"' : 'AT+QNWPREFCFG="policy_band"').then(function (r) {
      supported = r.ok ? extractBandMap(r.text) : {};
      locked = {};
      return ['AT+QNWPREFCFG="lte_band"', 'AT+QNWPREFCFG="nsa_nr5g_band"', 'AT+QNWPREFCFG="nr5g_band"'].reduce(function (chain, cmd) {
        return chain.then(function () {
          return read(cmd).then(function (res) {
            if (res.ok) { var map = extractBandMap(res.text); Object.keys(map).forEach(function (key) { locked[key] = map[key]; }); }
          });
        });
      }, Promise.resolve());
    }).then(function () {
      renderBands();
      return ["AT+QUIMSLOT?", "AT+CGDCONT?", 'AT+QNWPREFCFG="mode_pref"', 'AT+QNWPREFCFG="nr5g_disable_mode"', "AT+QCAINFO", 'AT+QNWLOCK="common/4g"', 'AT+QNWLOCK="common/5g"'].reduce(function (chain, cmd) {
        return chain.then(function () { return read(cmd); });
      }, Promise.resolve());
    }).then(function () {
      slotSupported = !failed["AT+QUIMSLOT?"];
      parseCurrent(combined);
      syncSlotControl();
      output.textContent = log.join("\n\n");
      if (okCount === 0) setResult("preferences-result", "The modem did not answer any query. Check the connection and try again.", "error");
      else setResult("preferences-result", "Current network settings loaded.", "success");
    }).catch(function (error) {
      output.textContent = error.message;
      setResult("preferences-result", error.message, "error");
    }).finally(function () {
      refreshing = false;
      if (refreshAgain) { refreshAgain = false; return refresh(); }
    });
  }

  /* ---------- writing ---------- */

  function runCommands(commands) {
    return commands.reduce(function (chain, cmd) {
      return chain.then(function () {
        return AT.at(cmd, { timeout: 12000 }).catch(function (error) {
          error.message = cmd + " → " + error.message;
          throw error;
        });
      });
    }, Promise.resolve());
  }

  function applyPreferences() {
    var apn = $("apn").value.trim();
    if (/[";\r\n]/.test(apn)) {
      setResult("preferences-result", "APN cannot contain quotes, semicolons, or line breaks.", "error");
      return;
    }
    var commands = [];
    if (apn !== initial.apn || $("apn-ip").value !== initial.ip) {
      var ip = { "1": "IPV4", "2": "IPV6", "3": "IPV4V6", "4": "PPP" }[$("apn-ip").value];
      commands.push('AT+CGDCONT=1,"' + ip + '","' + apn + '"');
    }
    var sim = $("sim-slot").value;
    var simChanged = slotSupported && sim !== initial.sim;
    if (simChanged) commands.push("AT+QUIMSLOT=" + sim);
    if ($("pref-mode").value !== initial.mode) commands.push('AT+QNWPREFCFG="mode_pref",' + $("pref-mode").value);
    if ($("nr-mode").value !== initial.nr) commands.push('AT+QNWPREFCFG="nr5g_disable_mode",' + $("nr-mode").value);
    if (!commands.length) { setResult("preferences-result", "No changes to apply.", ""); return; }
    // NOTE: the old code built "AT+" + "+CGDCONT..." = "AT++CGDCONT" which the modem always rejected.
    if (!window.confirm("Apply these modem commands?\n\n" + commands.join("\n") + (simChanged ? "\n\nThe modem will restart afterwards (SIM slot change)." : ""))) return;
    guard("preferences-result", function () {
      setResult("preferences-result", "Applying…");
      return runCommands(commands).then(function () {
        if (simChanged) return rebootFlow("preferences-result");
        setResult("preferences-result", "Settings applied.", "success");
        return AT.sleep(1000).then(refresh);
      }, function (error) {
        setResult("preferences-result", error.timedOut ? error.message + " The change may still be in progress; refresh in a moment." : error.message, "error");
      });
    });
  }

  function applyBands(restore) {
    var mode = $("networkModeBand").value;
    var type = bandTypes[mode];
    if (restore) {
      if (!window.confirm('Restore the default bands with AT+QNWPREFCFG="restore_band"?')) return;
      guard("band-result", function () {
        setResult("band-result", "Applying…");
        return AT.at('AT+QNWPREFCFG="restore_band"', { timeout: 12000 }).then(function () {
          setResult("band-result", "Default bands restored.", "success");
          return refresh();
        }, function (error) {
          if (!error.modemError) throw error;
          // "restore_band" is not documented for the RG50xQ: fall back to the supported band list.
          var list = supported[type] || [];
          if (!list.length) throw new Error("restore_band was rejected and no supported band list is available.");
          if (!window.confirm("restore_band is not supported by this modem.\n\nEnable all supported " + mode + " bands instead?\n\nAT+QNWPREFCFG=\"" + type + "\"," + list.join(":"))) {
            setResult("band-result", "Nothing was changed.", "");
            return;
          }
          return AT.at('AT+QNWPREFCFG="' + type + '",' + list.join(":"), { timeout: 12000 }).then(function () {
            setResult("band-result", "All supported bands enabled.", "success");
            return refresh();
          });
        });
      });
      return;
    }
    var selected = Array.prototype.map.call(document.querySelectorAll("#band-options input:checked"), function (input) { return input.value; });
    if (!selected.length) { setResult("band-result", "Select at least one supported band.", "error"); return; }
    var command = 'AT+QNWPREFCFG="' + type + '",' + selected.join(":");
    if (!window.confirm("Apply this modem command?\n\n" + command)) return;
    guard("band-result", function () {
      setResult("band-result", "Applying…");
      return AT.at(command, { timeout: 12000 }).then(function (text) {
        setResult("band-result", "Band settings applied. " + text.replace(/\s+/g, " ").trim(), "success");
        return refresh();
      });
    });
  }

  function applyCellLock(kind, action) {
    var command;
    if (action === "unlock") {
      command = kind === "lte" ? 'AT+QNWLOCK="common/4g",0' : 'AT+QNWLOCK="common/5g",0';   // old code had "common/5g,0" (quote in the wrong place)
    } else if (kind === "lte") {
      var count = Number($("lte-count").value);
      if (!Number.isInteger(count) || count < 1 || count > 10) throw new Error("Enter a cell count from 1 to 10.");
      var pairs = [];
      for (var i = 1; i <= count; i++) {
        var earfcn = $("lte-earfcn-" + i).value.trim();
        var pci = $("lte-pci-" + i).value.trim();
        if (!/^\d+$/.test(earfcn) || !/^\d+$/.test(pci)) throw new Error("Enter a numeric EARFCN and PCI for each cell.");
        pairs.push(earfcn, pci);
      }
      command = 'AT+QNWLOCK="common/4g",' + count + "," + pairs.join(",");
    } else {
      var values = ["nr-earfcn", "nr-pci", "nr-scs", "nr-band"].map(function (id) { return $(id).value.trim(); });
      if (!values.every(function (value) { return /^\d+$/.test(value); })) throw new Error("Enter numeric EARFCN, PCI, SCS, and band values.");
      command = 'AT+QNWLOCK="common/5g",' + values.join(",");
    }
    if (!window.confirm("Apply this modem command?\n\n" + command)) return;
    guard("cell-result", function () {
      setResult("cell-result", "Applying…");
      return AT.at(command, { timeout: 12000 }).then(function (text) {
        setResult("cell-result", "Cell-lock command completed. " + text.replace(/\s+/g, " ").trim(), "success");
      }, function (error) {
        if (error.modemError) throw new Error(error.message + " (AT+QNWLOCK is not listed in the RG50xQ manual, this modem may not support cell locking.)");
        throw error;
      });
    });
  }

  function renderLteFields() {
    var count = Math.max(1, Math.min(10, Number($("lte-count").value) || 1));
    var root = $("lte-lock-fields");
    root.replaceChildren();
    for (var i = 1; i <= count; i++) {
      var group = document.createElement("div");
      group.className = "form-grid";
      group.innerHTML = '<label class="field"><span>LTE cell ' + i + ' EARFCN</span><input id="lte-earfcn-' + i + '" type="number" min="0"></label>' +
        '<label class="field"><span>LTE cell ' + i + ' PCI</span><input id="lte-pci-' + i + '" type="number" min="0" max="503"></label>';
      root.appendChild(group);
    }
  }

  function lockClick(kind, action) {
    return function () {
      try { applyCellLock(kind, action); } catch (error) { setResult("cell-result", error.message, "error"); }
    };
  }

  $("network-refresh").addEventListener("click", function () { guard("preferences-result", refresh); });
  $("providerBands").addEventListener("change", function () { guard("preferences-result", refresh); });
  $("networkModeBand").addEventListener("change", renderBands);
  $("band-apply").addEventListener("click", function () { applyBands(false); });
  $("band-restore").addEventListener("click", function () { applyBands(true); });
  $("preferences-apply").addEventListener("click", applyPreferences);
  $("lte-count").addEventListener("change", renderLteFields);
  $("lte-lock-apply").addEventListener("click", lockClick("lte", "lock"));
  $("nr-lock-apply").addEventListener("click", lockClick("nr", "lock"));
  $("lte-unlock").addEventListener("click", lockClick("lte", "unlock"));
  $("nr-unlock").addEventListener("click", lockClick("nr", "unlock"));
  renderLteFields();
  refresh();
})();
