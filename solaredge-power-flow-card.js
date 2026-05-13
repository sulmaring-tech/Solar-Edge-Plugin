const SOLAREDGE_CARD_VERSION = "2026.05.13.13";

const FLOW_ACTIVE_EPS_KW = 0.0005;
const FLOW_ARROW_SOLAR = "rgba(74,222,128,0.95)";
const FLOW_ARROW_GRID_IMPORT = "rgba(251,146,60,0.95)";
const FLOW_MARKER_SOLAR_FILL = "rgba(74,222,128,0.98)";
const FLOW_MARKER_GRID_IMPORT_FILL = "rgba(251,146,60,0.98)";
const FLOW_KW_COLOR = "#f87171";
const FLOW_KW_UNIT_COLOR = "rgba(248,113,113,0.82)";

function borderToward(cx, cy, hw, hh, tx, ty) {
  const dx = tx - cx;
  const dy = ty - cy;
  const adx = Math.abs(dx);
  const ady = Math.abs(dy);
  if (adx < 1e-9 && ady < 1e-9) return { x: cx, y: cy };
  const sx = adx < 1e-9 ? Infinity : hw / adx;
  const sy = ady < 1e-9 ? Infinity : hh / ady;
  const sc = Math.min(sx, sy);
  return { x: cx + dx * sc, y: cy + dy * sc };
}

function shortenSegment(x1, y1, x2, y2, insetFrom1, insetFrom2) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const len = Math.hypot(dx, dy);
  if (len < 1e-6) return { x1, y1, x2, y2 };
  if (len <= insetFrom1 + insetFrom2 + 0.25) {
    const mx = (x1 + x2) / 2;
    const my = (y1 + y2) / 2;
    return { x1: mx, y1: my, x2: mx, y2: my };
  }
  const ux = dx / len;
  const uy = dy / len;
  return {
    x1: x1 + ux * insetFrom1,
    y1: y1 + uy * insetFrom1,
    x2: x2 - ux * insetFrom2,
    y2: y2 - uy * insetFrom2,
  };
}

function retractStrokeEndBeforeArrowTip(x1, y1, x2, y2, retractPx) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const len = Math.hypot(dx, dy);
  if (len < 1e-6 || retractPx <= 0) return { x1, y1, x2, y2 };
  const r = Math.min(retractPx, Math.max(0, len - 0.75));
  const ux = dx / len;
  const uy = dy / len;
  return { x1, y1, x2: x2 - ux * r, y2: y2 - uy * r };
}

function storageStatusDe(status) {
  if (!status?.trim()) return undefined;
  const u = status.toLowerCase();
  if (u.includes("discharg")) return "Entlädt";
  if (u.includes("charg")) return "Lädt";
  if (u.includes("idle")) return "Bereit";
  return status;
}

function normalizePowerFlowFromApi(siteFlow) {
  if (!siteFlow || typeof siteFlow !== "object") return null;
  const unit = (siteFlow.unit || "W").toString().toLowerCase();
  const toKw = (v) => {
    const n = Number(v);
    if (!Number.isFinite(n)) return 0;
    if (unit === "kw") return n;
    return n / 1000;
  };

  const keyMap = {
    PRODUCTION: "PV",
    PV: "PV",
    CONSUMPTION: "LOAD",
    LOAD: "LOAD",
    FEEDIN: "GRID",
    PURCHASE: "GRID",
    GRID: "GRID",
    STORAGE: "STORAGE",
  };
  const nodes = [];
  const nodeKeys = ["PV", "LOAD", "GRID", "STORAGE"];
  for (const key of nodeKeys) {
    const raw = siteFlow[key];
    if (!raw || typeof raw !== "object") continue;
    const powerKw = toKw(raw.currentPower ?? raw.power ?? 0);
    const chargeLevelPct =
      key === "STORAGE" && raw.chargeLevel != null
        ? Number(raw.chargeLevel)
        : key === "STORAGE" && raw.chargeLevelPercent != null
          ? Number(raw.chargeLevelPercent)
          : undefined;
    nodes.push({
      key,
      powerKw,
      chargeLevelPct: Number.isFinite(chargeLevelPct) ? chargeLevelPct : undefined,
      status: raw.status,
    });
  }

  let connections = Array.isArray(siteFlow.connections) ? siteFlow.connections : [];
  connections = connections
    .map((c) => ({
      from: keyMap[String(c.from ?? "").toUpperCase()] || c.from,
      to: keyMap[String(c.to ?? "").toUpperCase()] || c.to,
    }))
    .filter((c) => nodeKeys.includes(c.from) && nodeKeys.includes(c.to));

  if (!nodes.length) return null;
  return { nodes, connections };
}

function buildSyntheticPowerFlow(pvW, loadW, gridW, battW, socRaw, showBattery) {
  const epsW = 1;
  const pvKw = pvW / 1000;
  const loadKw = loadW / 1000;
  const gridKw = gridW / 1000;
  const battKw = battW / 1000;
  const nodes = [
    { key: "PV", powerKw: pvKw },
    { key: "LOAD", powerKw: loadKw },
    { key: "GRID", powerKw: gridKw },
  ];
  if (showBattery) {
    nodes.push({
      key: "STORAGE",
      powerKw: battKw,
      chargeLevelPct: Number.isFinite(socRaw) ? socRaw : undefined,
    });
  }

  const W = (w) => Math.abs(w) > epsW;
  const connections = [];
  if (W(pvW) && W(loadW) && pvW > 0 && loadW > 0) connections.push({ from: "PV", to: "LOAD" });
  if (W(pvW) && gridW < -epsW) connections.push({ from: "PV", to: "GRID" });
  if (showBattery && W(pvW) && battW < -epsW) connections.push({ from: "PV", to: "STORAGE" });
  if (W(gridW) && gridW > epsW && W(loadW)) connections.push({ from: "GRID", to: "LOAD" });
  if (showBattery && W(battW) && battW > epsW && W(loadW)) connections.push({ from: "STORAGE", to: "LOAD" });
  if (W(loadW) && gridW < -epsW) connections.push({ from: "LOAD", to: "GRID" });
  if (showBattery && W(battW) && battW < -epsW && W(gridW) && gridW > epsW) {
    connections.push({ from: "GRID", to: "STORAGE" });
  }

  const seen = new Set();
  const uniq = [];
  for (const c of connections) {
    const k = `${c.from}->${c.to}`;
    if (seen.has(k)) continue;
    seen.add(k);
    uniq.push(c);
  }
  return { nodes, connections: uniq };
}

function filterPowerFlowForBattery(flow, showBattery) {
  if (showBattery) return flow;
  return {
    nodes: flow.nodes.filter((n) => n.key !== "STORAGE"),
    connections: flow.connections.filter((c) => c.from !== "STORAGE" && c.to !== "STORAGE"),
  };
}

function escapeXml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** YYYY-MM-DD im lokalen Kalender (für SolarEdge startDate/endDate). */
function formatLocalYmd(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** SolarEdge /site/…/energy (timeUnit=DAY) → Liste Tagesertrag kWh. */
function parseSolarEdgeEnergy7d(json) {
  const vals = json?.energy?.values;
  if (!Array.isArray(vals)) return [];
  const unit = String(json?.energy?.unit || "Wh").toLowerCase();
  const toKwh = (v) => {
    if (v == null || v === "") return null;
    const n = Number(v);
    if (!Number.isFinite(n)) return null;
    if (unit === "kwh" || unit.includes("kwh")) return n;
    return n / 1000;
  };
  const rows = [];
  for (const row of vals) {
    const raw = row?.date;
    if (!raw) continue;
    const kwh = toKwh(row.value);
    const d = new Date(String(raw).replace(" ", "T"));
    if (Number.isNaN(d.getTime())) continue;
    rows.push({ t: d.getTime(), kwh });
  }
  rows.sort((a, b) => a.t - b.t);
  return rows.slice(-7).map((r) => {
    const d = new Date(r.t);
    return {
      key: formatLocalYmd(d),
      kwh: r.kwh,
      labelShort: d.toLocaleDateString("de-DE", { weekday: "short" }),
      labelDay: d.toLocaleDateString("de-DE", { day: "numeric", month: "short" }),
    };
  });
}

/** HA History für täglich steigenden Ertragssensor (z. B. „heute“): pro Kalendertag max(State), Browser-Zeitzone. */
function parseHistoryDailyMaxKwh(historyRows, _timeZone, daysBack) {
  const dayKeyFromIso = (iso) => new Date(iso).toLocaleDateString("en-CA");
  const buckets = new Map();
  const flat = Array.isArray(historyRows?.[0]) ? historyRows[0] : [];
  for (const st of flat) {
    const v = Number(st?.state);
    if (!Number.isFinite(v)) continue;
    const k = dayKeyFromIso(st.last_changed || st.last_updated);
    buckets.set(k, Math.max(buckets.get(k) ?? 0, v));
  }
  const out = [];
  for (let i = daysBack - 1; i >= 0; i--) {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    d.setDate(d.getDate() - i);
    const key = formatLocalYmd(d);
    const kwh = buckets.has(key) ? buckets.get(key) : null;
    out.push({
      key,
      kwh,
      labelShort: d.toLocaleDateString("de-DE", { weekday: "short" }),
      labelDay: d.toLocaleDateString("de-DE", { day: "numeric", month: "short" }),
    });
  }
  return out;
}

function buildYield7dHtml(yieldBlock, cfg) {
  if (!cfg || cfg.show_7d_yield === false) return "";
  const useApi = Boolean(cfg.use_direct_api);
  const eid = String(cfg.entities?.pv_energy_today || "").trim();
  if (!useApi && !eid) {
    return `
    <div class="yield-7d">
      <div class="yield-title">PV-Tagesertrag (7 Tage)</div>
      <div class="yield-hint">Im Editor optional den Sensor „PV Tagesertrag / heute“ wählen (z. B. SolarEdge energy today).</div>
    </div>`;
  }
  if (yieldBlock == null) {
    return `
    <div class="yield-7d">
      <div class="yield-title">PV-Tagesertrag (7 Tage)</div>
      <div class="yield-hint">Lade Verlauf…</div>
    </div>`;
  }
  if (yieldBlock.error && !(yieldBlock.days?.length > 0)) {
    return `
    <div class="yield-7d">
      <div class="yield-title">PV-Tagesertrag (7 Tage)</div>
      <div class="yield-err">${escapeXml(yieldBlock.error)}</div>
    </div>`;
  }
  const { days, error } = yieldBlock;
  if (!days?.length) {
    return `
    <div class="yield-7d">
      <div class="yield-title">PV-Tagesertrag (7 Tage)</div>
      ${error ? `<div class="yield-err">${escapeXml(error)}</div>` : ""}
      <div class="yield-hint">Keine Tageswerte im gewählten Zeitraum.</div>
    </div>`;
  }
  const nums = days.map((d) => (d.kwh != null && Number.isFinite(d.kwh) ? d.kwh : 0));
  const maxKwh = Math.max(...nums, 0.001);
  const errLine = error ? `<div class="yield-err">${escapeXml(error)}</div>` : "";
  const bars = days
    .map((d) => {
      const has = d.kwh != null && Number.isFinite(d.kwh);
      const pct = has ? Math.max(6, Math.round((d.kwh / maxKwh) * 100)) : 4;
      const val = has ? d.kwh.toLocaleString("de-DE", { minimumFractionDigits: 1, maximumFractionDigits: 1 }) : "–";
      const title = `${d.labelShort} ${d.labelDay}: ${has ? `${val} kWh` : "keine Daten"}`;
      return `
        <div class="yield-col" title="${escapeXml(title)}">
          <div class="yield-bar-wrap">
            <div class="yield-bar" style="height:${pct}%"></div>
          </div>
          <div class="yield-lbl">${escapeXml(d.labelShort)}</div>
          <div class="yield-sub">${escapeXml(d.labelDay)}</div>
          <div class="yield-val">${escapeXml(val)}</div>
        </div>`;
    })
    .join("");
  return `
    <div class="yield-7d">
      <div class="yield-title">PV-Tagesertrag (7 Tage)</div>
      ${errLine}
      <div class="yield-bars">${bars}</div>
    </div>`;
}

/**
 * Farbe, Pfeil-Marker und Strich-Animationsrichtung pro SVG-Segment.
 * leg 1 = Quelle -> Hub, leg 2 = Hub -> Ziel (physikalischer Leistungsfluss laut Verbindung).
 *
 * Regeln (vereinbart mit Nutzer):
 * - Haus (LOAD): immer grün, Animation zum Haus (nur auf Segmenten, die auf LOAD zulaufen).
 * - PV: grün Richtung Hub auf dem PV->Hub-Strang.
 * - Netz: orange Richtung Hub beim Bezug (GRID->…); grün Richtung Netz bei Einspeisung (…->GRID).
 * - Batterie: grün Richtung Batterie beim Laden (…->STORAGE); orange Richtung Hub beim Entladen (STORAGE->…).
 */
function connectionFlowLegStyle(c, leg, uid) {
  const animFwd = "se-dash-anim-fwd";
  const green = FLOW_ARROW_SOLAR;
  const orange = FLOW_ARROW_GRID_IMPORT;
  const markerGreen = `${uid}g`;
  const markerOrange = `${uid}o`;

  if (leg === 1) {
    if (c.from === "PV") return { stroke: green, marker: markerGreen, anim: animFwd };
    if (c.from === "GRID") return { stroke: orange, marker: markerOrange, anim: animFwd };
    if (c.from === "STORAGE") return { stroke: orange, marker: markerOrange, anim: animFwd };
    if (c.from === "LOAD") return { stroke: green, marker: markerGreen, anim: animFwd };
    return { stroke: green, marker: markerGreen, anim: animFwd };
  }
  if (c.to === "LOAD") return { stroke: green, marker: markerGreen, anim: animFwd };
  if (c.to === "GRID") return { stroke: green, marker: markerGreen, anim: animFwd };
  if (c.to === "STORAGE") return { stroke: green, marker: markerGreen, anim: animFwd };
  if (c.to === "PV") return { stroke: green, marker: markerGreen, anim: animFwd };
  return { stroke: green, marker: markerGreen, anim: animFwd };
}

function buildPowerFlowSvgMarkup(flow, uid) {
  const arrowGreen = `${uid}g`;
  const arrowOrange = `${uid}o`;

  const hubCx = 142;
  const hubCy = 100;
  const hubW = 42;
  const hubH = 30;
  const hwBox = hubW / 2;
  const hhBox = hubH / 2;
  const ARM_Y = 88;
  const ARM_X = ARM_Y + hwBox - hhBox;
  const GAP_NODE = 12;
  const GAP_HUB = 10;
  const STROKE_STOP_BEFORE_TIP_PX = 7.5;

  const pos = {
    PV: { x: hubCx, y: hubCy - ARM_Y },
    LOAD: { x: hubCx - ARM_X, y: hubCy },
    GRID: { x: hubCx + ARM_X, y: hubCy },
    STORAGE: { x: hubCx, y: hubCy + ARM_Y },
  };

  const nodeMap = new Map(flow.nodes.map((n) => [n.key, n]));
  const boxW = 64;
  const boxH = 64;
  const hbW = boxW / 2;
  const hbH = boxH / 2;

  // Wie SolarEdge-TSX: Kante aktiv, wenn mindestens ein Endpunkt nennenswert Leistung hat.
  const connectionActive = (from, to) =>
    Math.abs(nodeMap.get(from)?.powerKw ?? 0) > FLOW_ACTIVE_EPS_KW ||
    Math.abs(nodeMap.get(to)?.powerKw ?? 0) > FLOW_ACTIVE_EPS_KW;

  const renderOrder = ["PV", "LOAD", "GRID", "STORAGE"];
  const spokes = [];
  for (const k of renderOrder) {
    if (!nodeMap.has(k)) continue;
    const p = pos[k];
    const raw1 = borderToward(p.x, p.y, hbW, hbH, hubCx, hubCy);
    const raw2 = borderToward(hubCx, hubCy, hwBox, hhBox, p.x, p.y);
    const s = shortenSegment(raw1.x, raw1.y, raw2.x, raw2.y, GAP_NODE, GAP_HUB);
    // Statische Hilfslinien — keine Animation (wirkt sonst hektisch und unabhaengig vom echten Fluss).
    spokes.push(
      `<line x1="${s.x1}" y1="${s.y1}" x2="${s.x2}" y2="${s.y2}" stroke="rgba(148,163,184,0.28)" stroke-width="1.25" stroke-linecap="round" />`
    );
  }

  const seenConn = new Set();
  const lines = [];
  for (const c of flow.connections) {
    if (!nodeMap.has(c.from) || !nodeMap.has(c.to)) continue;
    const k = `${c.from}->${c.to}`;
    if (seenConn.has(k)) continue;
    seenConn.add(k);
    const pA = pos[c.from];
    const pB = pos[c.to];
    if (!pA || !pB) continue;
    const active = connectionActive(c.from, c.to);
    if (!active) continue;

    const strokeW = 2.15;
    const leg1 = connectionFlowLegStyle(c, 1, uid);
    const rawA1 = borderToward(pA.x, pA.y, hbW, hbH, hubCx, hubCy);
    const rawA2 = borderToward(hubCx, hubCy, hwBox, hhBox, pA.x, pA.y);
    const a = shortenSegment(rawA1.x, rawA1.y, rawA2.x, rawA2.y, GAP_NODE, GAP_HUB);
    const aDash = retractStrokeEndBeforeArrowTip(a.x1, a.y1, a.x2, a.y2, STROKE_STOP_BEFORE_TIP_PX);
    lines.push(
      `<line class="se-dash-line ${leg1.anim}" x1="${aDash.x1}" y1="${aDash.y1}" x2="${aDash.x2}" y2="${aDash.y2}" stroke="${leg1.stroke}" stroke-width="${strokeW}" stroke-linecap="round" stroke-dasharray="10 16" />`
    );
    lines.push(
      `<line x1="${aDash.x2}" y1="${aDash.y2}" x2="${a.x2}" y2="${a.y2}" stroke="transparent" stroke-width="1" marker-end="url(#${leg1.marker})" pointer-events="none" />`
    );

    const leg2 = connectionFlowLegStyle(c, 2, uid);
    const rawB1 = borderToward(hubCx, hubCy, hwBox, hhBox, pB.x, pB.y);
    const rawB2 = borderToward(pB.x, pB.y, hbW, hbH, hubCx, hubCy);
    const b = shortenSegment(rawB1.x, rawB1.y, rawB2.x, rawB2.y, GAP_HUB, GAP_NODE);
    const bDash = retractStrokeEndBeforeArrowTip(b.x1, b.y1, b.x2, b.y2, STROKE_STOP_BEFORE_TIP_PX);

    lines.push(
      `<line class="se-dash-line ${leg2.anim}" x1="${bDash.x1}" y1="${bDash.y1}" x2="${bDash.x2}" y2="${bDash.y2}" stroke="${leg2.stroke}" stroke-width="${strokeW}" stroke-linecap="round" stroke-dasharray="10 16" />`
    );
    lines.push(
      `<line x1="${bDash.x2}" y1="${bDash.y2}" x2="${b.x2}" y2="${b.y2}" stroke="transparent" stroke-width="1" marker-end="url(#${leg2.marker})" pointer-events="none" />`
    );
  }

  const nodeGroups = [];
  for (const nodeKey of renderOrder) {
    const n = nodeMap.get(nodeKey);
    if (!n) continue;
    const p = pos[n.key];
    const x = p.x - hbW;
    const y = p.y - hbH;
    const pk = n.powerKw;
    const pkAbs = Math.abs(pk);
    const pkDigits = pkAbs >= 10 ? 1 : pkAbs >= 1 ? 2 : pkAbs >= 0.01 ? 2 : 3;
    const kwStr = pk.toLocaleString("de-DE", {
      minimumFractionDigits: pkAbs >= 10 ? 1 : 2,
      maximumFractionDigits: pkDigits,
    });
    const storDe = storageStatusDe(n.status);
    const socInIcon =
      n.key === "STORAGE" && n.chargeLevelPct != null && Number.isFinite(n.chargeLevelPct);
    const socPct = socInIcon ? Math.max(0, Math.min(100, n.chargeLevelPct)) : null;
    const storageSubline =
      n.key === "STORAGE"
        ? socInIcon
          ? storDe ?? "\u2007"
          : [
              n.chargeLevelPct != null ? `${Math.round(n.chargeLevelPct)}\u202f%` : null,
              storDe,
            ]
              .filter(Boolean)
              .join(" · ") || "\u2007"
        : "\u2007";
    const storageSublineVisible =
      n.key === "STORAGE" && (socInIcon ? !!storDe : !!(n.chargeLevelPct != null || storDe));

    const iconChar =
      n.key === "PV"
        ? Math.abs(n.powerKw) >= FLOW_ACTIVE_EPS_KW
          ? "\u2600"
          : "\u263D"
        : n.key === "LOAD"
          ? "\u{1F3E0}"
          : n.key === "GRID"
            ? "\u26A1"
            : "\u{1F50B}";

    const socText =
      socPct != null
        ? `<text x="32" y="27" text-anchor="middle" dominant-baseline="central" fill="#ecfdf5" stroke="rgba(0,0,0,0.42)" stroke-width="0.35" paint-order="stroke fill" font-size="${socPct >= 100 ? 6 : 7}" font-weight="700">${Math.round(socPct)}%</text>`
        : "";

    const iconY = n.key === "STORAGE" && socPct != null ? 16 : 22;
    const iconLine = `<text x="32" y="${iconY}" text-anchor="middle" class="se-node-icon">${iconChar}</text>`;

    nodeGroups.push(`
      <g transform="translate(${x},${y})">
        <rect width="${boxW}" height="${boxH}" rx="11" class="se-node-rect" />
        ${iconLine}
        ${socText}
        <text x="32" y="45" text-anchor="middle" fill="${FLOW_KW_COLOR}" font-size="12" font-weight="700">
          ${escapeXml(kwStr)}<tspan fill="${FLOW_KW_UNIT_COLOR}" font-size="10.5" font-weight="600"> kW</tspan>
        </text>
        <text x="32" y="58.5" text-anchor="middle" fill="var(--secondary-text-color)" font-size="9" fill-opacity="${storageSublineVisible ? 1 : 0}">
          ${n.key === "STORAGE" ? escapeXml(storageSubline) : "\u2007"}
        </text>
      </g>
    `);
  }

  const hubChip = `
    <g transform="translate(${hubCx - hwBox}, ${hubCy - hhBox})">
      <rect width="${hubW}" height="${hubH}" rx="8" class="se-hub-rect" />
      <text x="${hubW / 2}" y="${hubH / 2 + 4}" text-anchor="middle" font-size="16" class="se-node-icon">\u2699</text>
    </g>
  `;

  return `
    <defs>
      <marker id="${arrowGreen}" markerWidth="6" markerHeight="6" refX="5" refY="3" orient="auto" markerUnits="userSpaceOnUse">
        <path d="M0,0 L6,3 L0,6 Z" fill="${FLOW_MARKER_SOLAR_FILL}" />
      </marker>
      <marker id="${arrowOrange}" markerWidth="6" markerHeight="6" refX="5" refY="3" orient="auto" markerUnits="userSpaceOnUse">
        <path d="M0,0 L6,3 L0,6 Z" fill="${FLOW_MARKER_GRID_IMPORT_FILL}" />
      </marker>
    </defs>
    ${spokes.join("")}
    ${lines.join("")}
    ${nodeGroups.join("")}
    ${hubChip}
  `;
}

class SolarEdgePowerFlowCard extends HTMLElement {
  connectedCallback() {
    if (this._tickInterval) return;
    // Nur die Uhr aktualisieren — kein komplettes Re-Render: sonst starten SVG/CSS-Animationen jede Sekunde neu.
    this._tickInterval = setInterval(() => this._updateLiveClock(), 1000);
    this._setupRefreshInterval();
    this._setupDirectApiPolling();
  }

  _updateLiveClock() {
    if (!this.shadowRoot) return;
    const live = this.shadowRoot.querySelector(".live");
    if (live) {
      live.textContent = `Live ${new Date().toLocaleTimeString("de-DE")}`;
    }
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
    if (this._directApiInterval) {
      clearInterval(this._directApiInterval);
      this._directApiInterval = null;
    }
  }

  static getConfigElement() {
    return document.createElement("solaredge-power-flow-card-editor");
  }

  static getStubConfig() {
    return {
      type: "custom:solaredge-power-flow-card",
      title: "SolarEdge Energiefluss",
      use_direct_api: false,
      site_id: "",
      api_key: "",
      api_poll_seconds: 30,
      entities: {
        pv_power: "",
        house_power: "",
        grid_power: "",
        battery_power: "",
        battery_soc: "",
        pv_energy_today: "",
      },
      show_battery: true,
      show_7d_yield: true,
      watt_threshold_kw: 10,
      force_refresh_seconds: 0,
    };
  }

  setConfig(config) {
    if (
      !config.use_direct_api &&
      (!config.entities || !config.entities.pv_power || !config.entities.house_power || !config.entities.grid_power)
    ) {
      throw new Error("Bitte mindestens pv_power, house_power und grid_power in entities konfigurieren.");
    }

    this._config = {
      title: "SolarEdge Energiefluss",
      show_battery: true,
      watt_threshold_kw: 10,
      force_refresh_seconds: 0,
      use_direct_api: false,
      site_id: "",
      api_key: "",
      api_poll_seconds: 30,
      ...config,
      entities: {
        battery_power: "",
        battery_soc: "",
        pv_energy_today: "",
        ...(config.entities || {}),
      },
      show_7d_yield: config.show_7d_yield !== false,
    };
    this._setupRefreshInterval();
    this._setupDirectApiPolling();
    this._lastYieldHaOkAt = undefined;
    this._yield7d = null;
    this._lastFlowDigest = undefined;
    if (this._hass) this._render();
  }

  set hass(hass) {
    this._hass = hass;
    this._setupRefreshInterval();
    this._setupDirectApiPolling();
    this._maybeFetchYield7dHa();
    this._render();
  }

  getCardSize() {
    return 6;
  }

  _setupRefreshInterval() {
    // Bei direkter SolarEdge-API: Daten kommen per api_poll_seconds — HA-Entities nicht anfassen.
    if (this._config?.use_direct_api) return;
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

  _kwMaybeToW(value, unitMaybe) {
    const n = Number(value);
    if (!Number.isFinite(n)) return 0;
    const u = String(unitMaybe || "").toLowerCase();
    if (u === "kw") return n * 1000;
    return n;
  }

  async _fetchDirectApiData() {
    const siteId = String(this._config?.site_id || "").trim();
    const apiKey = String(this._config?.api_key || "").trim();
    if (!siteId || !apiKey) return;

    const base = `https://monitoringapi.solaredge.com/site/${encodeURIComponent(siteId)}`;
    const overviewUrl = `${base}/overview?api_key=${encodeURIComponent(apiKey)}`;
    const flowUrl = `${base}/currentPowerFlow?api_key=${encodeURIComponent(apiKey)}`;

    const showYield = this._config?.show_7d_yield !== false;
    const endD = new Date();
    const startD = new Date(endD);
    startD.setDate(startD.getDate() - 6);
    const sd = formatLocalYmd(startD);
    const ed = formatLocalYmd(endD);
    const energyUrl = showYield
      ? `${base}/energy?api_key=${encodeURIComponent(apiKey)}&timeUnit=DAY&startDate=${encodeURIComponent(sd)}&endDate=${encodeURIComponent(ed)}`
      : null;

    const energyPromise = energyUrl ? fetch(energyUrl) : Promise.resolve(null);
    const [overviewResp, flowResp, energyResp] = await Promise.all([
      fetch(overviewUrl),
      fetch(flowUrl),
      energyPromise,
    ]);
    if (!overviewResp.ok || !flowResp.ok) {
      throw new Error(`SolarEdge API Fehler (${overviewResp.status}/${flowResp.status})`);
    }

    const overviewJson = await overviewResp.json();
    const flowJson = await flowResp.json();
    const ov = overviewJson?.overview || {};
    const flow = flowJson?.siteCurrentPowerFlow || flowJson || {};

    const pvW =
      this._kwMaybeToW(flow?.PV?.currentPower, flow?.unit) ||
      this._kwMaybeToW(ov?.currentPower?.power, ov?.currentPower?.unit);
    const loadW = this._kwMaybeToW(flow?.LOAD?.currentPower, flow?.unit);
    const gridW = this._kwMaybeToW(flow?.GRID?.currentPower, flow?.unit);
    const batteryW = this._kwMaybeToW(flow?.STORAGE?.currentPower, flow?.unit);
    const batterySoc = Number(flow?.STORAGE?.chargeLevel || flow?.STORAGE?.chargeLevelPercent);

    this._directData = {
      pvW: Number.isFinite(pvW) ? pvW : 0,
      loadW: Number.isFinite(loadW) ? loadW : 0,
      gridW: Number.isFinite(gridW) ? gridW : 0,
      batteryW: Number.isFinite(batteryW) ? batteryW : 0,
      batterySoc: Number.isFinite(batterySoc) ? batterySoc : NaN,
      lastFetch: new Date(),
    };
    const normalized = normalizePowerFlowFromApi(flow);
    const showBatt = Boolean(this._config?.show_battery);
    const synthetic = buildSyntheticPowerFlow(pvW, loadW, gridW, batteryW, batterySoc, showBatt);
    if (!normalized) {
      this._directPowerFlow = synthetic;
    } else if (!normalized.connections?.length) {
      this._directPowerFlow = { ...normalized, connections: synthetic.connections };
    } else {
      this._directPowerFlow = normalized;
    }

    if (showYield && energyResp) {
      if (energyResp.ok) {
        const energyJson = await energyResp.json();
        this._yield7d = {
          days: parseSolarEdgeEnergy7d(energyJson),
          error: "",
          source: "api",
        };
      } else {
        this._yield7d = {
          days: [],
          error: `Tagesertrag (${energyResp.status})`,
          source: "api",
        };
      }
    } else if (!showYield) {
      this._yield7d = null;
    }

    this._directApiError = "";
  }

  _setupDirectApiPolling() {
    if (this._directApiInterval) {
      clearInterval(this._directApiInterval);
      this._directApiInterval = null;
    }

    if (!this._config?.use_direct_api) return;
    const siteId = String(this._config?.site_id || "").trim();
    const apiKey = String(this._config?.api_key || "").trim();
    if (!siteId || !apiKey) return;

    const secs = Math.max(5, Number(this._config?.api_poll_seconds || 30));
    const doFetch = async () => {
      try {
        await this._fetchDirectApiData();
      } catch (err) {
        this._directApiError = err?.message || "SolarEdge API Abruf fehlgeschlagen";
      } finally {
        this._render();
      }
    };
    doFetch();
    this._directApiInterval = setInterval(doFetch, secs * 1000);
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

  _yieldDigest() {
    if (this._config?.show_7d_yield === false) return "off";
    const api = this._config?.use_direct_api ? "1" : "0";
    const eid = String(this._config?.entities?.pv_energy_today || "").trim();
    const y = this._yield7d;
    const head = `${api}|${eid}|`;
    if (!y) return `${head}null`;
    if (y.error) return `${head}e:${String(y.error).slice(0, 80)}`;
    if (!y.days?.length) return `${head}empty`;
    return `${head}${y.days.map((x) => `${x.key}:${x.kwh == null ? "n" : Number(x.kwh).toFixed(3)}`).join(",")}`;
  }

  _maybeFetchYield7dHa() {
    if (this._config?.show_7d_yield === false) return;
    if (this._config?.use_direct_api) return;
    const entityId = String(this._config?.entities?.pv_energy_today || "").trim();
    if (!entityId || !this._hass?.callApi) return;
    if (this._yieldHaInflight) return;
    const now = Date.now();
    const throttleMs = 15 * 60 * 1000;
    if (this._lastYieldHaOkAt && now - this._lastYieldHaOkAt < throttleMs && this._yield7d?.days?.length) return;

    this._yieldHaInflight = true;
    (async () => {
      try {
        const end = new Date();
        const start = new Date();
        start.setDate(start.getDate() - 10);
        const path = `history/period/${encodeURIComponent(start.toISOString())}?filter_entity_id=${encodeURIComponent(entityId)}&end_time=${encodeURIComponent(end.toISOString())}`;
        const data = await this._hass.callApi("GET", path);
        let days = parseHistoryDailyMaxKwh(data, null, 7);
        const st = this._hass.states?.[entityId];
        const unit = String(st?.attributes?.unit_of_measurement || "kWh").toLowerCase();
        if (unit.includes("wh") && !unit.includes("kwh")) {
          days = days.map((d) => ({
            ...d,
            kwh: d.kwh != null && Number.isFinite(d.kwh) ? d.kwh / 1000 : d.kwh,
          }));
        }
        this._yield7d = { days, error: "", source: "hass" };
      } catch (err) {
        this._yield7d = {
          days: [],
          error: err?.message || "History-Abruf fehlgeschlagen",
          source: "hass",
        };
      } finally {
        this._yieldHaInflight = false;
        this._lastYieldHaOkAt = Date.now();
        this._render();
      }
    })();
  }

  _computeFlowModel() {
    const e = this._config.entities;
    const useDirectApi = Boolean(this._config.use_direct_api);
    const showBattery = Boolean(this._config.show_battery && (useDirectApi || e.battery_power));

    let pvW;
    let loadW;
    let gridW;
    let battW;
    let socRaw;

    if (useDirectApi && this._directData) {
      pvW = this._directData.pvW;
      loadW = this._directData.loadW;
      gridW = this._directData.gridW;
      battW = showBattery ? this._directData.batteryW : 0;
      socRaw = this._directData.batterySoc;
    } else if (useDirectApi) {
      pvW = loadW = gridW = battW = 0;
      socRaw = NaN;
    } else {
      const pvRaw = this._stateValue(e.pv_power);
      const loadRaw = this._stateValue(e.house_power);
      const gridRaw = this._stateValue(e.grid_power);
      const battRaw = showBattery ? this._stateValue(e.battery_power) : 0;
      socRaw = e.battery_soc ? this._stateValue(e.battery_soc, NaN) : NaN;

      pvW = this._toW(pvRaw, this._entityUnit(e.pv_power));
      loadW = this._toW(loadRaw, this._entityUnit(e.house_power));
      gridW = this._toW(gridRaw, this._entityUnit(e.grid_power));
      battW = showBattery ? this._toW(battRaw, this._entityUnit(e.battery_power)) : 0;
    }

    let flowPayload;
    if (useDirectApi) {
      flowPayload =
        this._directPowerFlow ||
        buildSyntheticPowerFlow(pvW, loadW, gridW, battW, socRaw, showBattery);
    } else {
      flowPayload = buildSyntheticPowerFlow(pvW, loadW, gridW, battW, socRaw, showBattery);
    }
    flowPayload = filterPowerFlowForBattery(flowPayload, showBattery);

    return {
      pvW,
      loadW,
      gridW,
      battW,
      socRaw,
      showBattery,
      useDirectApi,
      flowPayload,
      nowKw: this._formatKwFromW(pvW),
    };
  }

  _digestFromFlowModel(m) {
    const rW = (w) => String(Math.round(Number(w) || 0));
    const soc = Number.isFinite(m.socRaw) ? String(Math.round(m.socRaw * 10) / 10) : "x";
    const conns = [...m.flowPayload.connections]
      .map((c) => `${c.from}>${c.to}`)
      .sort()
      .join(",");
    const nodes = [...m.flowPayload.nodes]
      .map((n) => `${n.key}:${rW((n.powerKw || 0) * 1000)}:${n.chargeLevelPct ?? ""}:${n.status ?? ""}`)
      .sort()
      .join(";");
    return [
      m.useDirectApi ? 1 : 0,
      rW(m.pvW),
      rW(m.loadW),
      rW(m.gridW),
      rW(m.battW),
      soc,
      m.showBattery ? 1 : 0,
      conns,
      nodes,
      this._config.title || "",
    ].join("|");
  }

  _render() {
    if (!this._hass || !this._config) return;

    if (!this.shadowRoot) this.attachShadow({ mode: "open" });

    const model = this._computeFlowModel();
    const flowDigest = this._digestFromFlowModel(model);
    const yieldDigest = this._yieldDigest();
    const digest = `${flowDigest}|yield:${yieldDigest}`;
    if (digest === this._lastFlowDigest && this.shadowRoot.querySelector("ha-card")) {
      this._updateLiveClock();
      return;
    }
    this._lastFlowDigest = digest;

    const { flowPayload, nowKw } = model;
    const liveTime = new Date().toLocaleTimeString("de-DE");
    if (!this._flowSvgUid) this._flowSvgUid = `se${Math.random().toString(36).slice(2, 10)}`;
    const flowSvgInner = buildPowerFlowSvgMarkup(flowPayload, this._flowSvgUid);
    const yieldHtml = buildYield7dHtml(this._yield7d, this._config);

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
      .se-flow-diagram {
        padding: 2px 4px 6px;
      }
      .flow-title {
        margin-bottom: 8px;
        text-align: center;
        font-size: 11px;
        font-weight: 600;
        text-transform: uppercase;
        letter-spacing: 0.2em;
        color: var(--secondary-text-color);
      }
      .se-flow-svg {
        display: block;
        width: 100%;
        max-width: 352px;
        margin: 0 auto;
        height: auto;
        overflow: visible;
      }
      @keyframes seFlowDashScroll {
        to { stroke-dashoffset: -26; }
      }
      .se-flow-svg line.se-dash-line {
        stroke-dasharray: 10 16;
        stroke-dashoffset: 0;
      }
      /* Strichbewegung in Flussrichtung (Linie Quelle->Ziel); fwd = entlang x1->x2. */
      .se-flow-svg line.se-dash-anim-fwd {
        animation: seFlowDashScroll 1.35s linear infinite;
      }
      .se-flow-svg line.se-dash-anim-rev {
        animation: seFlowDashScroll 1.35s linear infinite reverse;
      }
      @media (prefers-reduced-motion: reduce) {
        .se-flow-svg line.se-dash-line {
          animation: none !important;
        }
      }
      .se-node-rect {
        fill: rgba(var(--rgb-primary-text-color), 0.07);
        stroke: rgba(var(--rgb-primary-text-color), 0.38);
        stroke-width: 1;
      }
      .se-hub-rect {
        fill: rgba(15, 23, 42, 0.55);
        stroke: rgba(148, 163, 184, 0.35);
        stroke-width: 1;
      }
      .se-node-icon {
        font-size: 13px;
        opacity: 0.95;
        fill: var(--primary-text-color);
      }
      .yield-7d {
        margin-top: 12px;
        padding-top: 10px;
        border-top: 1px solid rgba(148, 163, 184, 0.2);
      }
      .yield-title {
        text-align: center;
        font-size: 11px;
        font-weight: 600;
        text-transform: uppercase;
        letter-spacing: 0.18em;
        color: var(--secondary-text-color);
        margin-bottom: 10px;
      }
      .yield-hint,
      .yield-err {
        font-size: 0.72rem;
        text-align: center;
        color: var(--secondary-text-color);
        line-height: 1.35;
        margin-bottom: 8px;
      }
      .yield-err {
        color: rgba(251, 146, 60, 0.95);
      }
      .yield-bars {
        display: flex;
        justify-content: space-between;
        align-items: flex-end;
        gap: 4px;
        min-height: 118px;
        padding: 0 2px 4px;
      }
      .yield-col {
        flex: 1;
        min-width: 0;
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 3px;
      }
      .yield-bar-wrap {
        width: 100%;
        max-width: 34px;
        height: 72px;
        margin: 0 auto;
        display: flex;
        align-items: flex-end;
        justify-content: center;
        border-radius: 6px;
        background: rgba(15, 23, 42, 0.45);
        border: 1px solid rgba(148, 163, 184, 0.15);
      }
      .yield-bar {
        width: 100%;
        border-radius: 5px 5px 2px 2px;
        background: linear-gradient(to top, rgba(16, 185, 129, 0.35), rgba(74, 222, 128, 0.92));
        min-height: 4px;
      }
      .yield-lbl {
        font-size: 0.65rem;
        font-weight: 600;
        color: var(--primary-text-color);
        text-transform: capitalize;
      }
      .yield-sub {
        font-size: 0.58rem;
        color: var(--secondary-text-color);
      }
      .yield-val {
        font-size: 0.62rem;
        font-weight: 600;
        color: rgba(248, 113, 113, 0.95);
      }
    `;

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
        <div class="se-flow-diagram">
          <div class="flow-title">Leistungsfluss</div>
          <svg class="se-flow-svg" viewBox="0 -36 304 272" role="img" aria-label="SolarEdge Leistungsfluss">
            ${flowSvgInner}
          </svg>
        </div>
        ${yieldHtml}
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
      "entities.pv_energy_today": ["energy", "today", "daily", "yield", "production", "day"],
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
        <label>
          <span>Direkte SolarEdge API nutzen</span>
          <input type="checkbox" data-path="use_direct_api" ${this._value("use_direct_api", false) ? "checked" : ""} />
        </label>
        <label>
          <span>SolarEdge Site ID</span>
          <input data-path="site_id" value="${this._value("site_id", "")}" />
        </label>
        <label>
          <span>SolarEdge API Key</span>
          <input data-path="api_key" value="${this._value("api_key", "")}" />
        </label>
        <label>
          <span>API Polling (Sekunden)</span>
          <input type="number" min="5" data-path="api_poll_seconds" value="${this._value("api_poll_seconds", 30)}" />
        </label>
        <span style="font-size:0.8rem; opacity:0.75;">
          Dropdowns zeigen bevorzugt passende SolarEdge-Entitaeten.
        </span>
        ${this._selectRow("PV Leistung", "entities.pv_power")}
        ${this._selectRow("Hausverbrauch", "entities.house_power")}
        ${this._selectRow("Netzleistung (+Bezug / -Einspeisung)", "entities.grid_power")}
        ${this._selectRow("Batterieleistung (+Entladen / -Laden)", "entities.battery_power")}
        ${this._selectRow("Batterie SoC (%)", "entities.battery_soc")}
        ${this._selectRow("PV Tagesertrag (optional, für 7-Tage-Balken ohne API)", "entities.pv_energy_today")}
        <label>
          <span>7-Tage-Ertrag anzeigen</span>
          <input type="checkbox" data-path="show_7d_yield" ${this._value("show_7d_yield", true) ? "checked" : ""} />
        </label>
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
  description: "Visualisiert PV, Haus, Netz, Batterie, 7-Tage-Ertrag und Leistungsfluss.",
  version: SOLAREDGE_CARD_VERSION,
  preview: true,
});

console.info(`SolarEdge Power Flow Card loaded (v${SOLAREDGE_CARD_VERSION})`);
