(function () {
  var readCommand = 'AT+CSCA?;+CMGL="ALL"';
  var prepareCommand = 'AT+CSMS=1;+CSDH=0;+CNMI=2,1,0,0,0;+CMGF=1;+CSMP=17,167,0,8;+CPMS="ME","ME","ME";+CSCS="UCS2"';
  var messages = [];
  var serviceCenter = "";
  var busy = false;
  var rows = document.getElementById("sms-rows");

  function setResult(id, message, kind) {
    var el = document.getElementById(id);
    el.textContent = message;
    el.className = "result" + (kind ? " is-" + kind : "");
  }

  function atRequest(atcmd) {
    return fetch("/cgi-bin/get_atcommand?" + new URLSearchParams({ atcmd: atcmd }), { cache: "no-store" })
      .then(function (response) {
        if (!response.ok) throw new Error("Request failed (HTTP " + response.status + ").");
        return response.text();
      }).then(function (text) {
        if (/\+CMS ERROR|\+CME ERROR|\bERROR\b/i.test(text)) throw new Error(text.trim());
        return text;
      });
  }

  function fromUcs2(hex) {
    try {
      var bytes = new Uint8Array((hex.match(/.{1,2}/g) || []).map(function (byte) { return parseInt(byte, 16); }));
      return new TextDecoder("utf-16be").decode(bytes);
    } catch (error) {
      return hex;
    }
  }

  function parseDate(value) {
    var m = /^(\d{1,2})\/(\d{1,2})\/(\d{2}),(\d{2}):(\d{2}):(\d{2})/.exec(value);
    if (!m) return value;
    return new Date(Date.UTC(2000 + Number(m[3]), Number(m[2]) - 1, Number(m[1]), Number(m[4]), Number(m[5]), Number(m[6]))).toLocaleString();
  }

  function parseMessages(text) {
    var entries = [];
    var lines = text.split(/\r?\n/);
    for (var i = 0; i < lines.length; i++) {
      var match = /^\s*\+CMGL:\s*(\d+),"[^"]*","([^"]*)"[^,]*,"([^"]*)"/.exec(lines[i]);
      if (!match) continue;
      var body = [];
      while (i + 1 < lines.length && !/^\s*(\+CMGL:|\+CSCA:|OK\b)/.test(lines[i + 1])) {
        var bodyLine = lines[++i].trim();
        if (bodyLine) body.push(bodyLine);
      }
      var senderHex = match[2];
      var sender = senderHex.length > 11 && (/^(002B|003)/i).test(senderHex) ? fromUcs2(senderHex) : senderHex;
      var bodyText = body.join("\n").trim();
      var message = /^[0-9a-f]+$/i.test(bodyText) ? fromUcs2(bodyText) : bodyText;
      entries.push({ indices: [Number(match[1])], sender: sender, date: parseDate(match[3].replace(/\+\d{2}$/, "")), text: message });
    }
    return entries;
  }

  function render() {
    rows.replaceChildren();
    if (!messages.length) {
      var empty = document.createElement("tr");
      empty.innerHTML = '<td colspan="4">No messages found.</td>';
      rows.appendChild(empty);
      return;
    }
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

  function refreshInbox() {
    var button = document.getElementById("sms-refresh");
    button.disabled = true;
    setResult("sms-inbox-result", "Reading messages…");
    atRequest(readCommand).then(function (text) {
      messages = parseMessages(text);
      var service = /\+CSCA:\s*"([^"]*)"/.exec(text);
      serviceCenter = service ? fromUcs2(service[1]) : "";
      render();
      document.getElementById("sms-select-all").checked = false;
      setResult("sms-inbox-result", messages.length + " message(s) loaded.", "success");
    }).catch(function (error) {
      setResult("sms-inbox-result", error.message, "error");
    }).finally(function () { button.disabled = false; });
  }

  function prepareSmsMode() {
    var button = document.getElementById("sms-prepare");
    if (!window.confirm("Prepare the modem for SMS using the original SMS configuration commands? This changes the modem's SMS presentation and notification settings.")) return;
    button.disabled = true;
    document.getElementById("sms-refresh").disabled = true;
    setResult("sms-inbox-result", "Preparing SMS mode…");
    atRequest(prepareCommand).then(function (text) {
      setResult("sms-inbox-result", "SMS mode prepared. " + text.trim(), "success");
      return refreshInbox();
    }).catch(function (error) {
      setResult("sms-inbox-result", error.message, "error");
    }).finally(function () {
      button.disabled = false;
      document.getElementById("sms-refresh").disabled = false;
    });
  }

  function selectedIndices() {
    var selected = Array.prototype.map.call(document.querySelectorAll(".sms-select:checked"), function (checkbox) { return messages[Number(checkbox.value)]; });
    return selected.reduce(function (all, message) { return all.concat(message.indices); }, []);
  }

  function deleteMessages(all) {
    var indices = selectedIndices();
    if (!all && !indices.length) {
      setResult("sms-inbox-result", "Select at least one message to delete.", "error");
      return;
    }
    var prompt = all ? "Delete all messages stored on the modem?" : "Delete the selected message(s) from the modem?";
    if (!window.confirm(prompt)) return;
    if (busy) return;
    busy = true;
    var buttons = ["sms-delete-selected", "sms-delete-all", "sms-refresh"].map(function (id) { return document.getElementById(id); });
    buttons.forEach(function (button) { button.disabled = true; });
    var command = all ? "AT+CMGD=,4" : indices.map(function (index, i) { return (i ? "+CMGD=" : "AT+CMGD=") + index; }).join(";");
    atRequest(command).then(function (text) {
      setResult("sms-inbox-result", "Delete command completed. " + text.trim(), "success");
      return refreshInbox();
    }).catch(function (error) {
      setResult("sms-inbox-result", error.message, "error");
    }).finally(function () {
      busy = false;
      buttons.forEach(function (button) { button.disabled = false; });
    });
  }

  function encodeUcs2(value) {
    var encoded = "";
    for (var i = 0; i < value.length; i++) encoded += value.charCodeAt(i).toString(16).toUpperCase().padStart(4, "0");
    return encoded;
  }

  function sendSMS(event) {
    event.preventDefault();
    if (busy) return;
    var number = document.getElementById("sms-number").value.trim();
    var text = document.getElementById("sms-message").value;
    if (!number || !text.trim()) {
      setResult("sms-send-result", "Enter a recipient number and message.", "error");
      return;
    }
    if (!window.confirm("Send this SMS to " + number + "?")) return;
    var recipient = number.length < 11 || !serviceCenter ? number : serviceCenter.substring(0, 3) + number;
    var segments = [];
    for (var i = 0; i < text.length; i += 70) segments.push(text.substring(i, i + 70));
    var uid = Math.floor(Math.random() * 256);
    var button = document.getElementById("sms-send");
    busy = true;
    button.disabled = true;
    setResult("sms-send-result", "Sending " + segments.length + " message part(s)…");
    var sendNext = function (index) {
      if (index >= segments.length) return Promise.resolve();
      var params = new URLSearchParams({
        number: encodeUcs2(recipient),
        msg: encodeUcs2(segments[index]),
        Command: uid + "," + (index + 1) + "," + segments.length
      });
      return fetch("/cgi-bin/send_sms?" + params, { cache: "no-store" }).then(function (response) {
        if (!response.ok) throw new Error("Request failed (HTTP " + response.status + ").");
        return response.text();
      }).then(function (responseText) {
        if (/\+CMS ERROR|\+CME ERROR|\bERROR\b/i.test(responseText)) throw new Error(responseText.trim());
        return sendNext(index + 1);
      });
    };
    sendNext(0).then(function () {
      setResult("sms-send-result", "SMS sent successfully.", "success");
      document.getElementById("sms-message").value = "";
    }).catch(function (error) {
      setResult("sms-send-result", "SMS sending failed: " + error.message, "error");
    }).finally(function () {
      busy = false;
      button.disabled = false;
    });
  }

  document.getElementById("sms-refresh").addEventListener("click", refreshInbox);
  document.getElementById("sms-prepare").addEventListener("click", prepareSmsMode);
  document.getElementById("sms-select-all").addEventListener("change", function () {
    document.querySelectorAll(".sms-select").forEach(function (checkbox) { checkbox.checked = this.checked; }, this);
  });
  document.getElementById("sms-delete-selected").addEventListener("click", function () { deleteMessages(false); });
  document.getElementById("sms-delete-all").addEventListener("click", function () { deleteMessages(true); });
  document.getElementById("sms-form").addEventListener("submit", sendSMS);
  document.getElementById("sms-message").addEventListener("input", function () {
    document.getElementById("sms-count").textContent = Math.ceil(this.value.length / 70) + " message part(s), up to 70 characters each";
  });
  refreshInbox();
})();
