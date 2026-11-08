(function () {
  "use strict";

  var COUNTRY_KEY = "sms-country-code";
  var AT_TIMEOUT = 8000;      // normal AT command
  var READ_TIMEOUT = 30000;   // AT+CMGL="ALL" can be slow on a full inbox
  var SEND_TIMEOUT = 25000;   // one SMS part

  var messages = [];
  var busy = false;
  var textModeReady = false;
  var ucs2Active = false;
  var rows = document.getElementById("sms-rows");
  var buttonIds = ["sms-refresh", "sms-prepare", "sms-delete-selected", "sms-delete-all", "sms-send"];

  function $(id) { return document.getElementById(id); }

  function setResult(id, message, kind) {
    var el = $(id);
    el.textContent = message;
    el.className = "result" + (kind ? " is-" + kind : "");
  }

  function setButtons(disabled) {
    buttonIds.forEach(function (id) { var b = $(id); if (b) b.disabled = disabled; });
  }

  // Run one UI action at a time. Buttons are always re-enabled, even after an error.
  function runBusy(task) {
    if (busy) return Promise.resolve();
    busy = true;
    setButtons(true);
    return Promise.resolve().then(task).finally(function () {
      busy = false;
      setButtons(false);
    });
  }

  /* ---------- requests: shared queue + timeouts live in js/at.js ---------- */

  var enqueue = AT.enqueue;
  var fetchText = AT.fetchText;
  function at(cmd, timeoutMs) { return AT.at(cmd, { timeout: timeoutMs }); }

  /* ---------- SMS setup (text mode + UCS2) ---------- */

  // Returns a list of warnings. Optional steps may fail without stopping the page.
  function setupTextMode(full) {
    var warnings = [];
    var steps = [
      { cmd: "AT+CMGF=1", key: "text" },
      { cmd: 'AT+CSCS="UCS2"', key: "ucs2" },
      { cmd: "AT+CSDH=0" },
      { cmd: "AT+CSMP=17,167,0,8" },
      { cmd: 'AT+CPMS="ME","ME","ME"', alt: 'AT+CPMS="SM","SM","SM"' }
    ];
    if (full) {
      steps.unshift({ cmd: "AT+CSMS=1" });
      steps.push({ cmd: "AT+CNMI=2,1,0,0,0" });
    }
    return steps.reduce(function (chain, step) {
      return chain.then(function () {
        return at(step.cmd).then(function () {
          if (step.key === "text") textModeReady = true;
          if (step.key === "ucs2") ucs2Active = true;
        }).catch(function (error) {
          if (step.alt) return at(step.alt).catch(function (error2) { warnings.push(step.alt + " -> " + error2.message); });
          if (step.key === "text") textModeReady = false;
          if (step.key === "ucs2") ucs2Active = false;
          warnings.push(step.cmd + " -> " + error.message);
        });
      });
    }, Promise.resolve()).then(function () { return warnings; });
  }

  /* ---------- decoding / parsing ---------- */

  function fromUcs2(hex) {
    try {
      var bytes = new Uint8Array((hex.match(/.{1,2}/g) || []).map(function (byte) { return parseInt(byte, 16); }));
      return new TextDecoder("utf-16be").decode(bytes);
    } catch (error) {
      return hex;
    }
  }

  // With AT+CSCS="UCS2" the modem returns senders and message bodies as UCS2 hex.
  function decodeField(value) {
    var compact = (value || "").replace(/\s+/g, "");
    if (ucs2Active && compact && compact.length % 4 === 0 && /^[0-9A-F]+$/i.test(compact)) return fromUcs2(compact);
    return (value || "").trim();
  }

  function pad(n) { return (n < 10 ? "0" : "") + n; }

  // Text-mode timestamp is "yy/MM/dd,hh:mm:ss±zz" (zz = quarter hours). Manual 8.6.
  function parseTimestamp(rest) {
    var m = /(\d{2})\/(\d{2})\/(\d{2}),(\d{2}):(\d{2}):(\d{2})\s*([+-]\d{1,2})?/.exec(rest || "");
    if (!m) return null;
    var label = "20" + m[1] + "-" + m[2] + "-" + m[3] + " " + m[4] + ":" + m[5] + ":" + m[6];
    if (m[7]) {
      var tz = parseInt(m[7], 10);
      var mins = Math.abs(tz) * 15;
      label += " UTC" + (tz < 0 ? "-" : "+") + Math.floor(mins / 60) + (mins % 60 ? ":" + pad(mins % 60) : "");
    }
    var time = Date.UTC(2000 + Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4]), Number(m[5]), Number(m[6]));
    return { label: label, time: time };
  }

  // +CMGL: <index>,<stat>,<oa/da>,[<alpha>],[<scts>]   (alpha and scts may be empty)
  function parseMessages(text) {
    var lines = text.split(/\r?\n/);
    while (lines.length && !lines[lines.length - 1].trim()) lines.pop();
    if (lines.length && /^OK$/i.test(lines[lines.length - 1].trim())) lines.pop();

    var entries = [];
    var current = null;
    lines.forEach(function (line) {
      var head = /^\s*\+CMGL:\s*(\d+),"([^"]*)","([^"]*)"(.*)$/.exec(line);
      if (head) {
        current = { index: Number(head[1]), addr: head[3], when: parseTimestamp(head[4]), body: [] };
        entries.push(current);
      } else if (current) {
        current.body.push(line);
      }
    });

    var result = [];
    entries.forEach(function (entry) {
      var sender = decodeField(entry.addr);
      var body = decodeField(entry.body.join("\n"));
      var prev = result[result.length - 1];
      // multi-part SMS arrive as several entries from the same sender within ~1 s: merge them
      if (prev && prev.when && entry.when && prev.sender === sender && Math.abs(entry.when.time - prev.when.time) <= 1000) {
        prev.text += " " + body;
        prev.indices.push(entry.index);
        prev.when = entry.when;
        prev.date = entry.when.label;
      } else {
        result.push({ indices: [entry.index], sender: sender, when: entry.when, date: entry.when ? entry.when.label : "", text: body });
      }
    });
    return result;
  }

  /* ---------- rendering ---------- */

  function renderMessage(text) {
    rows.replaceChildren();
    var tr = document.createElement("tr");
    var td = document.createElement("td");
    td.colSpan = 4;
    td.textContent = text;
    tr.appendChild(td);
    rows.appendChild(tr);
  }

  function render() {
    if (!messages.length) { renderMessage("No messages found."); return; }
    rows.replaceChildren();
    messages.forEach(function (message, index) {
      var tr = document.createElement("tr");
      var select = document.createElement("td");
      var checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.className = "sms-select";
      checkbox.value = String(index);
      checkbox.setAttribute("aria-label", "Select message from " + message.sender);
      select.appendChild(checkbox);
      var sender = document.createElement("td");
      sender.textContent = message.sender;
      var date = document.createElement("td");
      date.textContent = message.date;
      var body = document.createElement("td");
      body.textContent = message.text;
      tr.appendChild(select);
      tr.appendChild(sender);
      tr.appendChild(date);
      tr.appendChild(body);
      rows.appendChild(tr);
    });
  }

  function showError(error) {
    var hint = " If this keeps happening, press \"Prepare SMS mode\".";
    setResult("sms-inbox-result", error.message + (error.timedOut ? "" : hint), "error");
  }

  /* ---------- inbox ---------- */

  function loadInbox(isRetry, skipSetup) {
    var setup = (textModeReady || skipSetup) ? Promise.resolve([]) : setupTextMode(false);
    return setup.then(function (warnings) {
      return at('AT+CMGL="ALL"', READ_TIMEOUT).then(function (text) {
        messages = parseMessages(text);
        render();
        $("sms-select-all").checked = false;
        var note = warnings.length ? " Setup warnings: " + warnings.join("; ") : "";
        setResult("sms-inbox-result", messages.length + " message(s) loaded." + note, warnings.length ? "" : "success");
      }, function (error) {
        // text mode can be lost (modem rebooted): set it up again and retry once
        if (!isRetry && !error.timedOut) { textModeReady = false; return loadInbox(true, false); }
        throw error;
      });
    });
  }

  function refreshInbox() {
    return runBusy(function () {
      setResult("sms-inbox-result", "Reading messages…");
      return loadInbox(false, false).catch(function (error) {
        renderMessage("Could not read messages.");
        showError(error);
      });
    });
  }

  function prepareSmsMode() {
    if (busy) return;
    if (!window.confirm("Prepare the modem for SMS (text mode, UCS2, storage and new-message notification settings)? This changes the modem's SMS configuration.")) return;
    runBusy(function () {
      setResult("sms-inbox-result", "Preparing SMS mode…");
      textModeReady = false;
      return setupTextMode(true).then(function (warnings) {
        return loadInbox(true, true).then(function () {
          if (warnings.length) setResult("sms-inbox-result", messages.length + " message(s) loaded. Some setup commands failed: " + warnings.join("; "), "error");
          else setResult("sms-inbox-result", "SMS mode prepared. " + messages.length + " message(s) loaded.", "success");
        });
      }).catch(showError);
    });
  }

  function selectedIndices() {
    var selected = Array.prototype.map.call(document.querySelectorAll(".sms-select:checked"), function (checkbox) { return messages[Number(checkbox.value)]; });
    return selected.reduce(function (all, message) { return all.concat(message.indices); }, []);
  }

  function deleteMessages(all) {
    if (busy) return;
    var indices = selectedIndices();
    if (!all && !indices.length) {
      setResult("sms-inbox-result", "Select at least one message to delete.", "error");
      return;
    }
    if (!window.confirm(all ? "Delete all messages stored on the modem?" : "Delete the selected message(s) from the modem?")) return;
    runBusy(function () {
      setResult("sms-inbox-result", "Deleting…");
      var summary = { ok: 0, failed: 0, firstError: "" };
      var task;
      if (all) {
        // manual 8.5: AT+CMGD=<index>[,<delflag>] - the index is required, delflag 4 = delete all
        task = at("AT+CMGD=1,4", 20000).then(function () { summary.ok = 1; }).catch(function (error) { summary.failed = 1; summary.firstError = error.message; });
      } else {
        task = indices.reduce(function (chain, index) {
          return chain.then(function () {
            return at("AT+CMGD=" + index, 10000).then(function () { summary.ok++; }).catch(function (error) {
              summary.failed++;
              if (!summary.firstError) summary.firstError = error.message;
            });
          });
        }, Promise.resolve());
      }
      return task.then(function () {
        return loadInbox(true, true).then(function () {
          if (summary.failed) setResult("sms-inbox-result", "Delete failed for " + summary.failed + " item(s): " + summary.firstError, "error");
          else setResult("sms-inbox-result", "Deleted. " + messages.length + " message(s) left.", "success");
        });
      }).catch(showError);
    });
  }

  /* ---------- sending ---------- */

  function encodeUcs2(value) {
    var encoded = "";
    for (var i = 0; i < value.length; i++) encoded += value.charCodeAt(i).toString(16).toUpperCase().padStart(4, "0");
    return encoded;
  }

  // The number is sent as typed. Only these conversions are made:
  //  +xxxx stays, 00xxxx -> +xxxx, and (only if a country code is set) 0xxxx -> +<cc>xxxx.
  // The SMS-centre prefix is NOT used any more (it cut the country code to the wrong length).
  function normalizeRecipient(value, countryCode) {
    var number = (value || "").replace(/[^0-9+]/g, "");
    if (!number) return "";
    if (number.charAt(0) === "+") return "+" + number.slice(1).replace(/\+/g, "");
    number = number.replace(/\+/g, "");
    if (number.slice(0, 2) === "00") return "+" + number.slice(2);
    var cc = (countryCode || "").replace(/\D/g, "");
    if (cc && number.charAt(0) === "0" && number.length >= 7) return "+" + cc + number.slice(1);
    return number;
  }

  function sendError(text) { return AT.anyErrorLine(text); }

  // cgi-bin/send_sms builds: AT+CMGS="<number>",<Command> and then types the text + Ctrl-Z.
  // The documented form is AT+CMGS=<da>[,<toda>], so a single-part message sends <toda> (129 = national,
  // 145 = international). Multi-part messages use the extension the original page uses: uid,part,total.
  function sendPart(recipient, segment, command) {
    var params = new URLSearchParams({ number: encodeUcs2(recipient), msg: encodeUcs2(segment), Command: command });
    return enqueue(function () {
      return fetchText("/cgi-bin/send_sms?" + params, SEND_TIMEOUT, { allowHttpError: true });
    }).then(function (responseText) {
      var problem = sendError(responseText);
      if (problem) throw new Error(problem);
      // like the original page: anything that is not an error counts as sent
      return /\+CMGS|\bOK\b/i.test(responseText);
    });
  }

  function sendSMS(event) {
    event.preventDefault();
    if (busy) return;
    var typed = $("sms-number").value.trim();
    var text = $("sms-message").value;
    if (!typed || !text.trim()) {
      setResult("sms-send-result", "Enter a recipient number and message.", "error");
      return;
    }
    var recipient = normalizeRecipient(typed, $("sms-country").value);
    if (!recipient) {
      setResult("sms-send-result", "Enter a valid recipient number.", "error");
      return;
    }
    var typedClean = typed.replace(/\s+/g, "");
    var shown = recipient === typedClean ? recipient : recipient + " (typed: " + typed + ")";
    if (!window.confirm("Send this SMS to " + shown + "?")) return;

    var segments = [];
    for (var i = 0; i < text.length; i += 70) segments.push(text.substring(i, i + 70));
    var uid = Math.floor(Math.random() * 256);
    var toda = recipient.charAt(0) === "+" ? "145" : "129";

    runBusy(function () {
      var confirmed = true;
      var setup = textModeReady ? Promise.resolve() : setupTextMode(false);   // text mode + UCS2 are required for the hex payload
      var chain = setup;
      segments.forEach(function (segment, index) {
        chain = chain.then(function () {
          setResult("sms-send-result", "Sending part " + (index + 1) + " of " + segments.length + "…");
          if (segments.length === 1) {
            return sendPart(recipient, segment, toda).catch(function (error) {
              // some firmware wants the original "uid,part,total" form
              if (!/\+CM[ES] ERROR/i.test(error.message)) throw error;
              return sendPart(recipient, segment, uid + ",1,1");
            }).then(function (ok) { confirmed = confirmed && ok; });
          }
          return sendPart(recipient, segment, uid + "," + (index + 1) + "," + segments.length).then(function (ok) { confirmed = confirmed && ok; });
        });
      });
      return chain.then(function () {
        setResult("sms-send-result", confirmed ? "SMS sent successfully." : "SMS command sent. The modem did not return a confirmation, check the recipient to be sure.", confirmed ? "success" : "");
        $("sms-message").value = "";
        $("sms-count").textContent = "";
      }).catch(function (error) {
        var hint = segments.length > 1 && /\+CM[ES] ERROR/i.test(error.message) ? " Long (multi-part) messages may not be supported by this modem, try a message of up to 70 characters." : "";
        setResult("sms-send-result", "SMS sending failed: " + error.message + hint, "error");
      });
    });
  }

  /* ---------- wiring ---------- */

  try { $("sms-country").value = localStorage.getItem(COUNTRY_KEY) || ""; } catch (e) { /* storage may be unavailable */ }
  $("sms-country").addEventListener("change", function () {
    try { localStorage.setItem(COUNTRY_KEY, this.value.trim()); } catch (e) { /* ignore */ }
  });
  $("sms-refresh").addEventListener("click", refreshInbox);
  $("sms-prepare").addEventListener("click", prepareSmsMode);
  $("sms-select-all").addEventListener("change", function () {
    document.querySelectorAll(".sms-select").forEach(function (checkbox) { checkbox.checked = this.checked; }, this);
  });
  $("sms-delete-selected").addEventListener("click", function () { deleteMessages(false); });
  $("sms-delete-all").addEventListener("click", function () { deleteMessages(true); });
  $("sms-form").addEventListener("submit", sendSMS);
  $("sms-message").addEventListener("input", function () {
    $("sms-count").textContent = Math.ceil(this.value.length / 70) + " message part(s), up to 70 characters each";
  });
  refreshInbox();
})();
