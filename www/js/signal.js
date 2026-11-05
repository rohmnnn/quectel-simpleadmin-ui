/**
 * Extracted from the running device home page without changing thresholds or scoring.
 * Source: https://192.168.225.1/ index.html
 *   atFields                         367-382
 *   parseNetworkInfo                 384-455
 *   resetNetworkInfo                 457-498
 *   parseServingCellInfo             500-511
 *   clearNR5GData                    513-523
 *   clearLTEData                     526-536
 *   parseNR5GInfo                    538-554
 *   parseLTEInfo                     556-573
 *   calculate_lte_bw                 575-580
 *   calculate_nr_bw                  582-588
 *   ucs2ToUtf8                       590-594
 *   calculateRSRQPercentage          596-601
 *   calculateRSRPPercentage          603-608
 *   calculateSINRPercentage          610-615
 *   calculateSignalPercentage        617-619
 *   signalQuality                    621-623
 * The scoring function returns Excellent, Good, Fair, Poor, or No signal.
 */
function createLiveState() {
  return {
    sim: "Inactive",
    temperature: "0",
    active_sim: "-",
    network_provider: "-",
    mccmnc: "-",
    apn: "-",
    network_mode: "-",
    ipv4: "-",
    ipv6: "-",
    bands: "-",
    bandwidth: "-",
    prxqrsrp: "-",
    drxqrsrp: "-",
    rx2qrsrp: "-",
    rx3qrsrp: "-",
    antennas: {},
    earfcns: "-",
    nrArfcn: "-",
    nrBand: "-",
    nrBw: "-",
    pcc_pci: "-",
    scc_pci: "-",
    signalAssessment: "Unknown",
    csq: "-",
    rssi: "-",
    cellID: "-",
    eNBID: "-",
    tac: "-",
    rsrqLTE: "-",
    rsrqNR: "-",
    rsrqLTEPercentage: "0%",
    rsrqNRPercentage: "0%",
    rsrpLTE: "-",
    rsrpNR: "-",
    rsrpLTEPercentage: "0%",
    rsrpNRPercentage: "0%",
    sinrLTE: "-",
    sinrNR: "-",
    sinrLTEPercentage: "0%",
    sinrNRPercentage: "0%",
    signalPercentage: "0",
    internetConnection: "Disconnected",
    lastUpdate: "",
    uptime: "Unknown",
    networkFetchPending: false,

    atFields(line) {
      const payload = String(line || '').replace(/^\s*\+[^:]+:\s*/, '');
      const fields = [];
      let value = '', quoted = false;
      for (let i = 0; i < payload.length; i++) {
        const ch = payload[i];
        if (ch === '"') {
          if (quoted && payload[i + 1] === '"') { value += '"'; i++; }
          else quoted = !quoted;
        } else if (ch === ',' && !quoted) {
          fields.push(value.trim()); value = '';
        } else value += ch;
      }
      fields.push(value.trim());
      return fields;
    },

    parseNetworkInfo(lines) {
      lines = (Array.isArray(lines) ? lines : String(lines || '').split('\n'))
        .map(line => String(line).trim()).filter(Boolean);
      const find = prefix => lines.find(line => line.startsWith(prefix));
      const fields = prefix => this.atFields(find(prefix));
      // Each response is independent: missing optional fields must not keep old cell data.
      for (const key of ['active_sim', 'network_provider', 'mccmnc', 'apn', 'ipv4', 'ipv6',
        'network_mode', 'bands', 'bandwidth', 'earfcns', 'pcc_pci', 'scc_pci', 'cellID',
        'eNBID', 'tac', 'csq', 'prxqrsrp', 'drxqrsrp', 'rx2qrsrp', 'rx3qrsrp',
        'nrArfcn', 'nrBand', 'nrBw']) this[key] = '-';
      this.clearLTEData();
      this.clearNR5GData();
      this.signalAssessment = 'Unknown';

      const simStatus = fields('+QSIMSTAT:')[1];
      if (simStatus === '1') this.sim = 'Active';
      else if (simStatus === '0') { this.resetNetworkInfo(); return; }
      this.csq = fields('+CSQ:')[0] || '-';
      const temperatures = lines.filter(line => line.startsWith('+QTEMP:'))
        .map(line => Number(this.atFields(line)[1]))
        .filter(value => Number.isFinite(value) && value !== -273 && value !== 0);
      this.temperature = temperatures.length
        ? String(Math.round(temperatures.reduce((a, b) => a + b, 0) / temperatures.length)) : 'N/A';
      this.active_sim = fields('+QUIMSLOT:')[0] || '-';

      const spn = fields('+QSPN:');
      const alphabet = Number(spn[3]);
      // SPN may be empty while short/long operator names are available.
      const provider = [spn[2], spn[1], spn[0]].find(value => value && value !== '-');
      this.network_provider = provider ? (alphabet === 1 ? this.ucs2ToUtf8(provider) : provider) : '-';
      this.mccmnc = spn[4] || '-';
      const contexts = lines.filter(line => line.startsWith('+CGCONTRDP:'))
        .map(line => this.atFields(line));
      this.apn = contexts.length ? contexts[0][2] || '-' : '-';
      const setAddress = (family, value) => {
        const address = String(value || '').trim().split(/[,\s]/)[0].split('/')[0];
        if (family === 'IPV4' && /^(?:\d{1,3}\.){3}\d{1,3}$/.test(address) &&
          address.split('.').every(part => Number(part) <= 255)) this.ipv4 = address;
        if (family === 'IPV6' && /^[\da-f:]+$/i.test(address) && address.includes(':')) this.ipv6 = address;
      };
      for (const context of contexts) {
        const localAddress = context[3] || '';
        localAddress.split(/[,\s]+/).forEach(address => {
          if (address.includes(':')) setAddress('IPV6', address);
          else if (address.includes('.')) setAddress('IPV4', address);
        });
      }
      for (const line of lines.filter(line => line.startsWith('+QMAP:'))) {
        const parts = this.atFields(line);
        const family = parts.findIndex(part => /^IPV[46]$/i.test(part));
        if (family < 0) continue;
        const addressFamily = parts[family].toUpperCase();
        const candidates = [parts[4], ...parts.slice(family + 1)];
        for (const candidate of candidates) {
          const previous = addressFamily === 'IPV4' ? this.ipv4 : this.ipv6;
          setAddress(addressFamily, candidate);
          const current = addressFamily === 'IPV4' ? this.ipv4 : this.ipv6;
          if (current !== previous || current !== '-') break;
        }
      }
      const nw = fields('+QNWINFO:');
      this.bands = nw[2] || '-';
      this.earfcns = nw[3] || '-';
      if (this.mccmnc === '-' && /^\d{5,6}$/.test(nw[1] || '')) this.mccmnc = nw[1];
      const rsrp = fields('+QRSRP:');
      ['prxqrsrp', 'drxqrsrp', 'rx2qrsrp', 'rx3qrsrp'].forEach((key, i) => {
        this[key] = rsrp[i] || '-';
      });
      this.antennas = this.parseAntennas(lines, nw[0] || '');

      const cells = lines.filter(line => line.startsWith('+QENG:')).map(line => this.atFields(line));
      const serving = cells.find(parts => parts[0] === 'servingcell');
      if (serving && ['LTE', 'NR5G-SA'].includes(serving[2])) {
        this.network_mode = [serving[2], serving[3]].filter(Boolean).join(' ');
        this.parseServingCellInfo(serving);
      } else {
        // NSA uses a servingcell header followed by separate LTE and NR5G-NSA rows.
        const lte = cells.find(parts => parts[0] === 'LTE');
        const nr = cells.find(parts => parts[0] === 'NR5G-NSA');
        if (lte) {
          this.network_mode = nr ? 'NR5G-NSA' : ['LTE', lte[1]].filter(Boolean).join(' ');
          this.parseServingCellInfo(['servingcell', serving?.[1] || '', ...lte]);
        } else if (nw[0] && nw[0] !== 'No Service') this.network_mode = nw[0];
        if (nr && nr.length >= 6) {
          this.rsrpNR = nr[4] || '-';
          this.sinrNR = nr[5] || '-';
          this.rsrqNR = nr[6] || '-';
          this.rsrpNRPercentage = this.calculateRSRPPercentage(parseInt(this.rsrpNR));
          this.sinrNRPercentage = this.calculateSINRPercentage(parseInt(this.sinrNR));
          this.rsrqNRPercentage = this.calculateRSRQPercentage(parseInt(this.rsrqNR));
          this.scc_pci = nr[3] || '-';
          // NR5G-NSA fields: MCC, MNC, PCI, RSRP, SINR, RSRQ, ARFCN, band, NR_DL_bandwidth.
          this.nrArfcn = nr[7] || '-';
          this.nrBand = /^\d+$/.test(nr[8] || '') ? 'n' + nr[8] : '-';
          this.nrBw = /^\d+$/.test(nr[9] || '') ? this.calculate_nr_bw(parseInt(nr[9])) + ' MHz' : '-';
        }
      }
      this.lastUpdate = new Date().toLocaleString();
    },

    /**
     * +QRSRP / +QRSRQ / +QSINR rows contain PRX, DRX, RX2, RX3 and a RAT (LTE / NR5G).
     * Group by the RAT at the end of each row. SA was checked on-device (2026-10-15):
     *   +QRSRP: -89,-90,-103,-87,NR5G
     * The two-row NSA response has not yet been captured on-device.
     * Placeholder values (such as -32768) and non-numeric fields become null.
     * Returns { NR5G: { rsrp: [4], rsrq: [4] | null, sinr: [4] | null }, LTE: {...} }, or {}.
     */
    parseAntennas(lines, nwMode) {
      const out = {};
      const fallback = /NR5G|5G/i.test(nwMode) ? 'NR5G' : 'LTE';
      const value = raw => {
        const n = Number(String(raw ?? '').replace(/"/g, '').trim());
        return raw !== '' && Number.isFinite(n) && Math.abs(n) < 32767 ? n : null;
      };
      [['+QRSRP:', 'rsrp'], ['+QRSRQ:', 'rsrq'], ['+QSINR:', 'sinr']].forEach(([prefix, key]) => {
        lines.filter(line => line.startsWith(prefix)).forEach(line => {
          const parts = this.atFields(line);
          let rat = parts.length > 4 ? String(parts[4]).toUpperCase() : fallback;
          if (rat !== 'LTE' && rat !== 'NR5G') return;
          out[rat] = out[rat] || { rsrp: null, rsrq: null, sinr: null };
          out[rat][key] = [0, 1, 2, 3].map(i => value(parts[i]));
        });
      });
      Object.keys(out).forEach(rat => { if (!out[rat].rsrp) delete out[rat]; });
      return out;
    },

    resetNetworkInfo() {
      this.network_mode = "Network disconnected";
      this.lastUpdate = new Date().toLocaleString();
      this.sim = "Inactive";
      this.temperature = "0";
      this.active_sim = "-";
      this.network_provider = "-";
      this.mccmnc = "-";
      this.apn = "-";
      this.ipv4 = "-";
      this.ipv6 = "-";
      this.bands = "-";
      this.bandwidth = "-";
      this.prxqrsrp = "-";
      this.drxqrsrp = "-";
      this.rx2qrsrp = "-";
      this.rx3qrsrp = "-";
      this.antennas = {};
      this.earfcns = "-";
      this.nrArfcn = "-";
      this.nrBand = "-";
      this.nrBw = "-";
      this.pcc_pci = "-";
      this.scc_pci = "-";
      this.signalAssessment = "Unknown";
      this.csq = "-";
      this.rssi = "-";
      this.cellID = "-";
      this.eNBID = "-";
      this.tac = "-";
      this.rsrqLTE = "-";
      this.rsrqNR = "-";
      this.rsrqLTEPercentage = "0%";
      this.rsrqNRPercentage = "0%";
      this.rsrpLTE = "-";
      this.rsrpNR = "-";
      this.rsrpLTEPercentage = "0%";
      this.rsrpNRPercentage = "0%";
      this.sinrLTE = "-";
      this.sinrNR = "-";
      this.sinrLTEPercentage = "0%";
      this.sinrNRPercentage = "0%";
      this.signalPercentage = "0";
      this.internetConnection = "Disconnected";
      this.lastUpdate = new Date().toLocaleString();
    },

    parseServingCellInfo(servingCellParts) {
      const networkType = (servingCellParts[2] || '').replace(/"/g, "").trim();
      const minimum = networkType === 'NR5G-SA' ? 15 : 17;
      if (servingCellParts.length < minimum || !/^[0-9a-f]+$/i.test(servingCellParts[6] || '')) return;
      if (networkType === "NR5G-SA") {
        this.clearLTEData();  // Clear LTE values when switching to NR5G-SA.
        this.parseNR5GInfo(servingCellParts);
      } else if (networkType === "LTE") {
        this.clearNR5GData();  // Clear NR5G-SA values when switching to LTE.
        this.parseLTEInfo(servingCellParts);
      }
    },
    // Clear NR5G-SA values.
    clearNR5GData() {
      this.rsrqNR = '-';
      this.rsrqNRPercentage = '0';
      this.rsrpNR = '-';
      this.rsrpNRPercentage = '0';
      this.sinrNR = '-';
      this.sinrNRPercentage = '0';
      this.signalPercentage = '0';
      this.signalAssessment = '';
      this.rssi = "-";
    },

    // Clear LTE values.
    clearLTEData() {
      this.rsrqLTE = '-';
      this.rsrqLTEPercentage = '0';
      this.rsrpLTE = '-';
      this.rsrpLTEPercentage = '0';
      this.sinrLTE = '-';
      this.sinrLTEPercentage = '0';
      this.signalPercentage = '0';
      this.signalAssessment = '';
      this.rssi = "-";
    },

    parseNR5GInfo(parts) {
      this.bandwidth = "NR " + this.calculate_nr_bw(parseInt(parts[11].replace(/"/g, "").trim())) + " MHz";
      const longCID = parts[6].replace(/"/g, "").trim();
      this.eNBID = longCID.substring(0, longCID.length - 2);
      const shortCID = longCID.substring(longCID.length - 2);
      this.tac = parts[8].replace(/"/g, "").trim() + " (" + parseInt(parts[8].replace(/"/g, "").trim(), 16) + ")";
      this.cellID = `${shortCID}(${parseInt(shortCID, 16)}), ${longCID}(${parseInt(longCID, 16)})`;
      this.rsrqNR = parts[13].replace(/"/g, "").trim();
      this.rsrqNRPercentage = this.calculateRSRQPercentage(parseInt(this.rsrqNR));
      this.rsrpNR = parts[12].replace(/"/g, "").trim();
      this.rsrpNRPercentage = this.calculateRSRPPercentage(parseInt(this.rsrpNR));
      this.sinrNR = parts[14].replace(/"/g, "").trim();
      this.sinrNRPercentage = this.calculateSINRPercentage(parseInt(this.sinrNR));
      this.signalPercentage = this.calculateSignalPercentage(parseInt(this.rsrpNRPercentage), parseInt(this.sinrNRPercentage));
      this.signalAssessment = this.signalQuality(this.signalPercentage);
      this.pcc_pci = parts[7];
    },

    parseLTEInfo(parts) {
      this.bandwidth = "UL " + this.calculate_lte_bw(parseInt(parts[10].replace(/"/g, "").trim())) + " MHz / " + "DL " + this.calculate_lte_bw(parseInt(parts[11].replace(/"/g, "").trim())) + " MHz";
      const longCID = parts[6].replace(/"/g, "").trim();
      this.eNBID = longCID.substring(0, longCID.length - 2);
      const shortCID = longCID.substring(longCID.length - 2);
      this.tac = parts[12].replace(/"/g, "").trim() + " (" + parseInt(parts[12].replace(/"/g, "").trim(), 16) + ")";
      this.cellID = `${shortCID}(${parseInt(shortCID, 16)}), ${longCID}(${parseInt(longCID, 16)})`;
      this.rsrqLTE = parts[14].replace(/"/g, "").trim();
      this.rsrqLTEPercentage = this.calculateRSRQPercentage(parseInt(this.rsrqLTE));
      this.rsrpLTE = parts[13].replace(/"/g, "").trim();
      this.rsrpLTEPercentage = this.calculateRSRPPercentage(parseInt(this.rsrpLTE));
      this.sinrLTE = parts[16].replace(/"/g, "").trim();
      this.sinrLTEPercentage = this.calculateSINRPercentage(parseInt(this.sinrLTE));
      this.signalPercentage = this.calculateSignalPercentage(parseInt(this.rsrpLTEPercentage), parseInt(this.sinrLTEPercentage));
      this.signalAssessment = this.signalQuality(this.signalPercentage);
      this.rssi = parts[15];
      this.pcc_pci = parts[7];
    },

    calculate_lte_bw(lte_bw) {
      if (lte_bw === 0) return 1.4;
      if (lte_bw === 1) return 3;
      if (lte_bw >= 2 && lte_bw <= 5) return (lte_bw - 1) * 5;
      return "-";
    },

    calculate_nr_bw(nr_bw) {
      if (nr_bw >= 0 && nr_bw <= 5) return (nr_bw + 1) * 5;
      if (nr_bw >= 6 && nr_bw <= 12) return (nr_bw - 2) * 10;
      if (nr_bw === 13) return "200";
      if (nr_bw === 14) return "400";
      return "-";
    },

    ucs2ToUtf8(ucs2String) {
      const value = String(ucs2String || '').trim();
      if (!/^(?:[0-9a-f]{4})+$/i.test(value)) return value;
      return value.match(/.{4}/g).map(hex => String.fromCharCode(parseInt(hex, 16))).join('');
    },

    calculateRSRQPercentage(rsrq) {
      const RSRQ_min = -20, RSRQ_max = -8;
      if (isNaN(rsrq) || rsrq < -20) return 0;
      let percentage = ((rsrq - RSRQ_min) / (RSRQ_max - RSRQ_min)) * 100;
      return Math.round(percentage > 100 ? 100 : percentage);
    },

    calculateRSRPPercentage(rsrp) {
      const RSRP_min = -140, RSRP_max = -60;
      if (isNaN(rsrp) || rsrp < -140) return 0;
      let percentage = ((rsrp - RSRP_min) / (RSRP_max - RSRP_min)) * 100;
      return Math.round(percentage > 100 ? 100 : percentage);
    },

    calculateSINRPercentage(sinr) {
      const SINR_min = -10, SINR_max = 35;
      if (isNaN(sinr) || sinr < -10) return 0;
      let percentage = ((sinr - SINR_min) / (SINR_max - SINR_min)) * 100;
      return Math.round(percentage > 100 ? 100 : percentage);
    },

    calculateSignalPercentage(rsrpPercentage, sinrPercentage) {
      return Math.round((rsrpPercentage + sinrPercentage) / 2);
    },

    signalQuality(percentage) {
      return percentage >= 80 ? "Excellent" : percentage >= 60 ? "Good" : percentage >= 40 ? "Fair" : percentage >= 0 ? "Poor" : "No signal";
    },
  };
}
