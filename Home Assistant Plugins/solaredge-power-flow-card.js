class SolarEdgePowerFlowCard extends HTMLElement {
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
    this._render();
  }

  getCardSize() {
    return 4;
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
    const battDischarge = Math.max(0, battW);
    const battCharge = Math.max(0, -battW);
    const gridImport = Math.max(0, gridW);
    const gridExport = Math.max(0, -gridW);

    const widthMaxKW = Number(this._config.watt_threshold_kw) || 10;

    const styles = `
      :host { display:block; }
      ha-card {
        padding: 16px;
        border-radius: 16px;
      }
      .title {
        font-size: 1.1rem;
        font-weight: 600;
        margin-bottom: 12px;
      }
      .grid {
        display: grid;
        grid-template-columns: 1fr 1fr 1fr;
        grid-template-rows: auto auto;
        gap: 10px;
        align-items: center;
      }
      .node {
        background: rgba(var(--rgb-primary-text-color), 0.04);
        border: 1px solid rgba(var(--rgb-primary-text-color), 0.08);
        border-radius: 12px;
        padding: 10px 12px;
        text-align: center;
      }
      .node .label {
        font-size: 0.8rem;
        opacity: 0.8;
        margin-bottom: 4px;
      }
      .node .value {
        font-size: 1.1rem;
        font-weight: 700;
      }
      .center {
        position: relative;
      }
      .lines {
        display: grid;
        gap: 8px;
      }
      .line {
        height: 8px;
        border-radius: 999px;
        background: rgba(var(--rgb-primary-text-color), 0.18);
        transition: all 0.3s ease;
      }
      .flow-positive {
        background: linear-gradient(90deg, var(--success-color), rgba(var(--rgb-success-color), 0.5));
      }
      .flow-negative {
        background: linear-gradient(90deg, var(--warning-color), rgba(var(--rgb-warning-color), 0.5));
      }
      .battery-row {
        grid-column: 2 / span 1;
      }
      .battery-soc {
        margin-top: 6px;
        font-size: 0.8rem;
        opacity: 0.75;
      }
      .meta {
        margin-top: 12px;
        font-size: 0.8rem;
        opacity: 0.75;
      }
    `;

    this.shadowRoot.innerHTML = `
      <style>${styles}</style>
      <ha-card>
        <div class="title">${this._config.title}</div>
        <div class="grid">
          <div class="node">
            <div class="label">PV</div>
            <div class="value">${this._formatPower(pvW)}</div>
          </div>
          <div class="center lines">
            <div
              class="line ${this._flowClass(p2home)}"
              style="width:${this._lineWidthFromPower(Math.abs(p2home), widthMaxKW)}px"
              title="PV -> Haus: ${this._formatPower(p2home)}"
            ></div>
            <div
              class="line ${this._flowClass(gridImport - gridExport)}"
              style="width:${this._lineWidthFromPower(Math.abs(gridImport - gridExport), widthMaxKW)}px"
              title="Netzfluss: ${this._formatPower(gridImport - gridExport)}"
            ></div>
          </div>
          <div class="node">
            <div class="label">Haus</div>
            <div class="value">${this._formatPower(loadW)}</div>
          </div>

          <div class="node">
            <div class="label">Netz</div>
            <div class="value">${this._formatPower(gridImport - gridExport)}</div>
          </div>
          ${showBattery ? `
          <div class="node battery-row">
            <div class="label">Batterie</div>
            <div class="value">${this._formatPower(battW)}</div>
            ${e.battery_soc ? `<div class="battery-soc">SoC: ${this._formatSoc(socRaw)}</div>` : ""}
          </div>
          ` : '<div></div>'}
          <div class="node">
            <div class="label">PV Überschuss</div>
            <div class="value">${this._formatPower(Math.max(0, pvExtra - battCharge + gridExport))}</div>
          </div>
        </div>
        <div class="meta">
          Batterie + = Entladen, - = Laden | Netz + = Bezug, - = Einspeisung
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
        input, select { padding:8px; border-radius:8px; border:1px solid rgba(127,127,127,0.35); background:transparent; color:inherit; }
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
  preview: true,
});
