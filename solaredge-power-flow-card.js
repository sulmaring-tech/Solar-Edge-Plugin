const SOLAREDGE_CARD_VERSION = "2026.05.13.2";

class SolarEdgePowerFlowCard extends HTMLElement {
  connectedCallback() {
    if (this._tickInterval) return;
    // Repaint periodically so the "Live" timestamp updates even if no new state arrives.
    this._tickInterval = setInterval(() => this._render(), 1000);
    this._setupRefreshInterval();
  }

  disconnectedCallback() {
    if (this._tickInterval) {
      clearInterval(this._tickInterval);
      this._tickInterval = null;
    }
    if (this._refreshInterval) {
      clearInterval(this._refreshInterval);
      this._refreshInterval = null;
    }
  }

  static getConfigElement() {
    return document.createElement("solaredge-power-flow-card-editor");
  }

  static getStubConfig() {
    return {
      type: "custom:solaredge-power-flow-card",
      title: "SolarEdge Energiefluss",
      entities: {
        pv_power: "",
        house_power: "",
        grid_power: "",
        battery_power: "",
        battery_soc: "",
      },
      show_battery: true,
      watt_threshold_kw: 10,
      force_refresh_seconds: 0,
    };
  }

  setConfig(config) {
    if (!config.entities || !config.entities.pv_power || !config.entities.house_power || !config.entities.grid_power) {
      throw new Error("Bitte mindestens pv_power, house_power und grid_power in entities konfigurieren.");
    }

    this._config = {
      title: "SolarEdge Energiefluss",
      show_battery: true,
      watt_threshold_kw: 10,
      force_refresh_seconds: 0,
      ...config,
      entities: {
        battery_power: "",
        battery_soc: "",
        ...(config.entities || {}),
      },
    };
  }

  set hass(hass) {
    this._hass = hass;
    this._setupRefreshInterval();
    this._render();
  }

  getCardSize() {
    return 4;
  }

  _setupRefreshInterval() {
    if (this._refreshInterval) {
      clearInterval(this._refreshInterval);
      this._refreshInterval = null;
    }

    const secs = Number(this._config?.force_refresh_seconds || 0);
    if (!this._hass || !Number.isFinite(secs) || secs <= 0) return;

    const ids = Object.values(this._config.entities || {}).filter(Boolean);
    if (!ids.length) return;

    this._refreshInterval = setInterval(() => {
      this._hass.callService("homeassistant", "update_entity", { entity_id: ids });
    }, Math.max(5, secs) * 1000);
  }

  _stateValue(entityId, fallback = 0) {
    const stateObj = this._hass?.states?.[entityId];
    if (!stateObj) return fallback;
    const num = Number(stateObj.state);
    return Number.isFinite(num) ? num : fallback;
  }

  _entityUnit(entityId) {
    return this._hass?.states?.[entityId]?.attributes?.unit_of_measurement || "W";
  }

  _toW(value, unit) {
    if (!Number.isFinite(value)) return 0;
    const u = (unit || "W").toLowerCase();
    if (u === "kw") return value * 1000;
    return value;
  }

  _formatPower(watts) {
    const abs = Math.abs(watts);
    if (abs >= 1000) return `${(watts / 1000).toFixed(2)} kW`;
    return `${Math.round(watts)} W`;
  }

  _formatSoc(soc) {
    if (!Number.isFinite(soc)) return "-";
    return `${Math.round(soc)}%`;
  }

  _formatKwFromW(watts) {
    if (!Number.isFinite(watts)) return "-";
    const kw = watts / 1000;
    const abs = Math.abs(kw);
    const digits = abs >= 10 ? 1 : abs >= 1 ? 2 : 3;
    return kw.toLocaleString("de-DE", {
      minimumFractionDigits: abs >= 10 ? 1 : 2,
      maximumFractionDigits: digits,
    });
  }

  _clamp01(n) {
    return Math.max(0, Math.min(1, n));
  }

  _lineWidthFromPower(absW, maxKW) {
    const maxW = Math.max(1000, maxKW * 1000);
    const ratio = this._clamp01(absW / maxW);
    return 2 + ratio * 8;
  }

  _flowClass(val) {
    return val >= 0 ? "flow-positive" : "flow-negative";
  }

  _render() {
    if (!this._hass || !this._config) return;

    if (!this.shadowRoot) this.attachShadow({ mode: "open" });

    const e = this._config.entities;
    const showBattery = Boolean(this._config.show_battery && e.battery_power);

    const pvRaw = this._stateValue(e.pv_power);
    const loadRaw = this._stateValue(e.house_power);
    const gridRaw = this._stateValue(e.grid_power);
    const battRaw = showBattery ? this._stateValue(e.battery_power) : 0;
    const socRaw = e.battery_soc ? this._stateValue(e.battery_soc, NaN) : NaN;

    const pvW = this._toW(pvRaw, this._entityUnit(e.pv_power));
    const loadW = this._toW(loadRaw, this._entityUnit(e.house_power));
    const gridW = this._toW(gridRaw, this._entityUnit(e.grid_power));
    const battW = showBattery ? this._toW(battRaw, this._entityUnit(e.battery_power)) : 0;

    const p2home = Math.max(0, Math.min(pvW, loadW));
    const pvExtra = Math.max(0, pvW - p2home);
    const battCharge = Math.max(0, -battW);
    const gridImport = Math.max(0, gridW);
    const gridExport = Math.max(0, -gridW);

    const netW = gridImport - gridExport;
    const nowKw = this._formatKwFromW(pvW);
    const activeEps = 8;
    const activePv = Math.abs(pvW) > activeEps;
    const activeLoad = Math.abs(loadW) > activeEps;
    const activeGrid = Math.abs(netW) > activeEps;
    const activeBatt = showBattery && Math.abs(battW) > activeEps;
    const liveTime = new Date().toLocaleTimeString("de-DE");

    const styles = `
      :host { display:block; }
      ha-card {
        padding: 14px;
        border-radius: 18px;
        border: 1px solid rgba(148, 163, 184, 0.28);
        background:
          radial-gradient(circle at top right, rgba(239, 68, 68, 0.14), transparent 40%),
          radial-gradient(circle at top left, rgba(16, 185, 129, 0.10), transparent 42%),
          rgba(15, 23, 42, 0.55);
      }
      .title {
        font-size: 1rem;
        font-weight: 600;
        margin-bottom: 8px;
        color: var(--primary-text-color);
      }
      .card-head {
        display: flex;
        justify-content: space-between;
        align-items: center;
        gap: 10px;
      }
      .live {
        font-size: 0.72rem;
        color: rgba(74, 222, 128, 0.95);
        white-space: nowrap;
      }
      .hero {
        border: 1px solid rgba(148, 163, 184, 0.24);
        border-radius: 14px;
        background: rgba(2, 6, 23, 0.35);
        padding: 10px 12px;
        margin-bottom: 10px;
        text-align: center;
      }
      .hero-label {
        font-size: 0.68rem;
        text-transform: uppercase;
        letter-spacing: 0.08em;
        color: var(--secondary-text-color);
      }
      .hero-value {
        margin-top: 4px;
        font-size: 2rem;
        line-height: 1;
        font-weight: 300;
        letter-spacing: -0.02em;
      }
      .hero-value .unit {
        font-size: 1rem;
        color: rgba(248, 113, 113, 0.92);
        font-weight: 600;
      }
      .flow-wrap {
        border: 1px solid rgba(148, 163, 184, 0.2);
        border-radius: 14px;
        background: rgba(2, 6, 23, 0.25);
        padding: 8px;
      }
      .flow-title {
        font-size: 0.66rem;
        text-transform: uppercase;
        letter-spacing: 0.14em;
        text-align: center;
        color: var(--secondary-text-color);
        margin-bottom: 4px;
      }
      svg {
        width: 100%;
        height: auto;
      }
      .node-box {
        fill: rgba(15, 23, 42, 0.58);
        stroke: rgba(148, 163, 184, 0.33);
        stroke-width: 1;
      }
      .node-icon {
        font-size: 13px;
        opacity: 0.95;
      }
      .node-kw {
        fill: #f87171;
        font-size: 12px;
        font-weight: 700;
      }
      .node-sub {
        fill: rgba(203, 213, 225, 0.85);
        font-size: 8px;
      }
      .line-base {
        stroke: rgba(148, 163, 184, 0.30);
        stroke-width: 1.2;
        stroke-linecap: round;
      }
      .line-active-green {
        stroke: rgba(74, 222, 128, 0.95);
        stroke-width: 2.2;
        stroke-linecap: round;
      }
      .line-active-orange {
        stroke: rgba(251, 146, 60, 0.95);
        stroke-width: 2.2;
        stroke-linecap: round;
      }
      .stats {
        margin-top: 10px;
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        gap: 8px;
      }
      .chip {
        border: 1px solid rgba(148, 163, 184, 0.26);
        border-radius: 12px;
        padding: 8px 10px;
        background: rgba(2, 6, 23, 0.25);
      }
      .chip-label {
        font-size: 0.65rem;
        text-transform: uppercase;
        letter-spacing: 0.06em;
        color: var(--secondary-text-color);
      }
      .chip-value {
        margin-top: 2px;
        font-size: 0.95rem;
        font-weight: 700;
        color: var(--primary-text-color);
      }
    `;

    const pPv = { x: 110, y: 30 };
    const pLoad = { x: 34, y: 94 };
    const pGrid = { x: 186, y: 94 };
    const pBatt = { x: 110, y: 158 };
    const pHub = { x: 110, y: 94 };

    const drawLine = (from, to, active, orange = false) => {
      const cls = active ? (orange ? "line-active-orange" : "line-active-green") : "line-base";
      return `<line x1="${from.x}" y1="${from.y}" x2="${to.x}" y2="${to.y}" class="${cls}" />`;
    };

    const batterySub = showBattery && e.battery_soc ? `SoC ${this._formatSoc(socRaw)}` : " ";

    this.shadowRoot.innerHTML = `
      <style>${styles}</style>
      <ha-card>
        <div class="card-head">
          <div class="title">${this._config.title}</div>
          <div class="live">Live ${liveTime}</div>
        </div>
        <div class="hero">
          <div class="hero-label">Leistung jetzt</div>
          <div class="hero-value">${nowKw}<span class="unit"> kW</span></div>
        </div>
        <div class="flow-wrap">
          <div class="flow-title">Leistungsfluss</div>
          <svg viewBox="0 0 220 190" role="img" aria-label="SolarEdge Leistungsfluss">
            ${drawLine(pPv, pHub, activePv)}
            ${drawLine(pHub, pLoad, activeLoad, netW > activeEps)}
            ${drawLine(pHub, pGrid, activeGrid, netW > activeEps)}
            ${showBattery ? drawLine(pHub, pBatt, activeBatt) : ""}

            <rect x="84" y="80" width="52" height="28" rx="8" class="node-box"></rect>
            <text x="110" y="98" text-anchor="middle" class="node-icon">⚙</text>

            <g transform="translate(78,6)">
              <rect width="64" height="52" rx="10" class="node-box"></rect>
              <text x="32" y="16" text-anchor="middle" class="node-icon">☀</text>
              <text x="32" y="34" text-anchor="middle" class="node-kw">${this._formatKwFromW(pvW)} kW</text>
              <text x="32" y="46" text-anchor="middle" class="node-sub">PV</text>
            </g>

            <g transform="translate(2,68)">
              <rect width="64" height="52" rx="10" class="node-box"></rect>
              <text x="32" y="16" text-anchor="middle" class="node-icon">🏠</text>
              <text x="32" y="34" text-anchor="middle" class="node-kw">${this._formatKwFromW(loadW)} kW</text>
              <text x="32" y="46" text-anchor="middle" class="node-sub">Haus</text>
            </g>

            <g transform="translate(154,68)">
              <rect width="64" height="52" rx="10" class="node-box"></rect>
              <text x="32" y="16" text-anchor="middle" class="node-icon">⚡</text>
              <text x="32" y="34" text-anchor="middle" class="node-kw">${this._formatKwFromW(netW)} kW</text>
              <text x="32" y="46" text-anchor="middle" class="node-sub">Netz</text>
            </g>

            ${showBattery ? `
            <g transform="translate(78,132)">
              <rect width="64" height="52" rx="10" class="node-box"></rect>
              <text x="32" y="16" text-anchor="middle" class="node-icon">🔋</text>
              <text x="32" y="34" text-anchor="middle" class="node-kw">${this._formatKwFromW(battW)} kW</text>
              <text x="32" y="46" text-anchor="middle" class="node-sub">${batterySub}</text>
            </g>
            ` : ""}
          </svg>
        </div>
        <div class="stats">
          <div class="chip">
            <div class="chip-label">PV Ueberschuss</div>
            <div class="chip-value">${this._formatPower(Math.max(0, pvExtra - battCharge + gridExport))}</div>
          </div>
          <div class="chip">
            <div class="chip-label">Netzrichtung</div>
            <div class="chip-value">${netW >= 0 ? "Bezug" : "Einspeisung"}</div>
          </div>
        </div>
      </ha-card>
    `;
  }
}

class SolarEdgePowerFlowCardEditor extends HTMLElement {
  setConfig(config) {
    this._config = config;
  }

  set hass(hass) {
    this._hass = hass;
    this._render();
  }

  _value(path, fallback = "") {
    const keys = path.split(".");
    let cur = this._config || {};
    for (const key of keys) {
      cur = cur?.[key];
    }
    return cur ?? fallback;
  }

  _onInput(ev) {
    const target = ev.target;
    const path = target.dataset.path;
    const value = target.type === "checkbox" ? target.checked : target.value;

    const next = JSON.parse(JSON.stringify(this._config || {}));
    const keys = path.split(".");
    let cur = next;
    for (let i = 0; i < keys.length - 1; i++) {
      if (!cur[keys[i]]) cur[keys[i]] = {};
      cur = cur[keys[i]];
    }
    cur[keys[keys.length - 1]] = value;

    this.dispatchEvent(new CustomEvent("config-changed", {
      detail: { config: next },
      bubbles: true,
      composed: true,
    }));
  }

  _entityOptions() {
    return Object.keys(this._hass?.states || {})
      .filter((id) => id.startsWith("sensor.") || id.startsWith("number."))
      .sort();
  }

  _isSolarEdgeEntity(entityId) {
    const st = this._hass?.states?.[entityId];
    if (!st) return false;
    const text = [
      entityId,
      st.attributes?.friendly_name || "",
      st.attributes?.manufacturer || "",
      st.attributes?.device_class || "",
      st.attributes?.source || "",
      st.attributes?.attribution || "",
      st.attributes?.integration || "",
    ].join(" ").toLowerCase();
    return text.includes("solaredge") || text.includes("solar edge");
  }

  _rankEntity(entityId, keywords) {
    const st = this._hass?.states?.[entityId];
    const haystack = [
      entityId,
      st?.attributes?.friendly_name || "",
      st?.attributes?.device_class || "",
      st?.attributes?.unit_of_measurement || "",
    ].join(" ").toLowerCase();
    let score = 0;
    for (const keyword of keywords) {
      if (haystack.includes(keyword)) score += 1;
    }
    if (this._isSolarEdgeEntity(entityId)) score += 3;
    return score;
  }

  _optionsForPath(path) {
    const all = this._entityOptions();
    const solaredgeOnly = all.filter((id) => this._isSolarEdgeEntity(id));
    const pool = solaredgeOnly.length ? solaredgeOnly : all;

    const keywordMap = {
      "entities.pv_power": ["pv", "solar", "production", "power", "ac"],
      "entities.house_power": ["load", "consumption", "house", "home", "power"],
      "entities.grid_power": ["grid", "import", "export", "meter", "power"],
      "entities.battery_power": ["battery", "charge", "discharge", "power"],
      "entities.battery_soc": ["battery", "soc", "state of charge", "%", "capacity"],
    };
    const keywords = keywordMap[path] || [];

    return pool
      .map((id) => ({ id, score: this._rankEntity(id, keywords) }))
      .sort((a, b) => b.score - a.score || a.id.localeCompare(b.id))
      .map((item) => item.id);
  }

  _selectRow(label, path) {
    const val = this._value(path, "");
    const options = this._optionsForPath(path);
    return `
      <label>
        <span>${label}</span>
        <select data-path="${path}">
          <option value="">-- auswählen --</option>
          ${options.map((o) => `<option value="${o}" ${o === val ? "selected" : ""}>${o}</option>`).join("")}
        </select>
      </label>
    `;
  }

  _render() {
    if (!this._hass) return;
    if (!this.shadowRoot) this.attachShadow({ mode: "open" });

    this.shadowRoot.innerHTML = `
      <style>
        .wrap { display:grid; gap:10px; padding:6px 2px; }
        label { display:grid; gap:4px; font-size:0.9rem; }
        span { opacity:0.85; }
        input, select {
          padding: 8px;
          border-radius: 8px;
          border: 1px solid rgba(148, 163, 184, 0.45);
          background: rgba(15, 23, 42, 0.92);
          color: #e2e8f0;
        }
        select option {
          background: #0f172a;
          color: #e2e8f0;
        }
      </style>
      <div class="wrap">
        <label>
          <span>Titel</span>
          <input data-path="title" value="${this._value("title", "SolarEdge Energiefluss")}" />
        </label>
        <span style="font-size:0.8rem; opacity:0.75;">
          Dropdowns zeigen bevorzugt passende SolarEdge-Entitaeten.
        </span>
        ${this._selectRow("PV Leistung", "entities.pv_power")}
        ${this._selectRow("Hausverbrauch", "entities.house_power")}
        ${this._selectRow("Netzleistung (+Bezug / -Einspeisung)", "entities.grid_power")}
        ${this._selectRow("Batterieleistung (+Entladen / -Laden)", "entities.battery_power")}
        ${this._selectRow("Batterie SoC (%)", "entities.battery_soc")}
        <label>
          <span>Leistungsskalierung (kW)</span>
          <input type="number" data-path="watt_threshold_kw" value="${this._value("watt_threshold_kw", 10)}" />
        </label>
        <label>
          <span>Auto-Refresh (Sekunden, 0 = aus)</span>
          <input type="number" min="0" data-path="force_refresh_seconds" value="${this._value("force_refresh_seconds", 0)}" />
        </label>
        <label>
          <span>Batterie anzeigen</span>
          <input type="checkbox" data-path="show_battery" ${this._value("show_battery", true) ? "checked" : ""} />
        </label>
      </div>
    `;

    this.shadowRoot.querySelectorAll("input,select").forEach((el) =>
      el.addEventListener("change", (ev) => this._onInput(ev))
    );
  }
}

customElements.define("solaredge-power-flow-card", SolarEdgePowerFlowCard);
customElements.define("solaredge-power-flow-card-editor", SolarEdgePowerFlowCardEditor);

window.customCards = window.customCards || [];
window.customCards.push({
  type: "solaredge-power-flow-card",
  name: "SolarEdge Power Flow Card",
  description: "Visualisiert PV, Haus, Netz und Batterie in einer modernen Energiefluss-Karte.",
  version: SOLAREDGE_CARD_VERSION,
  preview: true,
});

console.info(`SolarEdge Power Flow Card loaded (v${SOLAREDGE_CARD_VERSION})`);
