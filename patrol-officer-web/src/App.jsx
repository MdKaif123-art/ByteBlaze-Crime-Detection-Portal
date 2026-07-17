import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import {
  createUserWithEmailAndPassword,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signOut,
} from "firebase/auth";
import { get, onValue, push, ref, set, update } from "firebase/database";
import { auth, db, PATROL_TO_ADMIN_PATH } from "./firebase";
import { fetchOsrmDrivingRoute } from "./osrm.js";

function formatAuthError(err) {
  const code = err && typeof err === "object" && "code" in err ? String(err.code) : "";
  const msg = err instanceof Error ? err.message : String(err);
  switch (code) {
    case "auth/email-already-in-use":
      return "That email is already registered. Sign in instead.";
    case "auth/invalid-email":
      return "Enter a valid email address.";
    case "auth/weak-password":
      return "Password is too weak. Use at least 6 characters.";
    case "auth/user-not-found":
    case "auth/wrong-password":
    case "auth/invalid-credential":
      return "Email or password is incorrect.";
    case "auth/too-many-requests":
      return "Too many attempts. Try again in a few minutes.";
    default:
      return msg;
  }
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

function assignmentKey(a) {
  if (!a) return "";
  return String(a.assignment_id || a._fbKey || "");
}

function normalizeAssignments(val) {
  if (!val || typeof val !== "object") return [];
  return Object.entries(val).map(([k, d]) => ({
    ...(typeof d === "object" && d !== null ? d : {}),
    _fbKey: k,
    assignment_id: d?.assignment_id || k,
  }));
}

/** Match assignments whether RTDB used Firebase uid or PID as `patrol_uid` (data can be inconsistent). */
function assignmentBelongsToOfficer(a, authUid, officerPid) {
  const uid = String(authUid || "");
  const pid = String(officerPid || "").trim();
  const pu = String(a?.patrol_uid || "").trim();
  const pp = String(a?.patrol_pid || "").trim();
  if (uid && pu === uid) return true;
  if (pid && pp === pid) return true;
  if (pid && pu === pid) return true;
  return false;
}

const meIcon = L.divIcon({
  className: "",
  html: `<div style="width:18px;height:18px;border-radius:50%;background:#2563eb;border:3px solid #fff;box-shadow:0 2px 8px rgba(0,0,0,.35)"></div>`,
  iconSize: [18, 18],
  iconAnchor: [9, 9],
});

const sosIcon = L.divIcon({
  className: "",
  html: `<div style="width:22px;height:22px;border-radius:50%;background:#dc2626;border:3px solid #fff;box-shadow:0 2px 10px rgba(220,38,38,.55)"></div>`,
  iconSize: [22, 22],
  iconAnchor: [11, 11],
});

export default function App() {
  const [user, setUser] = useState(null);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [signupName, setSignupName] = useState("");
  const [signupPid, setSignupPid] = useState("");
  const [isSignup, setIsSignup] = useState(false);
  const [loginErr, setLoginErr] = useState("");
  const [authBusy, setAuthBusy] = useState(false);
  const [pid, setPid] = useState(null);
  const [profileName, setProfileName] = useState("");
  const [assignmentsRaw, setAssignmentsRaw] = useState(null);
  const [patrolUnit, setPatrolUnit] = useState(null);
  const [myPos, setMyPos] = useState(null);
  const [routeLatLngs, setRouteLatLngs] = useState([]);
  const [actionErr, setActionErr] = useState("");
  const [visiting, setVisiting] = useState(false);
  const [busyAction, setBusyAction] = useState(false);
  const [adminInbox, setAdminInbox] = useState([]);
  const [msgToAdmin, setMsgToAdmin] = useState("");
  /** Mobile shell: alerts (home), map, control-room messages, history */
  const [mobileTab, setMobileTab] = useState("alerts");
  const [mapTick, setMapTick] = useState(0);
  const [pendingRouteLatLngs, setPendingRouteLatLngs] = useState([]);
  const [geoError, setGeoError] = useState(null);
  const [pwaDeferred, setPwaDeferred] = useState(null);
  const [pwaStandalone, setPwaStandalone] = useState(false);

  const mapRef = useRef(null);
  const mapInstanceRef = useRef(null);
  const fgRef = useRef(null);

  useEffect(() => onAuthStateChanged(auth, setUser), []);

  useEffect(() => {
    if (user?.uid) setMobileTab("alerts");
  }, [user?.uid]);

  useEffect(() => {
    const mq = window.matchMedia("(display-mode: standalone)");
    const syncStandalone = () => {
      const standalone =
        mq.matches ||
        window.matchMedia("(display-mode: fullscreen)").matches ||
        window.matchMedia("(display-mode: minimal-ui)").matches ||
        Boolean(window.navigator.standalone);
      setPwaStandalone(standalone);
    };
    syncStandalone();
    mq.addEventListener("change", syncStandalone);
    const onBeforeInstall = (e) => {
      e.preventDefault();
      setPwaDeferred(e);
    };
    const onInstalled = () => {
      setPwaDeferred(null);
      setPwaStandalone(true);
    };
    window.addEventListener("beforeinstallprompt", onBeforeInstall);
    window.addEventListener("appinstalled", onInstalled);
    return () => {
      mq.removeEventListener("change", syncStandalone);
      window.removeEventListener("beforeinstallprompt", onBeforeInstall);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  const runPwaInstall = useCallback(async () => {
    const evt = pwaDeferred;
    if (!evt || typeof evt.prompt !== "function") return;
    try {
      await evt.prompt();
      await evt.userChoice;
    } finally {
      setPwaDeferred(null);
    }
  }, [pwaDeferred]);

  const pwaIosAddToHome =
    !pwaStandalone &&
    !pwaDeferred &&
    /iPad|iPhone|iPod/.test(navigator.userAgent) &&
    !window.navigator.standalone;

  useEffect(() => {
    if (!user) {
      setPid(null);
      setProfileName("");
      return;
    }
    return onValue(ref(db, `patrol_profiles/${user.uid}`), (snap) => {
      const d = snap.exists() ? snap.val() : {};
      const p = d?.pid != null ? String(d.pid).trim() : "";
      setPid(p || null);
      setProfileName(d?.name != null ? String(d.name) : "");
    });
  }, [user]);

  useEffect(() => {
    if (!user) {
      setAssignmentsRaw(null);
      return;
    }
    return onValue(ref(db, "patrol_assignments"), (snap) => {
      setAssignmentsRaw(snap.val());
    });
  }, [user]);

  useEffect(() => {
    if (!user) {
      setAdminInbox([]);
      return;
    }
    return onValue(ref(db, `admin_notifications/${user.uid}`), (snap) => {
      const v = snap.val();
      if (!v || typeof v !== "object") {
        setAdminInbox([]);
        return;
      }
      const rows = Object.entries(v)
        .map(([id, d]) => ({ id, ...(typeof d === "object" && d ? d : {}) }))
        .sort((a, b) => String(b.created_at || "").localeCompare(String(a.created_at || "")))
        .slice(0, 30);
      setAdminInbox(rows);
    });
  }, [user]);

  const assignments = useMemo(() => normalizeAssignments(assignmentsRaw), [assignmentsRaw]);

  const mine = useMemo(() => {
    if (!user?.uid) return [];
    return assignments.filter((a) => assignmentBelongsToOfficer(a, user.uid, pid));
  }, [assignments, user?.uid, pid]);

  const pendingOffer = useMemo(
    () => mine.find((a) => String(a.status || "").toLowerCase() === "pending_accept") || null,
    [mine]
  );

  const activeRun = useMemo(
    () =>
      mine.find((a) => ["routing", "assigned"].includes(String(a.status || "").toLowerCase())) || null,
    [mine]
  );

  const routeAssignment = activeRun;

  /** RTDB key for `patrol_units/{pid}` — profile pid, or pid from an active assignment. */
  const effectiveUnitPid = useMemo(
    () => String(pid || pendingOffer?.patrol_pid || routeAssignment?.patrol_pid || "").trim(),
    [pid, pendingOffer, routeAssignment]
  );

  useEffect(() => {
    if (!user || !effectiveUnitPid) {
      setPatrolUnit(null);
      return;
    }
    return onValue(ref(db, `patrol_units/${effectiveUnitPid}`), (snap) => {
      setPatrolUnit(snap.exists() ? snap.val() : null);
    });
  }, [user, effectiveUnitPid]);

  useEffect(() => {
    if (!user || !effectiveUnitPid) {
      setGeoError(null);
      return;
    }
    if (!navigator.geolocation) {
      setGeoError({
        code: "unsupported",
        message: "This browser does not support GPS. Use Chrome or Safari on your phone.",
      });
      return;
    }

    const geoOpts = {
      enableHighAccuracy: true,
      maximumAge: 0,
      timeout: 30000,
    };

    const pushLocation = (pos) => {
      const lat = pos.coords.latitude;
      const lng = pos.coords.longitude;
      setMyPos({ lat, lng });
      const t = new Date().toISOString();
      const acc = pos.coords.accuracy;
      void update(ref(db, `patrol_units/${effectiveUnitPid}`), {
        live_lat: lat,
        live_lng: lng,
        location_lat: lat,
        location_lng: lng,
        last_seen: t,
        updated_at: t,
        patrol_uid: user.uid,
        gps_accuracy_m: typeof acc === "number" && Number.isFinite(acc) ? Math.round(acc) : null,
      });
    };

    const onErr = (err) => {
      const c = err?.code;
      if (c === 1) {
        setGeoError({
          code: "denied",
          message:
            "Location is off. Turn it on: open your browser menu → Site settings → Location → Allow. On Android: Settings → Apps → your browser → Permissions → Location.",
        });
        return;
      }
      if (c === 2) {
        setGeoError({
          code: "unavailable",
          message: "GPS could not get a fix. Move outdoors, disable mock locations, and try again.",
        });
        return;
      }
      if (c === 3) {
        setGeoError({
          code: "timeout",
          message: "GPS timed out. Disable battery saver for this app and ensure high-accuracy location is on.",
        });
        return;
      }
      setGeoError({ code: "unknown", message: err?.message || "Could not read GPS." });
    };

    const onOk = (pos) => {
      setGeoError(null);
      pushLocation(pos);
    };

    const watchId = navigator.geolocation.watchPosition(onOk, onErr, geoOpts);
    navigator.geolocation.getCurrentPosition(onOk, () => {}, { ...geoOpts, timeout: 20000 });

    return () => navigator.geolocation.clearWatch(watchId);
  }, [user, effectiveUnitPid]);

  const historyRows = useMemo(() => {
    return mine
      .filter((a) => ["reached", "declined", "closed"].includes(String(a.status || "").toLowerCase()))
      .sort((a, b) => new Date(b.assigned_at || b.reached_at || 0) - new Date(a.assigned_at || a.reached_at || 0))
      .slice(0, 25);
  }, [mine]);

  const upNext = useMemo(() => {
    const cur = routeAssignment;
    const ck = cur ? assignmentKey(cur) : "";
    return mine
      .filter((a) => String(a.status || "").toLowerCase() === "queued" && assignmentKey(a) !== ck)
      .sort((a, b) => new Date(a.assigned_at || 0) - new Date(b.assigned_at || 0));
  }, [mine, routeAssignment]);

  const sosPos = useMemo(() => {
    if (!routeAssignment) return null;
    const lat = Number.parseFloat(routeAssignment.sos_location_lat);
    const lng = Number.parseFloat(routeAssignment.sos_location_lng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
    return { lat, lng };
  }, [routeAssignment]);

  /** SOS location while request is still pending (preview on map before Accept). */
  const pendingSosPos = useMemo(() => {
    if (!pendingOffer || routeAssignment) return null;
    const lat = Number.parseFloat(pendingOffer.sos_location_lat);
    const lng = Number.parseFloat(pendingOffer.sos_location_lng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
    return { lat, lng };
  }, [pendingOffer, routeAssignment]);

  useEffect(() => {
    if (!myPos || !sosPos || !routeAssignment) {
      setRouteLatLngs([]);
      return;
    }
    let cancelled = false;
    (async () => {
      const routed = await fetchOsrmDrivingRoute(myPos.lat, myPos.lng, sosPos.lat, sosPos.lng);
      if (cancelled) return;
      if (routed?.latlngs?.length) {
        setRouteLatLngs(routed.latlngs);
      } else {
        setRouteLatLngs([
          [myPos.lat, myPos.lng],
          [sosPos.lat, sosPos.lng],
        ]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [myPos?.lat, myPos?.lng, sosPos?.lat, sosPos?.lng, routeAssignment]);

  useEffect(() => {
    if (!myPos || !pendingSosPos || routeAssignment) {
      setPendingRouteLatLngs([]);
      return;
    }
    let cancelled = false;
    (async () => {
      const routed = await fetchOsrmDrivingRoute(
        myPos.lat,
        myPos.lng,
        pendingSosPos.lat,
        pendingSosPos.lng
      );
      if (cancelled) return;
      setPendingRouteLatLngs(routed?.latlngs?.length ? routed.latlngs : []);
    })();
    return () => {
      cancelled = true;
    };
  }, [myPos?.lat, myPos?.lng, pendingSosPos?.lat, pendingSosPos?.lng, routeAssignment]);

  useEffect(() => {
    if (user) return;
    if (mapInstanceRef.current) {
      mapInstanceRef.current.remove();
      mapInstanceRef.current = null;
      fgRef.current = null;
    }
  }, [user]);

  useEffect(() => {
    if (!user || mobileTab !== "map") return;

    let cancelled = false;
    let rafId = 0;
    let attempts = 0;
    let resizeObs = null;

    const disposeMap = () => {
      if (mapInstanceRef.current) {
        try {
          mapInstanceRef.current.remove();
        } catch {
          /* map may already be torn down */
        }
        mapInstanceRef.current = null;
        fgRef.current = null;
      }
    };

    const finishInit = (el) => {
      if (cancelled) return;
      disposeMap();

      const map = L.map(el, { zoomControl: true }).setView([20.5937, 78.9629], 11);
      const tiles = L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
        maxZoom: 19,
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
        crossOrigin: true,
      });
      tiles.addTo(map);

      const fg = L.featureGroup().addTo(map);
      mapInstanceRef.current = map;
      fgRef.current = fg;

      const fixSize = () => {
        if (cancelled || mapInstanceRef.current !== map) return;
        map.invalidateSize({ animate: false });
        setMapTick((t) => t + 1);
      };

      map.whenReady(() => {
        fixSize();
        requestAnimationFrame(fixSize);
        window.setTimeout(fixSize, 50);
        window.setTimeout(fixSize, 280);
      });

      if (typeof ResizeObserver !== "undefined") {
        resizeObs = new ResizeObserver(() => {
          if (!cancelled && mapInstanceRef.current === map) map.invalidateSize({ animate: false });
        });
        resizeObs.observe(el);
      }
    };

    const tryInit = () => {
      if (cancelled) return;
      const el = mapRef.current;
      if (!el) {
        attempts += 1;
        if (attempts < 200) rafId = requestAnimationFrame(tryInit);
        return;
      }
      const w = el.offsetWidth;
      const h = el.offsetHeight;
      const bigEnough = w >= 40 && h >= 40;
      attempts += 1;
      if (!bigEnough && attempts < 200) {
        rafId = requestAnimationFrame(tryInit);
        return;
      }
      finishInit(el);
    };

    rafId = requestAnimationFrame(tryInit);

    const onWinResize = () => {
      mapInstanceRef.current?.invalidateSize({ animate: false });
    };
    window.addEventListener("resize", onWinResize);

    return () => {
      cancelled = true;
      cancelAnimationFrame(rafId);
      window.removeEventListener("resize", onWinResize);
      resizeObs?.disconnect();
      disposeMap();
    };
  }, [user, mobileTab]);

  useEffect(() => {
    if (mobileTab !== "map") return;
    const fg = fgRef.current;
    const map = mapInstanceRef.current;
    if (!fg || !map) return;
    fg.clearLayers();
    if (myPos) L.marker([myPos.lat, myPos.lng], { icon: meIcon }).addTo(fg).bindPopup("You (live)");
    if (sosPos && routeAssignment) {
      L.marker([sosPos.lat, sosPos.lng], { icon: sosIcon }).addTo(fg).bindPopup("SOS — en route");
    } else if (pendingSosPos && pendingOffer) {
      L.marker([pendingSosPos.lat, pendingSosPos.lng], { icon: sosIcon })
        .addTo(fg)
        .bindPopup("SOS — press <strong>Accept dispatch</strong> in the panel to start navigation.");
    }
    if (routeAssignment && routeLatLngs.length >= 2) {
      L.polyline(routeLatLngs, { color: "#f59e0b", weight: 5, opacity: 0.92 }).addTo(fg);
    } else if (routeAssignment && myPos && sosPos) {
      L.polyline(
        [
          [myPos.lat, myPos.lng],
          [sosPos.lat, sosPos.lng],
        ],
        { color: "#f59e0b", weight: 4, opacity: 0.85, dashArray: "10 8" }
      ).addTo(fg);
    } else if (pendingSosPos && myPos && pendingOffer) {
      if (pendingRouteLatLngs.length >= 2) {
        L.polyline(pendingRouteLatLngs, { color: "#64748b", weight: 4, opacity: 0.88 }).addTo(fg);
      } else {
        L.polyline(
          [
            [myPos.lat, myPos.lng],
            [pendingSosPos.lat, pendingSosPos.lng],
          ],
          { color: "#64748b", weight: 3, opacity: 0.75, dashArray: "12 10" }
        ).addTo(fg);
      }
    }
    const bounds = L.latLngBounds([]);
    if (myPos) bounds.extend([myPos.lat, myPos.lng]);
    if (sosPos && routeAssignment) bounds.extend([sosPos.lat, sosPos.lng]);
    else if (pendingSosPos) bounds.extend([pendingSosPos.lat, pendingSosPos.lng]);
    if (bounds.isValid()) map.fitBounds(bounds, { padding: [48, 48], maxZoom: 15 });
  }, [mobileTab, mapTick, myPos, sosPos, routeLatLngs, routeAssignment, pendingSosPos, pendingOffer, pendingRouteLatLngs]);

  const distanceKm = useMemo(() => {
    if (!myPos || !sosPos || !routeAssignment) return null;
    return haversineMeters(myPos, { lat: sosPos.lat, lng: sosPos.lng }) / 1000;
  }, [myPos, sosPos, routeAssignment]);

  const acceptOffer = useCallback(async () => {
    if (!user || !pendingOffer) return;
    const unitPid = String(pid || pendingOffer.patrol_pid || "").trim();
    if (!unitPid) {
      setActionErr("Patrol PID missing — add pid in patrol_profiles or use a unit that has patrol_pid on the assignment.");
      return;
    }
    const key = assignmentKey(pendingOffer);
    if (!key || !pendingOffer.sos_id) return;
    setBusyAction(true);
    setActionErr("");
    const now = new Date().toISOString();
    try {
      await update(ref(db, `patrol_assignments/${key}`), {
        status: "routing",
        accepted_at: now,
        patrol_uid: user.uid,
      });
      await update(ref(db, `sos_alerts/${pendingOffer.sos_id}`), {
        assigned_patrol_pid: unitPid,
        assigned_patrol_uid: user.uid,
        assigned_patrol_id: unitPid,
        assignment_id: key,
        assigned_at: now,
        status: "acknowledged",
        dispatch_status: "accepted",
        pending_assignment_id: null,
        pending_patrol_uid: null,
        pending_patrol_pid: null,
      });
      await update(ref(db, `patrol_units/${unitPid}`), {
        status: "busy",
        active_assignment_id: key,
        assigned_sos_id: pendingOffer.sos_id,
        patrol_uid: user.uid,
        updated_at: now,
      });
    } catch (e) {
      setActionErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusyAction(false);
    }
  }, [user, pid, pendingOffer]);

  const declineOffer = useCallback(async () => {
    if (!user || !pendingOffer) return;
    const key = assignmentKey(pendingOffer);
    if (!key || !pendingOffer.sos_id) return;
    setBusyAction(true);
    setActionErr("");
    const now = new Date().toISOString();
    try {
      await update(ref(db, `patrol_assignments/${key}`), {
        status: "declined",
        declined_at: now,
      });
      await update(ref(db, `sos_alerts/${pendingOffer.sos_id}`), {
        dispatch_status: "declined",
        pending_assignment_id: null,
        pending_patrol_uid: null,
        pending_patrol_pid: null,
      });
    } catch (e) {
      setActionErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusyAction(false);
    }
  }, [user, pendingOffer]);

  const markVisited = useCallback(async () => {
    if (!user || !routeAssignment) return;
    const unitPid = String(pid || routeAssignment.patrol_pid || "").trim();
    if (!unitPid) {
      setActionErr("Patrol PID missing on profile or assignment.");
      return;
    }
    const key = assignmentKey(routeAssignment);
    if (!key || !routeAssignment.sos_id) {
      setActionErr("Missing assignment or SOS id.");
      return;
    }
    setVisiting(true);
    setActionErr("");
    const now = new Date().toISOString();
    try {
      await update(ref(db, `patrol_assignments/${key}`), {
        status: "reached",
        reached_at: now,
      });
      await update(ref(db, `sos_alerts/${routeAssignment.sos_id}`), {
        status: "resolved",
        reached_by_patrol_uid: user.uid,
        reached_at: now,
      });

      const snap = await get(ref(db, "patrol_assignments"));
      const nextList = normalizeAssignments(snap.val()).filter(
        (a) =>
          assignmentBelongsToOfficer(a, user.uid, pid) &&
          String(a.status || "").toLowerCase() === "queued" &&
          assignmentKey(a) !== key
      );
      nextList.sort((a, b) => new Date(a.assigned_at || 0) - new Date(b.assigned_at || 0));
      const next = nextList[0];

      if (next) {
        const nk = assignmentKey(next);
        await update(ref(db, `patrol_assignments/${nk}`), {
          status: "routing",
          promoted_at: now,
        });
        const nextPid = String(pid || next.patrol_pid || "").trim() || unitPid;
        await update(ref(db, `sos_alerts/${next.sos_id}`), {
          assigned_patrol_pid: nextPid,
          assigned_patrol_uid: user.uid,
          assigned_patrol_id: nextPid,
          assignment_id: nk,
          assigned_at: now,
          status: "acknowledged",
          dispatch_status: "accepted",
        });
        await update(ref(db, `patrol_units/${nextPid}`), {
          status: "busy",
          active_assignment_id: nk,
          assigned_sos_id: next.sos_id,
          patrol_uid: user.uid,
          updated_at: now,
        });
      } else {
        await update(ref(db, `patrol_units/${unitPid}`), {
          status: "available",
          active_assignment_id: null,
          assigned_sos_id: null,
          updated_at: now,
        });
      }
    } catch (e) {
      setActionErr(e instanceof Error ? e.message : String(e));
    } finally {
      setVisiting(false);
    }
  }, [user, pid, routeAssignment]);

  async function sendToAdmin() {
    if (!user || !msgToAdmin.trim()) return;
    const r = push(ref(db, PATROL_TO_ADMIN_PATH));
    await set(r, {
      patrol_uid: user.uid,
      patrol_pid: pid,
      message: msgToAdmin.trim(),
      created_at: new Date().toISOString(),
    });
    setMsgToAdmin("");
  }

  async function onLogin(e) {
    e.preventDefault();
    setLoginErr("");
    setAuthBusy(true);
    try {
      await signInWithEmailAndPassword(auth, email.trim(), password);
    } catch (err) {
      setLoginErr(formatAuthError(err));
    } finally {
      setAuthBusy(false);
    }
  }

  async function onSignup(e) {
    e.preventDefault();
    setLoginErr("");
    if (password.length < 6) {
      setLoginErr("Password must be at least 6 characters.");
      return;
    }
    if (password !== confirmPassword) {
      setLoginErr("Passwords do not match.");
      return;
    }
    setAuthBusy(true);
    try {
      const cred = await createUserWithEmailAndPassword(auth, email.trim(), password);
      const uid = cred.user.uid;
      const profile = {
        email: email.trim(),
        created_at: new Date().toISOString(),
      };
      const name = signupName.trim();
      const pidVal = signupPid.trim();
      if (name) profile.name = name;
      if (pidVal) profile.pid = pidVal;
      await set(ref(db, `patrol_profiles/${uid}`), profile);
    } catch (err) {
      setLoginErr(formatAuthError(err));
    } finally {
      setAuthBusy(false);
    }
  }

  async function onLogout() {
    setLoginErr("");
    await signOut(auth);
  }

  const directionsUrl =
    sosPos != null && routeAssignment
      ? `https://www.google.com/maps/dir/?api=1&destination=${sosPos.lat},${sosPos.lng}`
      : null;

  const pendingDistanceKm = useMemo(() => {
    if (!myPos || !pendingSosPos) return null;
    return haversineMeters(myPos, { lat: pendingSosPos.lat, lng: pendingSosPos.lng }) / 1000;
  }, [myPos, pendingSosPos]);

  if (!user) {
    return (
      <div className="patrol-app">
        <form className="patrol-login" onSubmit={isSignup ? onSignup : onLogin}>
          <h1>Patrol Officer</h1>
          <p className="sub">
            {isSignup
              ? "Create an account. Add your patrol ID if you have one so dispatches match your unit. You can complete your profile later in the dashboard if needed."
              : "Sign in. You will appear on the control-room map. When you are nearest to an SOS, you must accept to see the road route."}
          </p>

          <div className="patrol-auth-switch" role="tablist" aria-label="Sign in or sign up">
            <button
              type="button"
              role="tab"
              aria-selected={!isSignup}
              className={`patrol-auth-tab ${!isSignup ? "active" : ""}`}
              onClick={() => {
                setIsSignup(false);
                setLoginErr("");
                setConfirmPassword("");
              }}
            >
              Sign in
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={isSignup}
              className={`patrol-auth-tab ${isSignup ? "active" : ""}`}
              onClick={() => {
                setIsSignup(true);
                setLoginErr("");
              }}
            >
              Sign up
            </button>
          </div>

          {isSignup ? (
            <>
              <input
                className="patrol-field"
                type="text"
                autoComplete="name"
                placeholder="Display name (optional)"
                value={signupName}
                onChange={(e) => setSignupName(e.target.value)}
              />
              <input
                className="patrol-field"
                type="text"
                autoComplete="off"
                placeholder="Patrol / unit ID (PID) — optional but needed to accept dispatches"
                value={signupPid}
                onChange={(e) => setSignupPid(e.target.value)}
              />
            </>
          ) : null}

          <input
            className="patrol-field"
            type="email"
            autoComplete="email"
            placeholder="Email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
          <input
            className="patrol-field"
            type="password"
            autoComplete={isSignup ? "new-password" : "current-password"}
            placeholder="Password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            minLength={isSignup ? 6 : undefined}
          />
          {isSignup ? (
            <input
              className="patrol-field"
              type="password"
              autoComplete="new-password"
              placeholder="Confirm password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              required
              minLength={6}
            />
          ) : null}

          {loginErr ? <div className="err">{loginErr}</div> : null}
          <button className="patrol-btn" type="submit" disabled={authBusy}>
            {authBusy ? "Please wait…" : isSignup ? "Create account" : "Sign in"}
          </button>
        </form>
      </div>
    );
  }

  const alertsBadge = Boolean(pendingOffer);
  const messagesBadgeCount = adminInbox.length;

  return (
    <div className="patrol-app patrol-app--shell">
      <header className="patrol-header patrol-header--shell">
        <div className="patrol-header-brand">
          <span className="patrol-header-icon" aria-hidden>
            🛡️
          </span>
          <div>
            <h1>Patrol</h1>
            <div className="meta">
              {profileName || user.email?.split("@")[0]} {pid ? `· ${pid}` : ""}
              <span className="patrol-status-pill">{patrolUnit?.status ? String(patrolUnit.status) : "online"}</span>
            </div>
          </div>
        </div>
        <button className="patrol-header-logout" type="button" onClick={() => void onLogout()} aria-label="Log out">
          Out
        </button>
      </header>

      <main className="patrol-mobile-stage">
        {mobileTab === "alerts" ? (
          <div className="patrol-scroll patrol-tab-panel" id="panel-alerts">
            {!pid ? (
              <div className="patrol-banner warn">
                Add your <strong>patrol ID (PID)</strong> in profile (signup or RTDB <code>patrol_profiles/{user.uid}</code>) so you can accept dispatches.
              </div>
            ) : null}

            {geoError ? (
              <div className="patrol-banner patrol-banner--geo" role="alert">
                <strong>{geoError.code === "unsupported" ? "GPS not available" : "Location is off or blocked"}</strong>
                <p className="patrol-geo-msg">{geoError.message}</p>
              </div>
            ) : null}

            <section className="patrol-dispatch-panel patrol-dispatch-panel--mobile" aria-labelledby="dispatch-title">
              <div className="patrol-dispatch-header">
                <span className="patrol-dispatch-badge" aria-hidden>
                  !
                </span>
                <div>
                  <h2 id="dispatch-title" className="patrol-dispatch-title">
                    Alerts
                  </h2>
                  <p className="patrol-dispatch-sub">Incoming SOS offers. Accept here, then open the Map tab for navigation.</p>
                </div>
              </div>

              {pendingOffer ? (
                <div className="patrol-dispatch-body">
                  <div className="patrol-dispatch-meta">
                    <div className="patrol-dispatch-row">
                      <span className="label">SOS ID</span>
                      <strong className="patrol-dispatch-sos">{String(pendingOffer.sos_id)}</strong>
                    </div>
                    <div className="patrol-dispatch-row">
                      <span className="label">Offer distance</span>
                      <span>
                        {pendingOffer.distance_m != null ? `${(Number(pendingOffer.distance_m) / 1000).toFixed(2)} km` : "—"}
                      </span>
                    </div>
                    {pendingDistanceKm != null ? (
                      <div className="patrol-dispatch-row">
                        <span className="label">Your distance now</span>
                        <span>{pendingDistanceKm.toFixed(2)} km</span>
                      </div>
                    ) : null}
                  </div>
                  <div className="patrol-dispatch-actions">
                    <button
                      className="patrol-btn patrol-btn-accept"
                      type="button"
                      disabled={busyAction}
                      onClick={() => void acceptOffer()}
                    >
                      {busyAction ? "Working…" : "Accept"}
                    </button>
                    <button className="patrol-btn patrol-btn-decline" type="button" disabled={busyAction} onClick={() => void declineOffer()}>
                      Decline
                    </button>
                  </div>
                  {actionErr ? <div className="err patrol-dispatch-err">{actionErr}</div> : null}
                </div>
              ) : (
                <div className="patrol-dispatch-empty">
                  <p>All clear — no pending SOS.</p>
                  <p className="muted">Keep this screen in view; new offers appear here with a sound-worthy pulse on the tab.</p>
                </div>
              )}
            </section>

            <div className="patrol-card patrol-card-section">
              <h2>Active mission</h2>
              {!routeAssignment ? (
                <p className="idle">{pendingOffer ? "Accept the alert above, then use the Map tab." : "Waiting for dispatch…"}</p>
              ) : (
                <>
                  <div className="patrol-stat">
                    <span>SOS</span>
                    <span>{String(routeAssignment.sos_id)}</span>
                  </div>
                  <div className="patrol-stat">
                    <span>Status</span>
                    <span>{String(routeAssignment.status || "—")}</span>
                  </div>
                  {distanceKm != null ? (
                    <div className="patrol-stat">
                      <span>Straight line</span>
                      <span>{distanceKm.toFixed(2)} km</span>
                    </div>
                  ) : null}
                  <div className="patrol-actions">
                    {directionsUrl ? (
                      <a className="patrol-btn" href={directionsUrl} target="_blank" rel="noreferrer">
                        Google Maps
                      </a>
                    ) : null}
                    <button className="patrol-btn danger-outline" type="button" disabled={visiting} onClick={() => void markVisited()}>
                      {visiting ? "Saving…" : "Mark reached"}
                    </button>
                  </div>
                </>
              )}
            </div>

            {upNext.length > 0 ? (
              <div className="patrol-card patrol-card-section">
                <h2>Queued next</h2>
                {upNext.map((q) => (
                  <div key={assignmentKey(q)} className="patrol-queue-item">
                    SOS <strong>{String(q.sos_id)}</strong>
                  </div>
                ))}
              </div>
            ) : null}

            {pwaStandalone ? (
              <section className="patrol-pwa-panel patrol-pwa-panel--standalone" aria-label="App status">
                <span className="patrol-pwa-led" aria-hidden />
                <div className="patrol-pwa-panel-text">
                  <strong>Standalone</strong>
                  <span>Running as installed app · service worker keeps assets fresh</span>
                </div>
              </section>
            ) : pwaDeferred ? (
              <section className="patrol-pwa-panel" aria-label="Install application">
                <div className="patrol-pwa-panel-text">
                  <strong>Install Patrol</strong>
                  <span>Launch from home screen; core UI available offline after first visit</span>
                </div>
                <button type="button" className="patrol-pwa-install-btn" onClick={() => void runPwaInstall()}>
                  Install
                </button>
              </section>
            ) : pwaIosAddToHome ? (
              <section className="patrol-pwa-panel patrol-pwa-panel--ios" aria-label="Add to home screen">
                <div className="patrol-pwa-panel-text">
                  <strong>iOS</strong>
                  <span>
                    <kbd className="patrol-pwa-kbd">Share</kbd> → <kbd className="patrol-pwa-kbd">Add to Home Screen</kbd>
                  </span>
                </div>
              </section>
            ) : null}
          </div>
        ) : null}

        {mobileTab === "map" ? (
          <div className="patrol-tab-panel patrol-tab-panel--map" id="panel-map">
            <div className="patrol-map-wrap patrol-map-wrap--mobile">
              {geoError ? (
                <div className="patrol-map-geo-overlay" role="alert">
                  <strong>Location needed for accurate map</strong>
                  <p>{geoError.message}</p>
                </div>
              ) : null}
              <div ref={mapRef} className="patrol-map patrol-map--mobile" />
              <div className="patrol-map-legend">
                {pendingOffer && !routeAssignment
                  ? "Gray line = driving route from your GPS to SOS (SOS end snapped to road)."
                  : routeAssignment
                    ? "Orange = drive route; blue dot = your exact GPS (start not forced onto road)."
                    : "Blue = your GPS · Red = SOS"}
              </div>
            </div>
          </div>
        ) : null}

        {mobileTab === "messages" ? (
          <div className="patrol-scroll patrol-tab-panel" id="panel-messages">
            <div className="patrol-card patrol-card-section patrol-admin-card patrol-admin-card--full">
              <div className="patrol-admin-head">
                <h2>Control room</h2>
                <span className="patrol-admin-hint">Messages &amp; replies</span>
              </div>
              <div className="patrol-admin-inbox patrol-admin-inbox--full">
                {adminInbox.length === 0 ? (
                  <p className="idle patrol-admin-empty">No messages yet.</p>
                ) : (
                  adminInbox.map((m) => {
                    const body = m.message != null ? String(m.message).trim() : "";
                    const title = m.title != null ? String(m.title).trim() : "";
                    const showBoth = title && body && title !== body;
                    return (
                      <article key={m.id} className="patrol-admin-msg">
                        <time className="patrol-admin-time" dateTime={m.created_at ? String(m.created_at) : undefined}>
                          {m.created_at ? String(m.created_at).replace("T", " ").slice(0, 19) : ""}
                        </time>
                        {showBoth ? <div className="patrol-admin-msg-title">{title}</div> : null}
                        <div className="patrol-admin-msg-body">{showBoth ? body : body || title || "—"}</div>
                      </article>
                    );
                  })
                )}
              </div>
              <label className="patrol-reply-label" htmlFor="patrol-reply">
                Reply
              </label>
              <textarea
                id="patrol-reply"
                className="patrol-field"
                rows={4}
                placeholder="Message to control room…"
                value={msgToAdmin}
                onChange={(e) => setMsgToAdmin(e.target.value)}
              />
              <button className="patrol-btn patrol-btn-send-admin" type="button" onClick={() => void sendToAdmin()}>
                Send
              </button>
            </div>
          </div>
        ) : null}

        {mobileTab === "history" ? (
          <div className="patrol-scroll patrol-tab-panel" id="panel-history">
            <div className="patrol-card patrol-card-section">
              <h2>History</h2>
              {historyRows.length === 0 ? (
                <p className="idle" style={{ margin: 0 }}>
                  No completed items yet.
                </p>
              ) : (
                historyRows.map((h) => (
                  <div key={assignmentKey(h)} className="patrol-queue-item">
                    SOS {String(h.sos_id)} · {String(h.status)}
                    {h.reached_at ? <span className="patrol-history-time"> · {String(h.reached_at).slice(0, 16)}</span> : null}
                  </div>
                ))
              )}
            </div>
          </div>
        ) : null}
      </main>

      <nav className="patrol-tabbar" aria-label="Primary">
        <button
          type="button"
          className={`patrol-tabbar-btn ${mobileTab === "alerts" ? "active" : ""}`}
          onClick={() => setMobileTab("alerts")}
        >
          <span className="patrol-tabbar-icon-wrap">
            <span className="patrol-tabbar-emoji" aria-hidden>
              🔔
            </span>
            {alertsBadge ? <span className="patrol-tabbar-dot" /> : null}
          </span>
          <span className="patrol-tabbar-label">Alerts</span>
        </button>
        <button
          type="button"
          className={`patrol-tabbar-btn ${mobileTab === "map" ? "active" : ""}`}
          onClick={() => setMobileTab("map")}
        >
          <span className="patrol-tabbar-emoji" aria-hidden>
            🗺️
          </span>
          <span className="patrol-tabbar-label">Map</span>
        </button>
        <button
          type="button"
          className={`patrol-tabbar-btn ${mobileTab === "messages" ? "active" : ""}`}
          onClick={() => setMobileTab("messages")}
        >
          <span className="patrol-tabbar-icon-wrap">
            <span className="patrol-tabbar-emoji" aria-hidden>
              💬
            </span>
            {messagesBadgeCount > 0 ? <span className="patrol-tabbar-badge">{messagesBadgeCount > 9 ? "9+" : messagesBadgeCount}</span> : null}
          </span>
          <span className="patrol-tabbar-label">Messages</span>
        </button>
        <button
          type="button"
          className={`patrol-tabbar-btn ${mobileTab === "history" ? "active" : ""}`}
          onClick={() => setMobileTab("history")}
        >
          <span className="patrol-tabbar-emoji" aria-hidden>
            📋
          </span>
          <span className="patrol-tabbar-label">History</span>
        </button>
      </nav>
    </div>
  );
}
