# SolarEdge Power Flow Card (Home Assistant)

Diese Custom Card zeigt die wichtigsten SolarEdge-Energiefluesse in einer kompakten, modernen Ansicht:

- PV Leistung
- Hausverbrauch
- Netzleistung (Bezug/Einspeisung)
- Optional: Batterie Leistung + SoC

## Installation (HACS)

1. Dieses Repository zu GitHub pushen.
2. In Home Assistant -> HACS -> Frontend -> Benutzerdefinierte Repositories.
3. Repository URL eintragen, Kategorie `Dashboard`.
4. Card installieren und Home Assistant neu laden.

## Installation (manuell)

1. Datei `solaredge-power-flow-card.js` nach `/config/www/` kopieren.
2. Unter Einstellungen -> Dashboards -> Ressourcen hinzufuegen:
   - URL: `/local/solaredge-power-flow-card.js`
   - Typ: `JavaScript-Modul`

## Beispiel-Konfiguration (YAML)

```yaml
type: custom:solaredge-power-flow-card
title: SolarEdge Energiefluss
entities:
  pv_power: sensor.solaredge_pv_power
  house_power: sensor.solaredge_house_consumption
  grid_power: sensor.solaredge_grid_power
  battery_power: sensor.solaredge_battery_power
  battery_soc: sensor.solaredge_battery_soc
show_battery: true
watt_threshold_kw: 10
```

## Hinweise zur Vorzeichenlogik

- `grid_power`: `+` = Netzbezug, `-` = Einspeisung
- `battery_power`: `+` = Entladen, `-` = Laden

Falls deine Sensoren anders herum arbeiten, kannst du in Home Assistant einen Template-Sensor mit invertiertem Vorzeichen anlegen.

## Update-Workflow (gegen Browser-Cache)

Bei Updates der Card:

1. Nach GitHub pushen und in HACS `Redownload` ausfuehren.
2. In Home Assistant unter Dashboard-Ressourcen die URL mit Versionsparameter pflegen, z. B.:
   - `/hacsfiles/Solar-Edge-Plugin/solaredge-power-flow-card.js?v=2026.05.13.2`
3. Browser mit `Strg+F5` hart neu laden.

Die Card zeigt unten die geladene Version an. Damit kannst du sofort sehen, ob wirklich die neue Datei aktiv ist.
