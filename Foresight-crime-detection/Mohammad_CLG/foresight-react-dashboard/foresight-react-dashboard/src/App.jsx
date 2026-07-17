import { useEffect, useMemo, useRef, useState } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import "leaflet-draw";
import "leaflet-draw/dist/leaflet.draw.css";
import Papa from "papaparse";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  BarElement,
  Tooltip,
  Legend,
} from "chart.js";
import { Bar } from "react-chartjs-2";

ChartJS.register(CategoryScale, LinearScale, BarElement, Tooltip, Legend);

const WEEK_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTH_LABELS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const HOUR_LABELS = Array.from({ length: 24 }, (_, i) => `${i}`);

const API_BASE = import.meta?.env?.VITE_API_BASE || "http://localhost:3000/api/v1";

function parseDate(value) {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

function crimeColor(row) {
  const g = String(row.CrimeGroup_Name || "").toLowerCase();
  const h = String(row.CrimeHead_Name || "").toLowerCase();
  if (h.includes("murder")) return "#ff3a2e";
  if (h.includes("rape") || h.includes("sexual")) return "#ff6b3d";
  if (h.includes("theft") || h.includes("robbery") || g.includes("property")) return "#ffb800";
  if (g.includes("cyber")) return "#00b4ff";
  return "#34d399";
}

function pointInPolygon(point, vs) {
  const x = point[0];
  const y = point[1];
  let inside = false;
  for (let i = 0, j = vs.length - 1; i < vs.length; j = i++) {
    const xi = vs[i][0];
    const yi = vs[i][1];
    const xj = vs[j][0];
    const yj = vs[j][1];
    const intersect = yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / ((yj - yi) || 1e-9) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

export default function App() {
  const [rows, setRows] = useState([]);
  const [selectedDistricts, setSelectedDistricts] = useState([]);
  const [selectedTypes, setSelectedTypes] = useState([]);
  const [search, setSearch] = useState("");
  const [regionRows, setRegionRows] = useState(null);
  const [aiReport, setAiReport] = useState(null);
  const [isAiLoading, setIsAiLoading] = useState(false);
  const [selectedFir, setSelectedFir] = useState(null);
  const [coordsText, setCoordsText] = useState("Move cursor on map");
  const [mapBounds, setMapBounds] = useState(null);
  const [isRendering, setIsRendering] = useState(false);
  const [renderedCount, setRenderedCount] = useState(0);
  const [renderTotal, setRenderTotal] = useState(0);
  const [mapAllMode, setMapAllMode] = useState(false);
  const [mapStyle, setMapStyle] = useState("street");

  const mapRef = useRef(null);
  const pointLayerRef = useRef(null);
  const drawLayerRef = useRef(null);
  const canvasRendererRef = useRef(null);
  const baseLayersRef = useRef({});
  const currentBaseLayerRef = useRef(null);
  const rowsRef = useRef([]);
  const renderJobRef = useRef(0);

  const districts = useMemo(
    () => [...new Set(rows.map((r) => r.District_Name).filter(Boolean))].sort(),
    [rows]
  );
  const crimeTypes = useMemo(
    () => [...new Set(rows.map((r) => r.CrimeHead_Name).filter(Boolean))].sort(),
    [rows]
  );

  const baseRows = regionRows || rows;
  rowsRef.current = rows;
  const hasUserSelection =
    selectedDistricts.length > 0 ||
    selectedTypes.length > 0 ||
    search.trim().length > 0 ||
    Boolean(regionRows);

  useEffect(() => {
    if (hasUserSelection && mapAllMode) {
      setMapAllMode(false);
    }
  }, [hasUserSelection, mapAllMode]);

  const filteredRows = useMemo(() => {
    const q = search.trim().toLowerCase();
    return baseRows.filter((r) => {
      const lat = Number.parseFloat(r.Latitude);
      const lng = Number.parseFloat(r.Longitude);
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) return false;
      if (selectedDistricts.length && !selectedDistricts.includes(r.District_Name)) return false;
      if (selectedTypes.length && !selectedTypes.includes(r.CrimeHead_Name)) return false;
      if (!q) return true;
      return (
        String(r.FIRNo || "").toLowerCase().includes(q) ||
        String(r.CrimeHead_Name || "").toLowerCase().includes(q) ||
        String(r["Place of Offence"] || "").toLowerCase().includes(q)
      );
    });
  }, [baseRows, selectedDistricts, selectedTypes, search]);

  const timeSeries = useMemo(() => {
    const week = new Array(7).fill(0);
    const hours = new Array(24).fill(0);
    const months = new Array(12).fill(0);
    filteredRows.forEach((r) => {
      const d = parseDate(r.FIR_Reg_DateTime) || parseDate(r.FIR_Date) || parseDate(r.Offence_From_Date);
      if (!d) return;
      week[d.getDay()] += 1;
      hours[d.getHours()] += 1;
      months[d.getMonth()] += 1;
    });
    return { week, hours, months };
  }, [filteredRows]);

  const rowsForMap = useMemo(() => {
    const sourceRows = mapAllMode ? rows : hasUserSelection ? filteredRows : [];
    if (!mapBounds) return sourceRows;
    const viewportRows = sourceRows.filter((r) => {
      const lat = Number.parseFloat(r.Latitude);
      const lng = Number.parseFloat(r.Longitude);
      return mapBounds.contains([lat, lng]);
    });
    return viewportRows;
  }, [rows, filteredRows, mapBounds, hasUserSelection, mapAllMode]);

  useEffect(() => {
    const map = L.map("map", {
      center: [20.5937, 78.9629],
      zoom: 5,
      attributionControl: false,
    });
    mapRef.current = map;

    const streetLayer = L.tileLayer("https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png", {
      maxZoom: 20,
    });
    const satelliteLayer = L.tileLayer(
      "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
      { maxZoom: 19 }
    );
    const labelsLayer = L.tileLayer("https://{s}.basemaps.cartocdn.com/rastertiles/voyager_only_labels/{z}/{x}/{y}{r}.png", {
      maxZoom: 20,
    });
    const terrainLayer = L.tileLayer("https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png", { maxZoom: 17 });
    const hybridLayer = L.layerGroup([satelliteLayer, labelsLayer]);

    baseLayersRef.current = {
      street: streetLayer,
      satellite: satelliteLayer,
      terrain: terrainLayer,
      hybrid: hybridLayer,
    };
    currentBaseLayerRef.current = streetLayer;
    streetLayer.addTo(map);
    canvasRendererRef.current = L.canvas({ padding: 0.5 });

    pointLayerRef.current = L.layerGroup().addTo(map);
    drawLayerRef.current = new L.FeatureGroup();
    map.addLayer(drawLayerRef.current);

    const drawControl = new L.Control.Draw({
      edit: { featureGroup: drawLayerRef.current, edit: false },
      // showArea:false avoids a known leaflet-draw runtime bug in some builds
      draw: {
        polygon: { showArea: false },
        rectangle: { showArea: false },
        circle: true, // Enabled for ML Radius Search
        marker: false,
        polyline: false,
        circlemarker: false,
      },
    });
    map.addControl(drawControl);

    map.on(L.Draw.Event.CREATED, (e) => {
      drawLayerRef.current.clearLayers();
      // Keep drawn region as a visual guide only, so marker clicks still work.
      if (e.layer.setStyle) {
        e.layer.setStyle({
          color: "#3b82f6",
          weight: 2,
          fillColor: "#60a5fa",
          fillOpacity: 0.1,
        });
      }
      if (e.layer.options) {
        e.layer.options.interactive = false;
      }
      drawLayerRef.current.addLayer(e.layer);
      if (drawLayerRef.current.bringToBack) drawLayerRef.current.bringToBack();
      
      const layerType = e.layerType;
      
      // AI RADIUS INTELLIGENCE
      if (layerType === "circle") {
        const center = e.layer.getLatLng();
        const radiusMeters = e.layer.getRadius();
        const radiusKm = radiusMeters / 1000;
        
        // Fetch AI Data from ML Backend
        setIsAiLoading(true);
        fetch(`${API_BASE}/radius-intelligence`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                latitude: center.lat,
                longitude: center.lng,
                radius_km: radiusKm,
                districts: selectedDistricts
            })
        })
        .then(res => res.json())
        .then(data => {
            if (data.status === "success") {
                setAiReport(data);
            }
        })
        .catch(err => console.error("ML API Error:", err))
        .finally(() => setIsAiLoading(false));

        // Filter local rows visually inside the circle
        const inRegion = rowsRef.current.filter((r) => {
          const lat = Number.parseFloat(r.Latitude);
          const lng = Number.parseFloat(r.Longitude);
          if (!Number.isFinite(lat) || !Number.isFinite(lng)) return false;
          const dist = L.latLng(center).distanceTo(L.latLng(lat, lng));
          return dist <= radiusMeters;
        });
        setRegionRows(inRegion);
      } else {
          // Polygon Logic
          const shape = e.layer.toGeoJSON();
          const coords = shape.geometry?.type === "Polygon" ? shape.geometry.coordinates[0] : [];
          if (!coords.length) {
            setRegionRows(null);
            return;
          }
          const inRegion = rowsRef.current.filter((r) => {
            const lat = Number.parseFloat(r.Latitude);
            const lng = Number.parseFloat(r.Longitude);
            if (!Number.isFinite(lat) || !Number.isFinite(lng)) return false;
            return pointInPolygon([lng, lat], coords);
          });
          setRegionRows(inRegion);
      }
    });

    map.on("mousemove", (e) => setCoordsText(`${e.latlng.lat.toFixed(5)}, ${e.latlng.lng.toFixed(5)}`));
    map.on("moveend", () => setMapBounds(map.getBounds()));
    setMapBounds(map.getBounds());

    return () => map.remove();
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    const nextLayer = baseLayersRef.current[mapStyle];
    if (!map || !nextLayer) return;
    if (currentBaseLayerRef.current && map.hasLayer(currentBaseLayerRef.current)) {
      map.removeLayer(currentBaseLayerRef.current);
    }
    nextLayer.addTo(map);
    currentBaseLayerRef.current = nextLayer;
  }, [mapStyle]);

  useEffect(() => {
    const map = mapRef.current;
    const layer = pointLayerRef.current;
    if (!map || !layer) return;
    layer.clearLayers();

    const data = rowsForMap;
    setRenderTotal(data.length);
    setRenderedCount(0);
    setIsRendering(data.length > 0);
    const jobId = Date.now();
    renderJobRef.current = jobId;

    const chunkSize = 700;
    let idx = 0;
    function drawChunk() {
      if (renderJobRef.current !== jobId) return;
      const end = Math.min(idx + chunkSize, data.length);
      for (let i = idx; i < end; i++) {
        const r = data[i];
        const lat = Number.parseFloat(r.Latitude);
        const lng = Number.parseFloat(r.Longitude);
        const color = crimeColor(r);
        const marker = L.circleMarker([lat, lng], {
          renderer: canvasRendererRef.current,
          radius: 5,
          color,
          fillColor: color,
          fillOpacity: 0.58,
          weight: 1,
        });
        marker.bindPopup(
          `<div style="min-width:220px">
            <div style="font-weight:700;margin-bottom:4px">FIR ${r.FIRNo || "-"}</div>
            <div>${r.CrimeHead_Name || "-"}</div>
            <div style="color:#94a3b8">${r.District_Name || "-"} · ${r.UnitName || "-"}</div>
            <div style="color:#94a3b8">${r["Place of Offence"] || "-"}</div>
          </div>`
        );
        marker.on("click", () => setSelectedFir(r));
        marker.addTo(layer);
      }
      if (layer.bringToFront) layer.bringToFront();
      idx = end;
      setRenderedCount(end);
      if (idx < data.length) {
        requestAnimationFrame(drawChunk);
      } else {
        setIsRendering(false);
      }
    }
    requestAnimationFrame(drawChunk);
  }, [rowsForMap]);

  const searchedRows = useMemo(() => filteredRows.slice(0, 300), [filteredRows]);

  function uploadCsv(file) {
    // 1. Process locally for instant map rendering
    Papa.parse(file, {
      header: true,
      dynamicTyping: true,
      skipEmptyLines: true,
      complete: (res) => {
        setRows(res.data || []);
        setRegionRows(null);
        setSelectedDistricts([]);
        setSelectedTypes([]);
        setSearch("");
        setSelectedFir(null);
        setMapAllMode(false);
      },
    });

    // 2. Push to ML Backend to retrain ARIMA and Spatial Models
    const formData = new FormData();
    formData.append("file", file);

    fetch(`${API_BASE}/upload-data`, {
      method: "POST",
      body: formData,
    })
    .then(res => res.json())
    .then(data => {
      console.log("ML Backend Response:", data);
      if (data.status === "success") {
          alert(`Success: ${data.message || "Upload completed"}`);
      } else {
          const errorMsg = data.message || data.detail || data.error || JSON.stringify(data);
          alert(`Warning from ML Engine: ${errorMsg}`);
      }
    })
    .catch(err => {
      console.error("ML Backend Upload Error:", err);
      alert(`Frontend Error: Failed to connect to backend (${err.message})`);
    });
  }

  function toggleValue(value, list, setList) {
    if (list.includes(value)) setList(list.filter((x) => x !== value));
    else setList([...list, value]);
  }

  function clearRegion() {
    setRegionRows(null);
    setAiReport(null);
    if (drawLayerRef.current) drawLayerRef.current.clearLayers();
  }

  function fitVisibleData() {
    const map = mapRef.current;
    if (!map || filteredRows.length === 0) return;
    let bounds = null;
    filteredRows.forEach((r) => {
      const lat = Number.parseFloat(r.Latitude);
      const lng = Number.parseFloat(r.Longitude);
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;
      if (!bounds) bounds = L.latLngBounds([lat, lng], [lat, lng]);
      else bounds.extend([lat, lng]);
    });
    if (bounds) map.fitBounds(bounds, { padding: [24, 24], maxZoom: 13 });
  }

  function mapAllNow() {
    setMapAllMode(true);
  }

  function downloadFirPdf(fir) {
    if (!fir) return;
    const doc = new jsPDF({ unit: "pt", format: "a4" });
    const firNo = String(fir.FIRNo || fir.FIR_ID || "UNKNOWN");
    const title = `FIR Report - ${firNo}`;
    const generatedAt = new Date().toLocaleString();

    doc.setFontSize(18);
    doc.text("Foresight - FIR Detailed Report", 40, 48);
    doc.setFontSize(12);
    doc.text(`FIR No: ${firNo}`, 40, 72);
    doc.text(`Generated: ${generatedAt}`, 40, 90);

    const rows = Object.entries(fir).map(([key, value]) => [key, String(value ?? "")]);
    autoTable(doc, {
      head: [["Field", "Value"]],
      body: rows,
      startY: 110,
      styles: { fontSize: 9, cellPadding: 5, overflow: "linebreak" },
      headStyles: { fillColor: [15, 22, 39] },
      columnStyles: {
        0: { cellWidth: 170, fontStyle: "bold" },
        1: { cellWidth: 340 },
      },
      margin: { left: 40, right: 40 },
    });

    doc.save(`FIR_${firNo}.pdf`);
  }

  return (
    <div className="app">
      <header className="topbar">
        <div className="logo">📍 Foresight</div>
        <div className="sub">React Framework Crime Dashboard</div>
        <div className="pill">{filteredRows.length} filtered</div>
        <div className="pill">{renderedCount}/{renderTotal} rendered</div>
        <div className="pill">{mapAllMode ? "Map: ALL DATA" : hasUserSelection ? "Map: FILTERED" : "Map: WAITING"}</div>
      </header>

      <main className="layout">
        <aside className="left">
          <div className="section-title">Filters</div>
          <label className="label">Upload CSV</label>
          <input type="file" accept=".csv" onChange={(e) => e.target.files?.[0] && uploadCsv(e.target.files[0])} />

          <div className="stats">Total loaded: {rows.length}</div>
          <div className="stats">Region selected: {regionRows ? "Yes" : "No"}</div>

          <label className="label">Search FIR / Crime / Place</label>
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search..." />

          <label className="label">Crime Types</label>
          <div className="chips">
            {crimeTypes.slice(0, 10).map((t) => (
              <button key={t} className={selectedTypes.includes(t) ? "chip active" : "chip"} onClick={() => toggleValue(t, selectedTypes, setSelectedTypes)}>
                {t}
              </button>
            ))}
          </div>

          <label className="label">Districts (multi-select)</label>
          <div className="checkbox-list">
            {districts.map((d) => (
              <label key={d}>
                <input type="checkbox" checked={selectedDistricts.includes(d)} onChange={() => toggleValue(d, selectedDistricts, setSelectedDistricts)} />
                <span>{d}</span>
              </label>
            ))}
          </div>

          <button className="clear-btn" onClick={mapAllNow}>Map All Data</button>
          <button className="clear-btn" onClick={clearRegion}>Clear Drawn Region</button>
          <button className="clear-btn" onClick={fitVisibleData}>Fit Filtered Data</button>

          <div className="section-title">FIR List</div>
          <div className="fir-list">
            {searchedRows.map((r, i) => (
              <button key={`${r.FIR_ID || r.FIRNo || "fir"}-${i}`} className="fir-item" onClick={() => setSelectedFir(r)}>
                <div>{r.CrimeHead_Name || "Crime"}</div>
                <small>FIR: {r.FIRNo || "-"} · {r.District_Name || "-"}</small>
              </button>
            ))}
          </div>
        </aside>

        <section className="center">
          <div className="map-toolbar">
            <button onClick={mapAllNow}>Map All Data</button>
            <button onClick={clearRegion}>Reset Region</button>
            <button onClick={fitVisibleData}>Fit Data</button>
            <select
              className="map-style-select"
              value={mapStyle}
              onChange={(e) => setMapStyle(e.target.value)}
              title="Map style filter"
            >
              <option value="street">Street</option>
              <option value="satellite">Satellite</option>
              <option value="terrain">Terrain</option>
              <option value="hybrid">Hybrid</option>
            </select>
          </div>
          <div id="map" />
          <div className="coords">{coordsText}</div>
          {!mapAllMode && !hasUserSelection && (
            <div className="loading-overlay">
              <div className="loading-card">
                <div>Map is paused by default.</div>
                <div>Apply filters to auto-plot, or click "Map All Data".</div>
              </div>
            </div>
          )}
          {isRendering && (
            <div className="loading-overlay">
              <div className="loading-card">
                <div>Loading map points...</div>
                <div>{renderedCount} / {renderTotal}</div>
              </div>
            </div>
          )}
        </section>

        <aside className="right">
          <div className="section-title">Timing Insights</div>
          <div className="chart-wrap">
            <h4>Weekly Crimes</h4>
            <Bar data={{ labels: WEEK_LABELS, datasets: [{ label: "Crimes", data: timeSeries.week, backgroundColor: "rgba(255,58,46,0.65)" }] }} options={{ responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } } }} />
          </div>
          <div className="chart-wrap">
            <h4>Hourly Crimes</h4>
            <Bar data={{ labels: HOUR_LABELS, datasets: [{ label: "Crimes", data: timeSeries.hours, backgroundColor: "rgba(0,180,255,0.65)" }] }} options={{ responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } } }} />
          </div>
          <div className="chart-wrap">
            <h4>Monthly Crimes</h4>
            <Bar data={{ labels: MONTH_LABELS, datasets: [{ label: "Crimes", data: timeSeries.months, backgroundColor: "rgba(0,255,136,0.65)" }] }} options={{ responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } } }} />
          </div>
        </aside>
      </main>

      {selectedFir && (
        <div className="fir-detail">
          <div className="fir-head">
            <strong>FIR Detail</strong>
            <div className="fir-head-actions">
              <button onClick={() => downloadFirPdf(selectedFir)}>Download PDF</button>
              <button onClick={() => setSelectedFir(null)}>Close</button>
            </div>
          </div>
          <div className="fir-body">
            {Object.entries(selectedFir).map(([k, v]) => (
              <div className="row" key={k}>
                <span>{k}</span>
                <span>{String(v ?? "")}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* AI RADIUS REPORT PANEL */}
      {(isAiLoading || aiReport) && (
          <div className="ai-panel">
            <div className="fir-head">
               <strong>🤖 AI Radius Intelligence</strong>
               <button onClick={() => setAiReport(null)}>Close</button>
            </div>
            <div className="fir-body">
                {isAiLoading ? (
                    <div style={{ padding: '20px', textAlign: 'center', color: '#60a5fa' }}>
                        📡 Sending coordinates to ML Backend...<br/>
                        Analyzing ARIMA Time-Series...
                    </div>
                ) : aiReport.message ? (
                     <div style={{ color: '#ffb800' }}>{aiReport.message}</div>
                ) : (
                    <>
                        <h4 style={{ margin: '0 0 10px 0', color: '#ff3a2e' }}>Severity Score: {aiReport.radius_stats.avg_severity} / 10</h4>
                        <p style={{ margin: '0 0 15px 0', color: '#94a3b8' }}>{aiReport.crime_timing.summary}</p>
                        
                        <div style={{ marginBottom: '15px' }}>
                            <strong style={{ display: 'block', marginBottom: '5px' }}>Most Dangerous Micro-Hotspot:</strong>
                            <div style={{ background: '#1c1917', padding: '10px', borderRadius: '6px', borderLeft: '3px solid #ffb800' }}>
                                <div style={{ color: '#ffb800', fontSize: '15px', fontWeight: 'bold' }}>📍 {aiReport.radius_stats.most_dangerous_place}</div>
                                {aiReport.radius_stats.micro_hotspot && (
                                    <div style={{ fontSize: '13px', color: '#94a3b8', marginTop: '6px' }}>
                                        <div style={{ marginBottom: '3px' }}>
                                            <span style={{ color: '#60a5fa' }}>GPS:</span> {aiReport.radius_stats.micro_hotspot.latitude}, {aiReport.radius_stats.micro_hotspot.longitude}
                                        </div>
                                        <div style={{ marginBottom: '3px' }}>
                                            <span style={{ color: '#ff6b3d' }}>Primary Crime:</span> {aiReport.radius_stats.micro_hotspot.top_crime}
                                        </div>
                                        <div>
                                            <span style={{ color: '#34d399' }}>AI Predicted Peak:</span> {aiReport.radius_stats.micro_hotspot.peak_time}
                                        </div>
                                    </div>
                                )}
                            </div>
                        </div>

                        <div style={{ marginBottom: '15px' }}>
                            <strong style={{ display: 'block', marginBottom: '5px' }}>Top Risks in this Entire Radius:</strong>
                            {aiReport.crime_analysis.top_crime_types.map(c => (
                                <div key={c.type} style={{ display: 'flex', justifyContent: 'space-between', fontSize: '14px', marginBottom: '4px' }}>
                                    <span>{c.type}</span>
                                    <span style={{ color: '#00b4ff' }}>{c.percentage}%</span>
                                </div>
                            ))}
                        </div>

                        {aiReport.environmental_intelligence && (
                            <div style={{ background: '#1c1917', padding: '10px', borderRadius: '6px', marginBottom: '15px', borderLeft: '3px solid #ff1493' }}>
                                <strong style={{ display: 'block', marginBottom: '5px', color: '#ff1493' }}>🌍 Environmental Context APIs</strong>
                                <div style={{ fontSize: '13px', color: '#94a3b8' }}>
                                    Active: <em>Google Places, Open-Meteo</em><br/>
                                    <strong>Detected POIs:</strong> {aiReport.environmental_intelligence.poi_detected?.liquor_stores || 0} Liquor Stores, {aiReport.environmental_intelligence.poi_detected?.nightclubs_bars || 0} Bars<br/>
                                    <strong>API Risk Modifier:</strong> <span style={{ color: '#ff6b3d'}}>+{aiReport.environmental_intelligence.api_risk_modifier || 0}% Crime Amplification</span>
                                </div>
                            </div>
                        )}

                        <div style={{ background: '#0f1627', padding: '10px', borderRadius: '6px', border: '1px solid #1e293b' }}>
                            <strong style={{ display: 'block', marginBottom: '10px', color: '#34d399' }}>📈 7-Day Contextual Forecast</strong>
                            {aiReport.forecast_7_day.predictions && aiReport.forecast_7_day.predictions.length > 0 ? (
                                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                                    {aiReport.forecast_7_day.predictions.map(f => (
                                        <div key={f.date} style={{ textAlign: 'center', fontSize: '12px' }}>
                                            <div style={{ color: '#94a3b8' }}>{f.date.slice(-5)}</div>
                                            <div style={{ fontSize: '15px', fontWeight: 'bold' }}>
                                                {f.predicted_count < 10 ? Number(f.predicted_count).toFixed(2) : Math.round(f.predicted_count)}
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            ) : (
                                <div style={{ color: '#94a3b8', fontSize: '13px', textAlign: 'center' }}>No mathematical sequence pattern detected.</div>
                            )}
                        </div>
                        
                        <div style={{ marginTop: '15px', fontSize: '13px', color: '#60a5fa', display: 'flex', justifyContent: 'space-between' }}>
                            <span>Repeat Probability: <strong>{aiReport.repeat_probability_pct}%</strong></span>
                            <span style={{ color: '#94a3b8', fontStyle: 'italic' }}>Live ML Active</span>
                        </div>
                    </>
                )}
            </div>
          </div>
      )}
    </div>
  );
}

