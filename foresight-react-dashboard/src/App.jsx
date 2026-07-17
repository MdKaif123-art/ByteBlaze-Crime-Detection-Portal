import { useEffect, useMemo, useRef, useState } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import "leaflet-draw";
import "leaflet-draw/dist/leaflet.draw.css";
import "leaflet.heat";
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
import { onValue, push, ref, set, update } from "firebase/database";
import SosPanel from "./sos/SosPanel";
import { getRealtimeDb, PATROL_ASSIGNMENTS_RTDB_PATH, PATROL_TO_ADMIN_RTDB_PATH } from "./sos/firebase";
import { usePatrolUnits } from "./sos/usePatrolUnits";
import { fetchOsrmDrivingRoute } from "./osrm";
import { getDistrictPredictions, postRadiusIntelligence, uploadFirCsv } from "./crime/crimeMlApi";

ChartJS.register(CategoryScale, LinearScale, BarElement, Tooltip, Legend);

/** Crime prediction Node API (proxies to ML service). Set `VITE_CRIME_API_BASE` if not on localhost:3000. */
const CRIME_API_BASE =
  (typeof import.meta !== "undefined" && import.meta.env && import.meta.env.VITE_CRIME_API_BASE) ||
  (typeof import.meta !== "undefined" && import.meta.env && import.meta.env.VITE_API_BASE) ||
  "http://localhost:3000/api/v1";

const WEEK_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTH_LABELS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const HOUR_LABELS = Array.from({ length: 24 }, (_, i) => `${i}`);
const LOGIN_CREDENTIALS = {
  "tamilnadu@gmail.com": {
    password: "123456",
    welcome: "Welcome to Tmailnadu crime portal",
  },
  "karnataka@gmail.com": {
    password: "123456",
    welcome: "Welcome to the Karnataka crime portal",
  },
};

/** Nearest patrol is auto-dispatched only inside this radius (haversine meters). */
const PATROL_SOS_NEARBY_MAX_METERS = 35_000;
/** SOS alerts newer than this may trigger auto-dispatch (dashboard must stay open for effect to run). */
const PATROL_SOS_AUTO_ASSIGN_MAX_AGE_MS = 30 * 60 * 1000;

function parseDate(value) {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** Best-effort datetime for a crime row (FIR / offence fields vary by CSV). */
function getCrimeDateTime(row) {
  if (!row || typeof row !== "object") return null;
  const keys = [
    "FIR_Reg_DateTime",
    "FIR_Date",
    "Offence_From_Date",
    "Offence_To_Date",
    "FIR Registration Date",
    "Date of Offence",
  ];
  for (const k of keys) {
    const d = parseDate(row[k]);
    if (d) return d;
  }
  return null;
}

function startOfLocalDayYmd(ymd) {
  if (!ymd || typeof ymd !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(ymd.trim())) return null;
  const [y, m, d] = ymd.trim().split("-").map((x) => Number.parseInt(x, 10));
  if (!Number.isFinite(y) || !Number.isFinite(m) || !Number.isFinite(d)) return null;
  const t = new Date(y, m - 1, d, 0, 0, 0, 0).getTime();
  return Number.isFinite(t) ? t : null;
}

function endOfLocalDayYmd(ymd) {
  if (!ymd || typeof ymd !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(ymd.trim())) return null;
  const [y, m, d] = ymd.trim().split("-").map((x) => Number.parseInt(x, 10));
  if (!Number.isFinite(y) || !Number.isFinite(m) || !Number.isFinite(d)) return null;
  const t = new Date(y, m - 1, d, 23, 59, 59, 999).getTime();
  return Number.isFinite(t) ? t : null;
}

/** Day = 06:00–17:59 local; night = otherwise. */
function crimeIsDayTime(d) {
  if (!d) return null;
  const h = d.getHours();
  return h >= 6 && h < 18;
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

function parseLatLng(row) {
  const lat = Number.parseFloat(row?.Latitude);
  const lng = Number.parseFloat(row?.Longitude);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return null;
  return { lat, lng };
}

function getSosUserKey(report) {
  if (!report || typeof report !== "object") return "";
  return String(report.user_id || report.phone || report.mobile || report.phone_number || report.id || "");
}

function latestSosByUser(reports) {
  const out = [];
  const seen = new Set();
  for (const report of reports) {
    const key = getSosUserKey(report);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(report);
  }
  return out;
}

function latestPatrolAssignmentForSos(patrolAssignments, sosId) {
  if (sosId == null || !Array.isArray(patrolAssignments)) return null;
  const sid = String(sosId);
  const matches = patrolAssignments.filter((a) => String(a.sos_id) === sid);
  if (!matches.length) return null;
  return matches.sort((a, b) => new Date(b.assigned_at || 0) - new Date(a.assigned_at || 0))[0];
}

function sosHasOpenDispatch(patrolAssignments, sosId) {
  if (sosId == null || !Array.isArray(patrolAssignments)) return false;
  const sid = String(sosId);
  return patrolAssignments.some(
    (x) =>
      String(x.sos_id) === sid &&
      ["pending_accept", "routing", "assigned", "queued"].includes(String(x.status || "").toLowerCase())
  );
}

function parseCreatedAtMillis(report) {
  const raw = report?.created_at ?? report?.timestamp ?? report?.createdAt;
  if (raw == null) return 0;
  if (typeof raw === "number") return raw > 1e12 ? raw : raw * 1000;
  const t = new Date(raw).getTime();
  return Number.isFinite(t) ? t : 0;
}

function haversineMeters(a, b) {
  const R = 6371000;
  const toRad = (x) => (x * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const sa =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
  return 2 * R * Math.asin(Math.sqrt(sa));
}

/** Map pin icon — tip at lat/lng for precise placement (patrol + enrollment + relocate). */
function patrolPinDivIcon({ variant = "unit" } = {}) {
  const accent =
    variant === "pending" || variant === "hover"
      ? "#f59e0b"
      : variant === "relocate"
        ? "#7c3aed"
        : "#2563eb";
  const shadow =
    variant === "pending" || variant === "hover"
      ? "rgba(245,158,11,0.45)"
      : variant === "relocate"
        ? "rgba(124,58,237,0.45)"
        : "rgba(37,99,235,0.45)";
  const pinOpacity = variant === "hover" ? 0.78 : 1;
  return L.divIcon({
    className: "patrol-map-pin",
    html: `<div style="position:relative;width:32px;height:40px;opacity:${pinOpacity};filter:drop-shadow(0 3px 6px ${shadow});pointer-events:none;">
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 36" width="32" height="40" aria-hidden="true">
        <path fill="${accent}" stroke="#fff" stroke-width="1.5" d="M12 0C5.4 0 0 5.4 0 12c0 8.25 12 24 12 24s12-15.75 12-24c0-6.6-5.4-12-12-12z"/>
        <circle cx="12" cy="12" r="5" fill="#fff"/>
      </svg>
      <div style="position:absolute;left:50%;top:7px;transform:translateX(-50%);font-size:12px;line-height:1;">🚓</div>
    </div>`,
    iconSize: [32, 40],
    iconAnchor: [16, 40],
    popupAnchor: [0, -38],
  });
}

/** Patrol position on map: live GPS when set, otherwise enrolled station (mobile app updates `location_*` while moving). */
function getPatrolLatLng(p) {
  if (!p || typeof p !== "object") return null;
  const liveLat = Number.parseFloat(p.live_lat);
  const liveLng = Number.parseFloat(p.live_lng);
  if (Number.isFinite(liveLat) && Number.isFinite(liveLng)) return { lat: liveLat, lng: liveLng };
  const lat = Number.parseFloat(p.location_lat);
  const lng = Number.parseFloat(p.location_lng);
  if (Number.isFinite(lat) && Number.isFinite(lng)) return { lat, lng };
  return null;
}

export default function App() {
  const [rows, setRows] = useState([]);
  const [selectedDistricts, setSelectedDistricts] = useState([]);
  const [selectedUnits, setSelectedUnits] = useState([]);
  const [selectedTypes, setSelectedTypes] = useState([]);
  const [search, setSearch] = useState("");
  const [filterDateFrom, setFilterDateFrom] = useState("");
  const [filterDateTo, setFilterDateTo] = useState("");
  const [timeOfDayFilter, setTimeOfDayFilter] = useState("all");
  const [regionRows, setRegionRows] = useState(null);
  const [selectedFir, setSelectedFir] = useState(null);
  const [coordsText, setCoordsText] = useState("Move cursor on map");
  const [mapBounds, setMapBounds] = useState(null);
  const [isRendering, setIsRendering] = useState(false);
  const [renderedCount, setRenderedCount] = useState(0);
  const [renderTotal, setRenderTotal] = useState(0);
  const [mapAllMode, setMapAllMode] = useState(false);
  const [mapStyle, setMapStyle] = useState("street");
  /** Right panel: timing charts | Firebase SOS | patrol (placeholder) */
  const [rightTab, setRightTab] = useState("timing");
  const [sosReports, setSosReports] = useState([]);
  const [selectedSosReport, setSelectedSosReport] = useState(null);
  const { patrolUnits: enrolledPatrols } = usePatrolUnits();
  const [patrolStatusText, setPatrolStatusText] = useState("");
  const [patrolToAdminFeed, setPatrolToAdminFeed] = useState([]);
  const [patrolMessageTarget, setPatrolMessageTarget] = useState("");
  const [patrolMessageSearch, setPatrolMessageSearch] = useState("");
  const [patrolMessageListOpen, setPatrolMessageListOpen] = useState(false);
  const [patrolMessageText, setPatrolMessageText] = useState("");
  const [osrmRoutes, setOsrmRoutes] = useState({});
  const [patrolAssignments, setPatrolAssignments] = useState([]);
  const [aiReport, setAiReport] = useState(null);
  const [isAiLoading, setIsAiLoading] = useState(false);
  const [aiError, setAiError] = useState(null);
  /** Last map circle used for ML (center + radius). Lets user re-send or change radius without redrawing. */
  const [aiCircleArea, setAiCircleArea] = useState(null);
  const [districtForecast, setDistrictForecast] = useState(null);
  const [districtForecastLoading, setDistrictForecastLoading] = useState(false);
  const [districtForecastError, setDistrictForecastError] = useState(null);
  const [aiDistrictPick, setAiDistrictPick] = useState("");
  const [aiHorizonDays, setAiHorizonDays] = useState(7);
  const [authUser, setAuthUser] = useState(() => {
    try {
      const raw = window.localStorage.getItem("foresight_auth_user");
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  });
  const [loginEmail, setLoginEmail] = useState("");
  const [loginPassword, setLoginPassword] = useState("");
  const [loginError, setLoginError] = useState("");
  const selectedDistrictsRef = useRef([]);
  /** Latest radius-ML fetch (map draw, SOS shortcut, panel button share this; avoids stale useEffect closures). */
  const radiusMlRunnerRef = useRef(async () => {});

  const mapRef = useRef(null);
  const pointLayerRef = useRef(null);
  const drawLayerRef = useRef(null);
  const sosLayerRef = useRef(null);
  const canvasRendererRef = useRef(null);
  const baseLayersRef = useRef({});
  const currentBaseLayerRef = useRef(null);
  const rowsRef = useRef([]);
  const renderJobRef = useRef(0);
  const sosMarkerByIdRef = useRef(new Map());
  const patrolMessageComboRef = useRef(null);
  const heatLayerRef = useRef(null);
  const predictionHoverPopupRef = useRef(null);
  const cyberOverlayRef = useRef(null);
  const cyberPulseRef = useRef(null);
  const cyberAnimTimerRef = useRef(null);

  useEffect(() => {
    function onDocMouseDown(ev) {
      const el = patrolMessageComboRef.current;
      if (el && !el.contains(ev.target)) setPatrolMessageListOpen(false);
    }
    document.addEventListener("mousedown", onDocMouseDown);
    return () => document.removeEventListener("mousedown", onDocMouseDown);
  }, []);

  useEffect(() => {
    selectedDistrictsRef.current = selectedDistricts;
  }, [selectedDistricts]);

  radiusMlRunnerRef.current = async (area) => {
    if (!area) return;
    setAiError(null);
    setDistrictForecastError(null);
    setAiReport(null);
    setIsAiLoading(true);
    try {
      const districtsPayload = selectedDistrictsRef.current?.length ? selectedDistrictsRef.current : undefined;
      const data = await postRadiusIntelligence(CRIME_API_BASE, {
        latitude: area.lat,
        longitude: area.lng,
        radius_km: area.radiusKm,
        districts: districtsPayload,
      });
      if (data?.status === "success") setAiReport(data);
      else setAiError(data?.message || data?.error || "Unexpected response from ML API");
    } catch (err) {
      console.error("Crime ML API:", err);
      setAiError(err?.message || "Could not reach crime prediction backend. Is it running?");
    } finally {
      setIsAiLoading(false);
    }
  };

  /** Keep table/map region in sync when the AI circle radius is edited in the panel. */
  useEffect(() => {
    if (!aiCircleArea) return;
    const { lat, lng, radiusKm } = aiCircleArea;
    const radiusMeters = radiusKm * 1000;
    const center = L.latLng(lat, lng);
    const inCircle = rowsRef.current.filter((r) => {
      const la = Number.parseFloat(r.Latitude);
      const ln = Number.parseFloat(r.Longitude);
      if (!Number.isFinite(la) || !Number.isFinite(ln)) return false;
      return center.distanceTo(L.latLng(la, ln)) <= radiusMeters;
    });
    setRegionRows(inCircle);
  }, [aiCircleArea]);

  const districts = useMemo(
    () => [...new Set(rows.map((r) => r.District_Name).filter(Boolean))].sort(),
    [rows]
  );
  const crimeTypes = useMemo(
    () => [...new Set(rows.map((r) => r.CrimeHead_Name).filter(Boolean))].sort(),
    [rows]
  );
  const unitNames = useMemo(
    () => [...new Set(rows.map((r) => r.UnitName).filter(Boolean))].sort(),
    [rows]
  );

  const baseRows = regionRows || rows;
  rowsRef.current = rows;
  const hasUserSelection =
    selectedDistricts.length > 0 ||
    selectedUnits.length > 0 ||
    selectedTypes.length > 0 ||
    search.trim().length > 0 ||
    Boolean(filterDateFrom) ||
    Boolean(filterDateTo) ||
    timeOfDayFilter !== "all" ||
    Boolean(regionRows);

  useEffect(() => {
    if (hasUserSelection && mapAllMode) {
      setMapAllMode(false);
    }
  }, [hasUserSelection, mapAllMode]);

  const filteredRows = useMemo(() => {
    const q = search.trim().toLowerCase();
    let fromMs = filterDateFrom ? startOfLocalDayYmd(filterDateFrom) : null;
    let toMs = filterDateTo ? endOfLocalDayYmd(filterDateTo) : null;
    if (fromMs != null && toMs != null && fromMs > toMs) {
      fromMs = filterDateTo ? startOfLocalDayYmd(filterDateTo) : fromMs;
      toMs = filterDateFrom ? endOfLocalDayYmd(filterDateFrom) : toMs;
    }
    const needsTimeOfDay = timeOfDayFilter !== "all";
    const needsParsedDate = Boolean(filterDateFrom || filterDateTo || needsTimeOfDay);

    return baseRows.filter((r) => {
      const lat = Number.parseFloat(r.Latitude);
      const lng = Number.parseFloat(r.Longitude);
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) return false;
      if (selectedDistricts.length && !selectedDistricts.includes(r.District_Name)) return false;
      if (selectedUnits.length && !selectedUnits.includes(r.UnitName)) return false;
      if (selectedTypes.length && !selectedTypes.includes(r.CrimeHead_Name)) return false;

      const eventDt = getCrimeDateTime(r);
      if (needsParsedDate && !eventDt) return false;
      if (fromMs != null && eventDt && eventDt.getTime() < fromMs) return false;
      if (toMs != null && eventDt && eventDt.getTime() > toMs) return false;
      if (needsTimeOfDay) {
        const isDay = crimeIsDayTime(eventDt);
        if (isDay == null) return false;
        if (timeOfDayFilter === "day" && !isDay) return false;
        if (timeOfDayFilter === "night" && isDay) return false;
      }

      if (!q) return true;
      return (
        String(r.FIRNo || "").toLowerCase().includes(q) ||
        String(r.CrimeHead_Name || "").toLowerCase().includes(q) ||
        String(r["Place of Offence"] || "").toLowerCase().includes(q) ||
        String(r.District_Name || "").toLowerCase().includes(q) ||
        String(r.UnitName || "").toLowerCase().includes(q) ||
        String(r.City_Name || r.City || "").toLowerCase().includes(q) ||
        String(r.Area_Name || r.Area || "").toLowerCase().includes(q)
      );
    });
  }, [
    baseRows,
    selectedDistricts,
    selectedUnits,
    selectedTypes,
    search,
    filterDateFrom,
    filterDateTo,
    timeOfDayFilter,
  ]);

  const timeSeries = useMemo(() => {
    const week = new Array(7).fill(0);
    const hours = new Array(24).fill(0);
    const months = new Array(12).fill(0);
    filteredRows.forEach((r) => {
      const d = getCrimeDateTime(r);
      if (!d) return;
      week[d.getDay()] += 1;
      hours[d.getHours()] += 1;
      months[d.getMonth()] += 1;
    });
    return { week, hours, months };
  }, [filteredRows]);

  const predictedHotspots = useMemo(() => {
    if (!aiCircleArea || !aiReport || aiReport?.message) return [];
    const out = [];
    const maybePush = (latRaw, lngRaw, intensityRaw, label, topCrime, peakTime) => {
      const lat = Number.parseFloat(latRaw);
      const lng = Number.parseFloat(lngRaw);
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;
      const intensity = Math.min(1, Math.max(0.2, Number(intensityRaw) || 0.8));
      out.push({
        lat,
        lng,
        intensity,
        label: String(label || "Predicted hotspot"),
        topCrime: String(topCrime || "N/A"),
        peakTime: String(peakTime || "N/A"),
      });
    };

    const micro = aiReport?.radius_stats?.micro_hotspot;
    if (micro) {
      maybePush(
        micro.latitude,
        micro.longitude,
        1.0,
        aiReport?.radius_stats?.most_dangerous_place || "Primary predicted hotspot",
        micro.top_crime,
        micro.peak_time
      );
    }

    const clusters = Array.isArray(aiReport?.radius_stats?.hotspots)
      ? aiReport.radius_stats.hotspots
      : Array.isArray(aiReport?.predicted_hotspots)
        ? aiReport.predicted_hotspots
        : [];
    clusters.forEach((h, idx) => {
      maybePush(
        h?.latitude ?? h?.lat,
        h?.longitude ?? h?.lng ?? h?.lon,
        h?.severity_score != null ? Number(h.severity_score) / 10 : 0.6,
        h?.place || h?.name || `Predicted zone ${idx + 1}`,
        h?.top_crime || h?.crime_type,
        h?.peak_time
      );
    });
    return out;
  }, [aiCircleArea, aiReport]);

  const predictionHeatPoints = useMemo(
    () => predictedHotspots.map((p) => [p.lat, p.lng, p.intensity]),
    [predictedHotspots]
  );

  const rowsForMap = useMemo(() => {
    const sourceRows = mapAllMode ? rows : hasUserSelection ? filteredRows : [];
    const validRows = sourceRows.filter((r) => Boolean(parseLatLng(r)));
    if (!mapBounds) return validRows;
    if (typeof mapBounds.contains !== "function") return validRows;
    const viewportRows = validRows.filter((r) => {
      const pos = parseLatLng(r);
      if (!pos) return false;
      try {
        return mapBounds.contains([pos.lat, pos.lng]);
      } catch {
        return false;
      }
    });
    return viewportRows;
  }, [rows, filteredRows, mapBounds, hasUserSelection, mapAllMode]);

  useEffect(() => {
    if (!authUser) return;
    const map = L.map("map", {
      center: [20.5937, 78.9629],
      zoom: 5,
      attributionControl: false,
    });
    mapRef.current = map;

    const tileCross = { crossOrigin: true };
    const streetLayer = L.tileLayer("https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png", {
      maxZoom: 20,
      ...tileCross,
    });
    const satelliteLayer = L.tileLayer(
      "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
      { maxZoom: 19, ...tileCross }
    );
    const labelsLayer = L.tileLayer("https://{s}.basemaps.cartocdn.com/rastertiles/voyager_only_labels/{z}/{x}/{y}{r}.png", {
      maxZoom: 20,
      ...tileCross,
    });
    const terrainLayer = L.tileLayer("https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png", { maxZoom: 17, ...tileCross });
    const norseBase = L.tileLayer("https://{s}.basemaps.cartocdn.com/dark_nolabels/{z}/{x}/{y}{r}.png", {
      maxZoom: 20,
      ...tileCross,
    });
    const norseLabels = L.tileLayer("https://{s}.basemaps.cartocdn.com/dark_only_labels/{z}/{x}/{y}{r}.png", {
      maxZoom: 20,
      ...tileCross,
    });
    const hybridLayer = L.layerGroup([satelliteLayer, labelsLayer]);
    const norseLayer = L.layerGroup([norseBase, norseLabels]);

    baseLayersRef.current = {
      street: streetLayer,
      satellite: satelliteLayer,
      terrain: terrainLayer,
      hybrid: hybridLayer,
      norse: norseLayer,
    };
    currentBaseLayerRef.current = streetLayer;
    streetLayer.addTo(map);
    canvasRendererRef.current = L.canvas({ padding: 0.5 });

    pointLayerRef.current = L.layerGroup().addTo(map);
    sosLayerRef.current = L.layerGroup().addTo(map);
    drawLayerRef.current = new L.FeatureGroup();
    map.addLayer(drawLayerRef.current);

    const drawControl = new L.Control.Draw({
      edit: { featureGroup: drawLayerRef.current, edit: false },
      // showArea:false avoids a known leaflet-draw runtime bug in some builds
      draw: {
        polygon: { showArea: false },
        rectangle: { showArea: false },
        circle: true,
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

      if (e.layerType === "circle") {
        const center = e.layer.getLatLng();
        const radiusMeters = e.layer.getRadius();
        const radiusKm = radiusMeters / 1000;
        setAiCircleArea({ lat: center.lat, lng: center.lng, radiusKm });
        setRightTab("ai");

        const inCircle = rowsRef.current.filter((r) => {
          const lat = Number.parseFloat(r.Latitude);
          const lng = Number.parseFloat(r.Longitude);
          if (!Number.isFinite(lat) || !Number.isFinite(lng)) return false;
          return L.latLng(center).distanceTo(L.latLng(lat, lng)) <= radiusMeters;
        });
        setRegionRows(inCircle);

        void radiusMlRunnerRef.current({ lat: center.lat, lng: center.lng, radiusKm });
        return;
      }

      setAiCircleArea(null);
      setAiReport(null);
      setAiError(null);
      setIsAiLoading(false);

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
    });

    map.on("mousemove", (e) => {
      setCoordsText(`${e.latlng.lat.toFixed(5)}, ${e.latlng.lng.toFixed(5)}`);
    });
    map.on("moveend", () => setMapBounds(map.getBounds()));
    map.on("click", () => {});
    setMapBounds(map.getBounds());

    return () => map.remove();
  }, [authUser]);

  useEffect(() => {
    const db = getRealtimeDb();
    if (!db) return;
    return onValue(ref(db, PATROL_ASSIGNMENTS_RTDB_PATH), (snap) => {
      const v = snap.val();
      const list = v ? Object.entries(v).map(([id, d]) => ({ id, ...d })) : [];
      setPatrolAssignments(list);
    });
  }, []);

  useEffect(() => {
    const db = getRealtimeDb();
    if (!db) return;
    return onValue(ref(db, PATROL_TO_ADMIN_RTDB_PATH), (snap) => {
      const v = snap.val();
      if (!v || typeof v !== "object") {
        setPatrolToAdminFeed([]);
        return;
      }
      const rows = Object.entries(v)
        .map(([id, d]) => ({
          id,
          ...(typeof d === "object" && d !== null ? d : {}),
        }))
        .sort((a, b) => String(b.created_at || "").localeCompare(String(a.created_at || "")))
        .slice(0, 40);
      setPatrolToAdminFeed(rows);
    });
  }, []);

  /** Road routes only after a patrol accepts (assignment status routing / assigned). */
  useEffect(() => {
    if (rightTab === "timing") return;
    let cancelled = false;
    (async () => {
      const out = {};
      const active = patrolAssignments.filter((a) =>
        ["routing", "assigned"].includes(String(a.status || "").toLowerCase())
      );
      for (const a of active) {
        const sid = a.sos_id != null ? String(a.sos_id) : "";
        if (!sid) continue;
        const unit = enrolledPatrols.find((p) => String(p.pid) === String(a.patrol_pid));
        const pos = unit ? getPatrolLatLng(unit) : null;
        const sosLat = Number.parseFloat(a.sos_location_lat);
        const sosLng = Number.parseFloat(a.sos_location_lng);
        if (!pos || !Number.isFinite(sosLat) || !Number.isFinite(sosLng)) continue;
        const osrm = await fetchOsrmDrivingRoute(pos.lat, pos.lng, sosLat, sosLng);
        if (cancelled) return;
        if (osrm?.latlngs) {
          out[sid] = { ...osrm, patrol: unit };
        }
      }
      if (!cancelled) setOsrmRoutes(out);
    })();
    return () => {
      cancelled = true;
    };
  }, [rightTab, patrolAssignments, enrolledPatrols]);

  useEffect(() => {
    const map = mapRef.current;
    const nextLayer = baseLayersRef.current[mapStyle];
    if (!map || !nextLayer) return;
    if (currentBaseLayerRef.current && map.hasLayer(currentBaseLayerRef.current)) {
      map.removeLayer(currentBaseLayerRef.current);
    }
    nextLayer.addTo(map);
    currentBaseLayerRef.current = nextLayer;
    const container = map.getContainer();
    if (container) {
      if (mapStyle === "norse") container.classList.add("norse-map");
      else container.classList.remove("norse-map");
    }
  }, [mapStyle]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    if (cyberOverlayRef.current) {
      map.removeLayer(cyberOverlayRef.current);
      cyberOverlayRef.current = null;
    }
    if (cyberPulseRef.current) {
      map.removeLayer(cyberPulseRef.current);
      cyberPulseRef.current = null;
    }
    if (cyberAnimTimerRef.current) {
      clearInterval(cyberAnimTimerRef.current);
      cyberAnimTimerRef.current = null;
    }
    if (mapStyle !== "norse") return;

    const sources = [
      { lat: 37.7749, lng: -122.4194 },
      { lat: 51.5072, lng: -0.1276 },
      { lat: 13.0827, lng: 80.2707 },
      { lat: 28.6139, lng: 77.209 },
    ];
    const targets = predictedHotspots.length
      ? predictedHotspots.slice(0, 12).map((p) => ({ lat: p.lat, lng: p.lng }))
      : rowsForMap
          .filter((r, i) => i % Math.max(1, Math.floor(rowsForMap.length / 18 || 1)) === 0)
          .slice(0, 18)
          .map((r) => parseLatLng(r))
          .filter(Boolean);

    const lineLayer = L.layerGroup();
    const pulseLayer = L.layerGroup();
    const animatedLines = [];

    targets.forEach((t, idx) => {
      const src = sources[idx % sources.length];
      const line = L.polyline(
        [
          [src.lat, src.lng],
          [t.lat, t.lng],
        ],
        {
          color: idx % 3 === 0 ? "#fef08a" : idx % 2 === 0 ? "#67e8f9" : "#fca5a5",
          weight: 2.1,
          opacity: 0.72,
          dashArray: "10 14",
          dashOffset: "0",
        }
      );
      line.addTo(lineLayer);
      animatedLines.push(line);

      L.circleMarker([t.lat, t.lng], {
        radius: 3,
        color: "#22d3ee",
        weight: 0.8,
        fillColor: "#67e8f9",
        fillOpacity: 0.95,
      }).addTo(pulseLayer);
      L.circle([t.lat, t.lng], {
        radius: 180000,
        color: "#22d3ee",
        weight: 1,
        opacity: 0.24,
        fillOpacity: 0,
      }).addTo(pulseLayer);
      L.circle([t.lat, t.lng], {
        radius: 320000,
        color: "#f97316",
        weight: 1,
        opacity: 0.16,
        fillOpacity: 0,
      }).addTo(pulseLayer);
    });

    lineLayer.addTo(map);
    pulseLayer.addTo(map);
    cyberOverlayRef.current = lineLayer;
    cyberPulseRef.current = pulseLayer;

    let offset = 0;
    cyberAnimTimerRef.current = setInterval(() => {
      offset = (offset + 4) % 400;
      animatedLines.forEach((line) => line.setStyle({ dashOffset: `${offset}` }));
    }, 120);

    return () => {
      if (cyberAnimTimerRef.current) {
        clearInterval(cyberAnimTimerRef.current);
        cyberAnimTimerRef.current = null;
      }
      if (cyberOverlayRef.current) {
        map.removeLayer(cyberOverlayRef.current);
        cyberOverlayRef.current = null;
      }
      if (cyberPulseRef.current) {
        map.removeLayer(cyberPulseRef.current);
        cyberPulseRef.current = null;
      }
    };
  }, [mapStyle, predictedHotspots, rowsForMap]);

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
        if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
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

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    if (heatLayerRef.current) {
      map.removeLayer(heatLayerRef.current);
      heatLayerRef.current = null;
    }
    if (predictionHoverPopupRef.current) {
      map.removeLayer(predictionHoverPopupRef.current);
      predictionHoverPopupRef.current = null;
    }

    // Show predicted mapping only after radius selection and AI response.
    if (rightTab !== "ai" || !aiCircleArea || !aiReport || predictionHeatPoints.length === 0) return;

    const layer = L.heatLayer(predictionHeatPoints, {
      radius: 38,
      blur: 34,
      maxZoom: 16,
      minOpacity: 0.52,
      gradient: {
        0.08: "#fde047",
        0.28: "#f59e0b",
        0.48: "#f97316",
        0.66: "#ef4444",
        0.84: "#dc2626",
        1.0: "#991b1b",
      },
    });
    heatLayerRef.current = layer;
    layer.addTo(map);

    // No visible pins/dots: show predicted details as a popup when cursor is near a predicted hotspot.
    const popup = L.popup({
      closeButton: false,
      autoPan: false,
      offset: [0, -10],
      className: "prediction-hover-popup",
    });
    predictionHoverPopupRef.current = popup;

    function getNearestSpot(mouseLatLng) {
      let best = null;
      let bestDist = Number.POSITIVE_INFINITY;
      for (const spot of predictedHotspots) {
        const dist = haversineMeters(
          { lat: mouseLatLng.lat, lng: mouseLatLng.lng },
          { lat: spot.lat, lng: spot.lng }
        );
        if (dist < bestDist) {
          bestDist = dist;
          best = spot;
        }
      }
      const thresholdMeters = 25000 / Math.pow(2, Math.max(0, map.getZoom() - 8));
      if (!best || bestDist > thresholdMeters) return null;
      return best;
    }

    function onMouseMove(e) {
      const best = getNearestSpot(e.latlng);
      if (!best) {
        popup.remove();
        return;
      }
      popup
        .setLatLng([best.lat, best.lng])
        .setContent(
          `<div style="min-width:210px">
            <div style="font-weight:800;color:#ef4444;margin-bottom:4px;line-height:1.2;">${best.label}</div>
            <div style="font-size:12px;line-height:1.4;"><strong>Top crime:</strong> ${best.topCrime}</div>
            <div style="font-size:12px;line-height:1.4;"><strong>Peak time:</strong> ${best.peakTime}</div>
            <div style="font-size:12px;line-height:1.4;"><strong>Predicted intensity:</strong> ${(best.intensity * 100).toFixed(0)}%</div>
            <div style="font-size:11px;color:#94a3b8;margin-top:4px;line-height:1.3;">${best.lat.toFixed(5)}, ${best.lng.toFixed(5)}</div>
          </div>`
        )
        .openOn(map);
    }

    map.on("mousemove", onMouseMove);

    return () => {
      map.off("mousemove", onMouseMove);
      popup.remove();
      if (heatLayerRef.current) {
        map.removeLayer(heatLayerRef.current);
        heatLayerRef.current = null;
      }
    };
  }, [rightTab, aiCircleArea, aiReport, predictionHeatPoints, predictedHotspots]);

  useEffect(() => {
    const map = mapRef.current;
    const sosLayer = sosLayerRef.current;
    if (!map || !sosLayer) return;
    sosMarkerByIdRef.current.clear();
    sosLayer.clearLayers();
    if (rightTab === "timing") return;

    const markers = [];
    const selectedUserKey = getSosUserKey(selectedSosReport);
    const reportsToPlot =
      selectedUserKey
        ? sosReports.filter((r) => getSosUserKey(r) === selectedUserKey)
        : latestSosByUser(sosReports);

    // SOS alerts only (user requests) — distinct SOS marker
    reportsToPlot.forEach((report) => {
      const pos = extractSosLatLng(report);
      if (!pos) return;
      const userName = getSosUserName(report);
      const marker = L.marker([pos.lat, pos.lng], {
        icon: L.divIcon({
          className: "",
          html: `
            <div style="position:relative;width:24px;height:24px;display:flex;align-items:center;justify-content:center;">
              <div style="position:absolute;inset:-7px;border-radius:999px;background:rgba(239,68,68,0.22);border:1px solid rgba(248,113,113,0.55);"></div>
              <div style="position:relative;z-index:2;width:24px;height:24px;border-radius:999px;background:linear-gradient(135deg,#dc2626,#ef4444);color:#fff;border:1px solid rgba(255,255,255,0.65);font-size:11px;font-weight:700;display:flex;align-items:center;justify-content:center;box-shadow:0 0 0 1px rgba(0,0,0,0.2),0 8px 18px rgba(239,68,68,0.45);">SOS</div>
            </div>
          `,
          iconSize: [24, 24],
          iconAnchor: [12, 12],
          popupAnchor: [0, -14],
        }),
      });
      const asn = latestPatrolAssignmentForSos(patrolAssignments, report.id);
      const st = String(asn?.status || "").toLowerCase();
      const patrolLine =
        asn && report.status === "resolved"
          ? `<div style="margin-top:8px;padding:8px;border-radius:8px;background:rgba(22,101,52,0.12);font-size:12px;color:#14532d"><strong>Patrol reached</strong>${
              report.reached_at ? `<br/>${String(report.reached_at)}` : ""
            }${report.reached_by_patrol_uid ? `<br/>UID ${String(report.reached_by_patrol_uid).slice(0, 10)}…` : ""}</div>`
          : asn && st === "pending_accept"
            ? `<div style="margin-top:8px;padding:8px;border-radius:8px;background:rgba(59,130,246,0.15);font-size:12px;color:#1e3a5f"><strong>Awaiting patrol accept</strong><br/>PID ${String(
                asn.patrol_pid || "—"
              )}${asn.distance_m != null ? ` · ${(Number(asn.distance_m) / 1000).toFixed(1)} km` : ""}</div>`
            : asn
              ? `<div style="margin-top:8px;padding:8px;border-radius:8px;background:rgba(234,179,8,0.15);font-size:12px;color:#713f12"><strong>Patrol en route</strong> (${String(
                  asn.status || ""
                )})<br/>PID ${String(asn.patrol_pid || "—")}${
                  asn.distance_m != null ? ` · ${(Number(asn.distance_m) / 1000).toFixed(1)} km` : ""
                }</div>`
              : "";
      marker.bindPopup(
        `<div style="min-width:220px">
          <div style="font-weight:800;margin-bottom:6px;color:#dc2626;font-size:16px;line-height:1.25;">🚺 SOS ${report.id || ""}</div>
          <div style="font-size:14px;color:#0f172a;margin-bottom:6px;line-height:1.35;"><strong>Name:</strong> ${userName}</div>
          <div style="color:#1f2937;font-size:14px;line-height:1.35;">${String(
          report.message || report.status || "SOS alert"
        )}</div>${patrolLine}
        </div>`
      );
      marker.on("click", () => {
        setRightTab("sos");
        setSelectedSosReport(report);
      });
      marker.addTo(sosLayer);
      sosMarkerByIdRef.current.set(String(report.id), marker);
      markers.push([pos.lat, pos.lng]);
    });
    if (sosLayer.bringToFront) sosLayer.bringToFront();

    /** Accepted dispatches only: OSRM route patrol → SOS (same as patrol site after Accept). */
    patrolAssignments
      .filter((a) => ["routing", "assigned"].includes(String(a.status || "").toLowerCase()))
      .forEach((a) => {
        const sid = a.sos_id != null ? String(a.sos_id) : "";
        if (!sid) return;
        const sosPos = extractSosLatLng({ id: sid, location_lat: a.sos_location_lat, location_lng: a.sos_location_lng });
        if (!sosPos) return;
        const osrm = osrmRoutes[sid];
        const unit = enrolledPatrols.find((p) => String(p.pid) === String(a.patrol_pid));
        const label = String(unit?.name || unit?.patrol_uid || a.patrol_pid || "");
        if (osrm?.latlngs?.length) {
          const path = L.polyline(osrm.latlngs, {
            color: "#f59e0b",
            weight: 4,
            opacity: 0.9,
          });
          const etaMin = osrm.durationSec != null ? Math.round(osrm.durationSec / 60) : "—";
          const km = osrm.distanceM != null ? (osrm.distanceM / 1000).toFixed(2) : "—";
          path.bindPopup(
            `<div style="min-width:200px">
              <div style="font-weight:700;color:#b45309;margin-bottom:4px">Live route (accepted)</div>
              <div style="font-size:12px;color:#1f2937">Patrol: ${label}</div>
              <div style="font-size:12px;color:#1f2937">ETA ~ ${etaMin} min · ${km} km</div>
              <div style="font-size:11px;color:#64748b">SOS ${sid}</div>
            </div>`
          );
          path.addTo(sosLayer);
        } else {
          const cur = unit ? getPatrolLatLng(unit) : null;
          if (!cur) return;
          const path = L.polyline(
            [
              [cur.lat, cur.lng],
              [sosPos.lat, sosPos.lng],
            ],
            { color: "#f59e0b", weight: 3, opacity: 0.85, dashArray: "8 6" }
          );
          path.bindPopup(
            `<div style="min-width:180px">
              <div style="font-weight:700;color:#b45309;margin-bottom:4px">Route loading…</div>
              <div style="font-size:12px;color:#1f2937">${label}</div>
              <div style="font-size:12px;color:#1f2937">SOS ${sid}</div>
            </div>`
          );
          path.addTo(sosLayer);
        }
      });

    // One pin per patrol — uses live/station position so it moves as RTDB updates (e.g. patrol app tracking).
    enrolledPatrols.forEach((unit) => {
      const pos = getPatrolLatLng(unit);
      if (!pos) return;
      const hasLiveFields =
        Number.isFinite(Number.parseFloat(unit.live_lat)) && Number.isFinite(Number.parseFloat(unit.live_lng));
      const seenMs = unit.last_seen ? new Date(unit.last_seen).getTime() : NaN;
      const recentlyUpdated = Number.isFinite(seenMs) && Date.now() - seenMs < 90_000;
      const trackLabel = hasLiveFields ? "Live GPS" : recentlyUpdated ? "Position updating" : "Last reported";
      const m = L.marker([pos.lat, pos.lng], { icon: patrolPinDivIcon({ variant: "unit" }) });
      m.bindPopup(
        `<div style="min-width:170px">
          <div style="font-weight:700;margin-bottom:4px">🚓 Patrol</div>
          <div style="font-size:12px;color:#1f2937">${String(unit.name || unit.patrol_uid || unit.pid)}</div>
          <div style="font-size:12px;color:#475569">pid: ${String(unit.pid || "")}</div>
          <div style="font-size:11px;color:#64748b;margin-top:4px">${trackLabel}</div>
        </div>`
      );
      m.addTo(sosLayer);
    });

    if (markers.length && map.getZoom() < 11) {
      map.fitBounds(L.latLngBounds(markers), { padding: [20, 20], maxZoom: 12 });
    }
  }, [
    rightTab,
    sosReports,
    selectedSosReport,
    enrolledPatrols,
    osrmRoutes,
    patrolAssignments,
  ]);

  useEffect(() => {
    if (rightTab !== "sos" || !selectedSosReport) return;
    const map = mapRef.current;
    if (!map) return;
    const marker = sosMarkerByIdRef.current.get(String(selectedSosReport.id));
    if (marker) {
      const ll = marker.getLatLng();
      map.setView(ll, Math.max(map.getZoom(), 15), { animate: true });
      marker.openPopup();
      return;
    }
    const pos = extractSosLatLng(selectedSosReport);
    if (pos) {
      map.setView([pos.lat, pos.lng], Math.max(map.getZoom(), 15), { animate: true });
    }
  }, [selectedSosReport, rightTab]);

  useEffect(() => {
    const db = getRealtimeDb();
    if (!db) return;

    const recentThreshold = Date.now() - PATROL_SOS_AUTO_ASSIGN_MAX_AGE_MS;
    const activeAlerts = sosReports
      .filter((a) => parseCreatedAtMillis(a) >= recentThreshold)
      .filter((a) => a.status !== "resolved")
      .filter((a) => !sosHasOpenDispatch(patrolAssignments, a.id))
      .sort((a, b) => parseCreatedAtMillis(a) - parseCreatedAtMillis(b));

    if (activeAlerts.length === 0) return;

    const occupiedUids = new Set(
      patrolAssignments
        .filter((x) =>
          ["pending_accept", "routing", "assigned"].includes(String(x.status || "").toLowerCase())
        )
        .map((x) => String(x.patrol_uid || "").trim())
        .filter(Boolean)
    );

    const withPos = enrolledPatrols
      .filter((p) => String(p.status || "available").toLowerCase() !== "offline")
      .map((p) => {
        const pos = getPatrolLatLng(p);
        return pos ? { ...p, pos } : null;
      })
      .filter(Boolean);

    const availablePatrols = withPos.filter(
      (p) =>
        String(p.status || "available").toLowerCase() !== "busy" &&
        !p.active_assignment_id &&
        !occupiedUids.has(String(p.patrol_uid || "").trim())
    );

    if (availablePatrols.length === 0) return;

    async function offerNearest() {
      const pool = [...availablePatrols];

      for (const alert of activeAlerts) {
        const sosPos = extractSosLatLng(alert);
        if (!sosPos || pool.length === 0) break;
        let bestIdx = -1;
        let bestDist = Number.POSITIVE_INFINITY;
        for (let i = 0; i < pool.length; i++) {
          const dist = haversineMeters(sosPos, pool[i].pos);
          if (dist < bestDist) {
            bestDist = dist;
            bestIdx = i;
          }
        }
        if (bestIdx < 0) continue;
        if (bestDist > PATROL_SOS_NEARBY_MAX_METERS) continue;
        const patrol = pool.splice(bestIdx, 1)[0];
        const assignRef = push(ref(db, PATROL_ASSIGNMENTS_RTDB_PATH));
        const assignmentId = assignRef.key;
        if (!assignmentId) continue;
        const pid = String(patrol.pid || patrol.patrol_uid);
        const puid = String(patrol.patrol_uid || "");
        await set(assignRef, {
          assignment_id: assignmentId,
          patrol_pid: pid,
          patrol_uid: puid,
          sos_id: alert.id,
          user_id: alert.user_id || null,
          status: "pending_accept",
          distance_m: Math.round(bestDist),
          assigned_at: new Date().toISOString(),
          patrol_location_lat: patrol.pos.lat,
          patrol_location_lng: patrol.pos.lng,
          sos_location_lat: sosPos.lat,
          sos_location_lng: sosPos.lng,
          queue_note: "Nearest officer must Accept on patrol site before route shows.",
        });
        await update(ref(db, `sos_alerts/${alert.id}`), {
          dispatch_status: "awaiting_accept",
          pending_assignment_id: assignmentId,
          pending_patrol_uid: puid,
          pending_patrol_pid: pid,
        });
        if (puid) {
          const dRef = push(ref(db, `patrol_dispatch/${puid}`));
          await set(dRef, {
            type: "sos_offer",
            title: "SOS nearby — accept or decline",
            message: `SOS ${alert.id} (~${(bestDist / 1000).toFixed(1)} km). Open patrol site and tap Accept to show the route.`,
            sos_id: alert.id,
            assignment_id: assignmentId,
            distance_m: Math.round(bestDist),
            created_at: new Date().toISOString(),
          });
        }
      }
    }

    void offerNearest();
  }, [sosReports, enrolledPatrols, patrolAssignments]);

  const searchedRows = useMemo(() => filteredRows.slice(0, 300), [filteredRows]);

  function uploadCsv(file) {
    Papa.parse(file, {
      header: true,
      dynamicTyping: true,
      skipEmptyLines: true,
      complete: (res) => {
        setRows(res.data || []);
        setRegionRows(null);
        setSelectedDistricts([]);
        setSelectedUnits([]);
        setSelectedTypes([]);
        setSearch("");
        setFilterDateFrom("");
        setFilterDateTo("");
        setTimeOfDayFilter("all");
        setSelectedFir(null);
        setMapAllMode(false);
        setAiReport(null);
        setAiError(null);
        setAiCircleArea(null);
        setDistrictForecast(null);
        setDistrictForecastError(null);
        setIsAiLoading(false);
      },
    });

    void uploadFirCsv(CRIME_API_BASE, file)
      .then((data) => {
        if (data?.status === "success" || data?.message) {
          window.alert(data?.message || "CSV received by crime ML backend.");
        }
      })
      .catch((err) => {
        console.error("Crime ML upload:", err);
        window.alert(
          `Could not upload CSV to crime backend (${CRIME_API_BASE}). Map still loaded locally.\n${err?.message || err}`
        );
      });
  }

  function toggleValue(value, list, setList) {
    if (list.includes(value)) setList(list.filter((x) => x !== value));
    else setList([...list, value]);
  }

  function clearRegion() {
    setRegionRows(null);
    setAiReport(null);
    setAiError(null);
    setAiCircleArea(null);
    setDistrictForecast(null);
    setDistrictForecastError(null);
    setIsAiLoading(false);
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

  function clearAllCrimeFilters() {
    setSelectedDistricts([]);
    setSelectedUnits([]);
    setSelectedTypes([]);
    setSearch("");
    setFilterDateFrom("");
    setFilterDateTo("");
    setTimeOfDayFilter("all");
    setRegionRows(null);
    setAiReport(null);
    setAiError(null);
    setAiCircleArea(null);
    setDistrictForecast(null);
    setDistrictForecastError(null);
    setIsAiLoading(false);
    if (drawLayerRef.current) drawLayerRef.current.clearLayers();
    setMapAllMode(false);
  }

  function sendAiCircleToBackend() {
    if (!aiCircleArea) return;
    setRightTab("ai");
    void radiusMlRunnerRef.current(aiCircleArea);
  }

  async function fetchDistrictForecastPanel() {
    if (!aiDistrictPick) {
      setDistrictForecastError("Choose a district.");
      return;
    }
    setDistrictForecastError(null);
    setDistrictForecast(null);
    setDistrictForecastLoading(true);
    try {
      const data = await getDistrictPredictions(CRIME_API_BASE, {
        area_id: aiDistrictPick,
        horizon: Number.parseInt(String(aiHorizonDays), 10) || 7,
        level: "district_name",
      });
      setDistrictForecast(data);
    } catch (err) {
      console.error("District predictions:", err);
      setDistrictForecastError(err?.message || "District forecast failed.");
    } finally {
      setDistrictForecastLoading(false);
    }
  }

  function loadSosLocationIntoAiArea() {
    const pos = extractSosLatLng(selectedSosReport);
    if (!pos) return;
    const next = { lat: pos.lat, lng: pos.lng, radiusKm: 2 };
    setRightTab("ai");
    setAiCircleArea(next);
    void radiusMlRunnerRef.current(next);
  }

  function extractSosLatLng(report) {
    if (!report || typeof report !== "object") return null;
    const candidates = [
      [report.location_lat, report.location_lng],
      [report.latitude, report.longitude],
      [report.lat, report.lng],
      [report.lat, report.lon],
      [report.location?.latitude, report.location?.longitude],
      [report.location?.lat, report.location?.lng],
      [report.coords?.lat, report.coords?.lng],
    ];
    for (const [la, ln] of candidates) {
      const lat = Number.parseFloat(la);
      const lng = Number.parseFloat(ln);
      if (Number.isFinite(lat) && Number.isFinite(lng)) return { lat, lng };
    }
    return null;
  }

  function getSosUserName(report) {
    if (!report || typeof report !== "object") return "Unknown";
    return String(
      report.name ||
      report.user_name ||
      report.username ||
      report.full_name ||
      report.user_id ||
      "Unknown"
    );
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

  /** Live `patrol_units` with uid — for messaging. */
  const patrolMessageRecipients = useMemo(() => {
    const seen = new Set();
    const out = [];
    for (const p of enrolledPatrols) {
      const uid = String(p.patrol_uid || "").trim();
      if (!uid || seen.has(uid)) continue;
      seen.add(uid);
      const pid = String(p.pid || "").trim();
      const name = String(p.name || p.display_name || (pid ? `Patrol ${pid}` : "Patrol officer"));
      out.push({
        uid,
        pid,
        name,
        label: pid ? `${name} — PID ${pid}` : name,
      });
    }
    out.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));
    return out;
  }, [enrolledPatrols]);

  const filteredPatrolMessageRecipients = useMemo(() => {
    const q = patrolMessageSearch.trim().toLowerCase();
    if (!q) return patrolMessageRecipients;
    return patrolMessageRecipients.filter(
      (r) =>
        r.name.toLowerCase().includes(q) ||
        r.uid.toLowerCase().includes(q) ||
        (r.pid && r.pid.toLowerCase().includes(q))
    );
  }, [patrolMessageRecipients, patrolMessageSearch]);

  function selectPatrolMessageRecipient(r) {
    setPatrolMessageTarget(r.uid);
    setPatrolMessageSearch(r.label);
    setPatrolMessageListOpen(false);
  }

  function onPatrolMessageSearchChange(e) {
    const v = e.target.value;
    setPatrolMessageSearch(v);
    setPatrolMessageListOpen(true);
    setPatrolMessageTarget("");
  }

  async function sendMessageToPatrol() {
    const uid = patrolMessageTarget.trim();
    const text = patrolMessageText.trim();
    if (!uid || !text) {
      setPatrolStatusText("Choose a patrol officer from the list and enter a message.");
      return;
    }
    const db = getRealtimeDb();
    if (!db) return;
    const msgRef = push(ref(db, `admin_notifications/${uid}`));
    await set(msgRef, {
      title: "Control Room Message",
      message: text,
      created_at: new Date().toISOString(),
      sender: "admin_dashboard",
    });
    setPatrolMessageText("");
    setPatrolStatusText("Message sent to patrol.");
  }

  function handleLoginSubmit(e) {
    e.preventDefault();
    const email = loginEmail.trim().toLowerCase();
    const password = String(loginPassword);
    const account = LOGIN_CREDENTIALS[email];
    if (!account || account.password !== password) {
      setLoginError("Invalid email or password.");
      return;
    }
    const nextUser = { email, welcome: account.welcome };
    setAuthUser(nextUser);
    setLoginError("");
    setLoginPassword("");
    try {
      window.localStorage.setItem("foresight_auth_user", JSON.stringify(nextUser));
    } catch {
      // no-op
    }
  }

  function logoutDashboard() {
    setAuthUser(null);
    setRightTab("timing");
    try {
      window.localStorage.removeItem("foresight_auth_user");
    } catch {
      // no-op
    }
  }

  if (!authUser) {
    return (
      <div className="auth-shell">
        <div className="auth-bg-glow auth-bg-glow--one" />
        <div className="auth-bg-glow auth-bg-glow--two" />
        <main className="auth-layout">
          <section className="auth-landing">
            <h1>Foresight Crime Prediction Portal</h1>
            <p className="auth-lead">
              Smart policing dashboard with predictive intelligence, live operations, and statewide safety response.
            </p>
            <div className="auth-features">
              <article className="auth-feature-card">
                <h3>Dataset Intelligence</h3>
                <p>Upload FIR datasets, run advanced filters, and visualize patterns across time, type, and location.</p>
              </article>
              <article className="auth-feature-card">
                <h3>AI Next Hotspot</h3>
                <p>Predict upcoming risk zones with radius-based analysis, forecast severity, and repeat probability.</p>
              </article>
              <article className="auth-feature-card">
                <h3>Real-Time Danger Score</h3>
                <p>Area-level risk context combining historical patterns, timing behavior, and hotspot concentration.</p>
              </article>
              <article className="auth-feature-card">
                <h3>SOS Response</h3>
                <p>Live SOS stream, nearest patrol assignment, and map-based response visibility for faster action.</p>
              </article>
              <article className="auth-feature-card">
                <h3>Patrol Routing + Admin</h3>
                <p>Routing support, patrol communication, and command-center control for operational coordination.</p>
              </article>
            </div>
          </section>

          <aside className="auth-panel">
            <div className="auth-login-card">
              <div className="auth-chip">Secure Access</div>
              <h2>Control Room Login</h2>
              <p>Sign in to open your state crime operations dashboard.</p>
              <form onSubmit={handleLoginSubmit} className="auth-form">
                <label htmlFor="login-email">Email</label>
                <input
                  id="login-email"
                  type="email"
                  value={loginEmail}
                  onChange={(e) => {
                    setLoginEmail(e.target.value);
                    if (loginError) setLoginError("");
                  }}
                  placeholder="state-control@example.com"
                  required
                />
                <label htmlFor="login-password">Password</label>
                <input
                  id="login-password"
                  type="password"
                  value={loginPassword}
                  onChange={(e) => {
                    setLoginPassword(e.target.value);
                    if (loginError) setLoginError("");
                  }}
                  placeholder="Enter password"
                  required
                />
                {loginError && <div className="auth-error">{loginError}</div>}
                <button type="submit" className="auth-submit-btn">
                  Open Dashboard
                </button>
              </form>
              <div className="auth-help">
                Allowed accounts: <code>tamilnadu@gmail.com</code> / <code>karnataka@gmail.com</code>
              </div>
            </div>
          </aside>
        </main>
      </div>
    );
  }

  return (
    <div className="app">
      <header className="topbar">
        <div className="logo">📍 Foresight</div>
        <div className="sub">{authUser.welcome}</div>
        <button type="button" className="topbar-logout" onClick={logoutDashboard}>
          Logout
        </button>
        <div className="pill">{filteredRows.length} filtered</div>
        <div className="pill">{renderedCount}/{renderTotal} rendered</div>
        <div className="pill">{mapAllMode ? "Map: ALL DATA" : hasUserSelection ? "Map: FILTERED" : "Map: WAITING"}</div>
      </header>

      <main className="layout">
        <aside className="left">
          <div className="section-title">Filters &amp; Search</div>
          <label className="label">Upload CSV</label>
          <input type="file" accept=".csv" onChange={(e) => e.target.files?.[0] && uploadCsv(e.target.files[0])} />

          <div className="stats">Total loaded: {rows.length}</div>
          <div className="stats">Region drawn: {regionRows ? "Yes" : "No"}</div>

          <label className="label">Search (FIR, crime, place, city, area)</label>
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Type to filter list…" />

          <label className="label">Date range</label>
          <div className="filter-dates">
            <div>
              <span className="filter-sublabel">From</span>
              <input type="date" value={filterDateFrom} onChange={(e) => setFilterDateFrom(e.target.value)} />
            </div>
            <div>
              <span className="filter-sublabel">To</span>
              <input type="date" value={filterDateTo} onChange={(e) => setFilterDateTo(e.target.value)} />
            </div>
          </div>
          <p className="filter-hint">Uses FIR / offence date from the file. If reversed, range is applied automatically.</p>

          <label className="label">Time of day</label>
          <div className="chips time-of-day-chips">
            <button
              type="button"
              className={timeOfDayFilter === "all" ? "chip active" : "chip"}
              onClick={() => setTimeOfDayFilter("all")}
            >
              All
            </button>
            <button
              type="button"
              className={timeOfDayFilter === "day" ? "chip active" : "chip"}
              onClick={() => setTimeOfDayFilter("day")}
              title="06:00–17:59 (local)"
            >
              Day
            </button>
            <button
              type="button"
              className={timeOfDayFilter === "night" ? "chip active" : "chip"}
              onClick={() => setTimeOfDayFilter("night")}
              title="18:00–05:59 (local)"
            >
              Night
            </button>
          </div>

          <label className="label">Crime type</label>
          <div className="chips chips-scroll">
            {crimeTypes.length === 0 ? (
              <span className="filter-empty">Load a CSV to see types</span>
            ) : (
              crimeTypes.map((t) => (
                <button
                  key={t}
                  type="button"
                  className={selectedTypes.includes(t) ? "chip active" : "chip"}
                  onClick={() => toggleValue(t, selectedTypes, setSelectedTypes)}
                >
                  {t}
                </button>
              ))
            )}
          </div>

          <label className="label">Location — city (district)</label>
          <div className="checkbox-list">
            {districts.length === 0 ? (
              <span className="filter-empty">No districts in data</span>
            ) : (
              districts.map((d) => (
                <label key={d}>
                  <input type="checkbox" checked={selectedDistricts.includes(d)} onChange={() => toggleValue(d, selectedDistricts, setSelectedDistricts)} />
                  <span>{d}</span>
                </label>
              ))
            )}
          </div>

          <label className="label">Location — area (police unit)</label>
          <div className="checkbox-list">
            {unitNames.length === 0 ? (
              <span className="filter-empty">No units in data</span>
            ) : (
              unitNames.map((u) => (
                <label key={u}>
                  <input type="checkbox" checked={selectedUnits.includes(u)} onChange={() => toggleValue(u, selectedUnits, setSelectedUnits)} />
                  <span>{u}</span>
                </label>
              ))
            )}
          </div>

          <button type="button" className="clear-btn" onClick={clearAllCrimeFilters}>
            Clear all filters &amp; region
          </button>
          <button type="button" className="clear-btn" onClick={mapAllNow}>Map All Data</button>
          <button type="button" className="clear-btn" onClick={clearRegion}>Clear Drawn Region</button>
          <button type="button" className="clear-btn" onClick={fitVisibleData}>Fit Filtered Data</button>

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

        <section className={mapStyle === "norse" ? "center norse-mode" : "center"}>
          <div className="map-toolbar">
            <button onClick={mapAllNow}>Map All Data</button>
            <button onClick={clearRegion}>Reset Region</button>
            <button onClick={fitVisibleData}>Fit Data</button>
            <button type="button" className="map-toolbar-ai" title="Crime ML predictions (circle or district)" onClick={() => setRightTab("ai")}>
              AI data
            </button>
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
              <option value="norse">Norse Cyber</option>
            </select>
          </div>
          <div id="map" />
          <div className="coords">{coordsText}</div>
          {rightTab === "timing" && !mapAllMode && !hasUserSelection && (
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
          <div className="right-tabs" role="tablist" aria-label="Right panel mode">
            <button
              type="button"
              role="tab"
              aria-selected={rightTab === "timing"}
              className={`right-tab ${rightTab === "timing" ? "active" : ""}`}
              onClick={() => setRightTab("timing")}
            >
              Timing Insights
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={rightTab === "sos"}
              className={`right-tab ${rightTab === "sos" ? "active" : ""}`}
              onClick={() => setRightTab("sos")}
            >
              SOS
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={rightTab === "ai"}
              className={`right-tab right-tab--ai ${rightTab === "ai" ? "active" : ""}`}
              onClick={() => setRightTab("ai")}
            >
              AI data
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={rightTab === "patrol"}
              className={`right-tab ${rightTab === "patrol" ? "active" : ""}`}
              onClick={() => setRightTab("patrol")}
            >
              Patrol
            </button>
          </div>

          {rightTab === "timing" && (
            <>
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
            </>
          )}

          {rightTab === "sos" && (
            <>
              <div className="section-title">SOS &amp; devices (RTDB)</div>
              {selectedSosReport && extractSosLatLng(selectedSosReport) && (
                <button type="button" className="clear-btn sos-to-ai-btn" onClick={loadSosLocationIntoAiArea}>
                  Use SOS location → AI panel (2 km)
                </button>
              )}
              <SosPanel
                selectedReport={selectedSosReport}
                onSelectReport={setSelectedSosReport}
                onReportsChange={setSosReports}
                patrolAssignments={patrolAssignments}
              />
            </>
          )}

          {rightTab === "ai" && (
            <div className="crime-ai-panel">
              <div className="section-title">AI predictions (crime ML)</div>
              <p className="crime-ai-lead">
                Draw a <strong>circle</strong> on the map to set the study area (center + radius). Adjust radius here and click{" "}
                <strong>Send to backend</strong> to refresh results. Optional district checkboxes on the left are sent to the
                API. Start the Node API (<code className="crime-ai-code">crime-prediction-platform/backend</code>) and ML
                service on port 8000.
              </p>
              <div className="crime-ai-area-card">
                <strong className="crime-ai-block-title">Selected area</strong>
                {aiCircleArea ? (
                  <>
                    <div className="crime-ai-area-row">
                      <span className="crime-ai-label">Center</span>
                      <span>
                        {aiCircleArea.lat.toFixed(5)}, {aiCircleArea.lng.toFixed(5)}
                      </span>
                    </div>
                    <label className="crime-ai-radius-label">
                      Radius (km)
                      <input
                        type="number"
                        min={0.05}
                        max={200}
                        step={0.1}
                        value={aiCircleArea.radiusKm}
                        onChange={(e) => {
                          const v = Number.parseFloat(e.target.value);
                          if (!Number.isFinite(v) || !aiCircleArea) return;
                          setAiCircleArea({
                            ...aiCircleArea,
                            radiusKm: Math.min(200, Math.max(0.05, v)),
                          });
                        }}
                      />
                    </label>
                    <div className="crime-ai-actions">
                      <button type="button" className="crime-ai-primary-btn" disabled={isAiLoading} onClick={sendAiCircleToBackend}>
                        {isAiLoading ? "Sending…" : "Send to backend"}
                      </button>
                    </div>
                  </>
                ) : (
                  <div className="crime-ai-status crime-ai-status--muted" style={{ marginBottom: 0 }}>
                    No circle yet — draw one on the map, or use <strong>SOS → AI</strong> / default 2 km.
                  </div>
                )}
              </div>
              <div className="crime-ai-district-block">
                <strong className="crime-ai-block-title">District time-series (backend)</strong>
                <div className="crime-ai-district-row">
                  <select
                    className="crime-ai-select"
                    value={aiDistrictPick}
                    onChange={(e) => setAiDistrictPick(e.target.value)}
                    aria-label="District for forecast"
                  >
                    <option value="">— Select district —</option>
                    {districts.map((d) => (
                      <option key={d} value={d}>
                        {d}
                      </option>
                    ))}
                  </select>
                  <label className="crime-ai-horizon">
                    Days
                    <input
                      type="number"
                      min={1}
                      max={90}
                      value={aiHorizonDays}
                      onChange={(e) => setAiHorizonDays(Number.parseInt(e.target.value, 10) || 7)}
                    />
                  </label>
                </div>
                <button
                  type="button"
                  className="clear-btn crime-ai-district-fetch"
                  disabled={districtForecastLoading || !aiDistrictPick}
                  onClick={fetchDistrictForecastPanel}
                >
                  {districtForecastLoading ? "Loading…" : "Fetch district forecast"}
                </button>
                {districtForecastError && (
                  <div className="crime-ai-status crime-ai-status--error" role="alert">
                    {districtForecastError}
                  </div>
                )}
                {districtForecast?.predictions?.length > 0 && (
                  <div className="crime-ai-forecast crime-ai-district-series">
                    <div className="crime-ai-block-title" style={{ marginBottom: 8 }}>
                      {districtForecast.area_id || aiDistrictPick}
                    </div>
                    <div className="crime-ai-forecast-row">
                      {districtForecast.predictions.map((f) => (
                        <div key={String(f.date)} className="crime-ai-forecast-cell">
                          <div className="crime-ai-forecast-date">{String(f.date).slice(-5)}</div>
                          <div className="crime-ai-forecast-val">
                            {Number(f.predicted_count) < 10
                              ? Number(f.predicted_count).toFixed(2)
                              : Math.round(Number(f.predicted_count))}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
              <div className="crime-ai-api-hint" title="Configure in .env for production">
                API: <code className="crime-ai-code">{CRIME_API_BASE}</code>
              </div>
              {aiCircleArea && (
                <div className="crime-ai-cyber-card">
                  <div className="crime-ai-cyber-head">
                    <strong>Predicted heatmap mapping</strong>
                    <span>{predictionHeatPoints.length} predicted points</span>
                  </div>
                  <p className="crime-ai-cyber-sub">
                    Heatmap appears only after radius selection. Move cursor over the heatmap area to view prediction details.
                  </p>
                </div>
              )}
              {isAiLoading && (
                <div className="crime-ai-status crime-ai-status--loading" role="status">
                  Sending coordinates to the prediction service…
                </div>
              )}
              {aiError && !isAiLoading && (
                <div className="crime-ai-status crime-ai-status--error" role="alert">
                  {aiError}
                </div>
              )}
              {!isAiLoading && !aiError && !aiReport && (
                <div className="crime-ai-status crime-ai-status--muted">Draw a circle on the map to load predictions.</div>
              )}
              {aiReport && !isAiLoading && (
                <div className="crime-ai-report">
                  {aiReport.message ? (
                    <div className="crime-ai-message">{aiReport.message}</div>
                  ) : (
                    <>
                      <h4 className="crime-ai-heading">
                        Severity (avg):{" "}
                        <span className="crime-ai-accent">{aiReport.radius_stats?.avg_severity ?? "—"}</span> / 10
                      </h4>
                      {aiReport.crime_timing?.summary && (
                        <p className="crime-ai-summary">{aiReport.crime_timing.summary}</p>
                      )}
                      <div className="crime-ai-block">
                        <strong className="crime-ai-block-title">Hotspot in radius</strong>
                        <div className="crime-ai-hotspot">
                          <div className="crime-ai-place">
                            📍 {aiReport.radius_stats?.most_dangerous_place ?? "—"}
                          </div>
                          {aiReport.radius_stats?.micro_hotspot && (
                            <div className="crime-ai-micro">
                              <div>
                                <span className="crime-ai-label">GPS</span>{" "}
                                {aiReport.radius_stats.micro_hotspot.latitude},{" "}
                                {aiReport.radius_stats.micro_hotspot.longitude}
                              </div>
                              <div>
                                <span className="crime-ai-label">Primary crime</span>{" "}
                                {aiReport.radius_stats.micro_hotspot.top_crime}
                              </div>
                              <div>
                                <span className="crime-ai-label">Peak</span>{" "}
                                {aiReport.radius_stats.micro_hotspot.peak_time}
                              </div>
                            </div>
                          )}
                        </div>
                      </div>
                      {Array.isArray(aiReport.crime_analysis?.top_crime_types) &&
                        aiReport.crime_analysis.top_crime_types.length > 0 && (
                          <div className="crime-ai-block">
                            <strong className="crime-ai-block-title">Top crime types</strong>
                            {aiReport.crime_analysis.top_crime_types.map((c) => (
                              <div key={String(c.type)} className="crime-ai-row">
                                <span>{c.type}</span>
                                <span className="crime-ai-pct">{c.percentage}%</span>
                              </div>
                            ))}
                          </div>
                        )}
                      {aiReport.environmental_intelligence && (
                        <div className="crime-ai-env">
                          <strong className="crime-ai-env-title">Environmental context</strong>
                          <div className="crime-ai-env-body">
                            Liquor POIs: {aiReport.environmental_intelligence.poi_detected?.liquor_stores ?? 0} · Bars:{" "}
                            {aiReport.environmental_intelligence.poi_detected?.nightclubs_bars ?? 0}
                            <br />
                            API risk modifier: +{aiReport.environmental_intelligence.api_risk_modifier ?? 0}%
                          </div>
                        </div>
                      )}
                      {aiReport.forecast_7_day?.predictions?.length > 0 && (
                        <div className="crime-ai-forecast">
                          <strong className="crime-ai-block-title">7-day forecast</strong>
                          <div className="crime-ai-forecast-row">
                            {aiReport.forecast_7_day.predictions.map((f) => (
                              <div key={String(f.date)} className="crime-ai-forecast-cell">
                                <div className="crime-ai-forecast-date">{String(f.date).slice(-5)}</div>
                                <div className="crime-ai-forecast-val">
                                  {Number(f.predicted_count) < 10
                                    ? Number(f.predicted_count).toFixed(2)
                                    : Math.round(Number(f.predicted_count))}
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                      {aiReport.repeat_probability_pct != null && (
                        <div className="crime-ai-footer">
                          Repeat probability: <strong>{aiReport.repeat_probability_pct}%</strong>
                          <span className="crime-ai-live">ML pipeline</span>
                        </div>
                      )}
                    </>
                  )}
                  <button
                    type="button"
                    className="clear-btn crime-ai-dismiss"
                    onClick={() => {
                      setAiReport(null);
                      setAiError(null);
                    }}
                  >
                    Clear results
                  </button>
                </div>
              )}
            </div>
          )}

          {rightTab === "patrol" && (
            <div className="patrol-panel">
              <div className="patrol-placeholder">
                <div className="patrol-panel-header">
                  <div className="section-title patrol-main-title">Control room · Patrol</div>
                </div>
                <button type="button" className="clear-btn patrol-to-ai-btn" onClick={() => setRightTab("ai")}>
                  Open AI predictions (crime ML)
                </button>
                {patrolStatusText && <div className="patrol-status-line">{patrolStatusText}</div>}
                <p className="patrol-stats-line" style={{ marginTop: 0 }}>
                  Live patrols are on the map (SOS tab). Nearest officer gets an <strong>accept</strong> request; route appears
                  after they accept.
                </p>
                <div className="section-title" style={{ marginTop: 12 }}>
                  From patrol
                </div>
                <div className="patrol-inbox-scroll" style={{ maxHeight: 140, overflow: "auto", marginBottom: 12 }}>
                  {patrolToAdminFeed.length === 0 ? (
                    <div style={{ fontSize: 12, color: "var(--muted)" }}>No messages yet.</div>
                  ) : (
                    patrolToAdminFeed.map((m) => (
                      <div key={m.id} style={{ fontSize: 11, marginBottom: 8, borderBottom: "1px solid rgba(255,255,255,0.08)", paddingBottom: 6 }}>
                        <div style={{ color: "var(--muted)" }}>{m.created_at ? String(m.created_at).slice(0, 19) : ""}</div>
                        <div>
                          <strong>{String(m.patrol_uid || "").slice(0, 8)}…</strong> {m.message != null ? String(m.message) : ""}
                        </div>
                      </div>
                    ))
                  )}
                </div>
                <label className="label patrol-label-accent patrol-spaced-label" htmlFor="patrol-msg-search">
                  Message to patrol
                </label>
                <div className="patrol-combobox" ref={patrolMessageComboRef}>
                  <input
                    id="patrol-msg-search"
                    className="patrol-field"
                    role="combobox"
                    aria-expanded={patrolMessageListOpen}
                    aria-autocomplete="list"
                    autoComplete="off"
                    value={patrolMessageSearch}
                    onChange={onPatrolMessageSearchChange}
                    onFocus={() => setPatrolMessageListOpen(true)}
                    placeholder="Search officer…"
                  />
                  {patrolMessageListOpen && filteredPatrolMessageRecipients.length > 0 && (
                    <ul className="patrol-combobox-list" role="listbox">
                      {filteredPatrolMessageRecipients.map((r) => (
                        <li key={r.uid} role="presentation">
                          <button
                            type="button"
                            role="option"
                            className="patrol-combobox-option"
                            onMouseDown={(e) => e.preventDefault()}
                            onClick={() => selectPatrolMessageRecipient(r)}
                          >
                            <span className="patrol-combobox-option-title">{r.name}</span>
                            {r.pid ? (
                              <span className="patrol-combobox-option-meta">PID {r.pid}</span>
                            ) : null}
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                  {patrolMessageListOpen &&
                    patrolMessageRecipients.length === 0 && (
                      <div className="patrol-combobox-empty">No enrolled patrol units yet.</div>
                    )}
                  {patrolMessageListOpen &&
                    patrolMessageRecipients.length > 0 &&
                    filteredPatrolMessageRecipients.length === 0 &&
                    patrolMessageSearch.trim() !== "" && (
                      <div className="patrol-combobox-empty">No name matches. Try another search.</div>
                    )}
                </div>
                <textarea
                  className="patrol-field patrol-textarea"
                  value={patrolMessageText}
                  onChange={(e) => setPatrolMessageText(e.target.value)}
                  placeholder="Message…"
                  rows={3}
                />
                <button type="button" className="patrol-inbox-btn" onClick={() => void sendMessageToPatrol()}>
                  Send to patrol inbox
                </button>
              </div>
            </div>
          )}
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
    </div>
  );
}

