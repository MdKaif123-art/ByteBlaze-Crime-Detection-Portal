import { useEffect, useRef, useState } from "react";
import { ref, onValue } from "firebase/database";
import { getRealtimeDb, SOS_RTDB_PATH } from "./firebase";
import { deepDecryptObject } from "./decrypt";

/**
 * Same shape as admin `snapshotToAlerts` / `SOSAlert`:
 * { id, user_id, message?, location_lat?, location_lng?, status?, created_at?, ... }
 */
async function snapshotToAlerts(val) {
  if (val == null) return [];
  const raw = typeof val === "object" && !Array.isArray(val) ? val : {};
  const entries = await Promise.all(
    Object.entries(raw).map(async ([id, data]) => {
      const normalized = typeof data === "object" && data !== null ? data : { value: data };
      const decrypted = await deepDecryptObject(normalized);
      return { id, ...decrypted };
    })
  );
  return entries.filter((x) => x.user_id);
}

function sortAlerts(list) {
  return [...list].sort(
    (a, b) =>
      new Date(b.created_at || 0).getTime() - new Date(a.created_at || 0).getTime()
  );
}

async function snapshotToProfiles(val) {
  if (val == null || typeof val !== "object" || Array.isArray(val)) return {};
  return deepDecryptObject(val);
}

function withProfileData(alerts, profiles) {
  return alerts.map((a) => {
    const p = a.user_id ? profiles[a.user_id] : null;
    if (!p || typeof p !== "object") return a;
    return {
      ...a,
      user_name: a.user_name || p.name || p.full_name || p.username || null,
      phone: a.phone || p.phone || null,
    };
  });
}

/**
 * Live subscription — same path and normalization as admin `main.ts` → `sos_alerts`.
 */
export function useSosReports() {
  const [reports, setReports] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const alertsRef = useRef([]);
  const profilesRef = useRef({});

  useEffect(() => {
    const db = getRealtimeDb();
    if (!db) {
      setLoading(false);
      setError(new Error("Firebase SDK config is missing in src/sos/firebase.js."));
      setReports([]);
      return;
    }

    setLoading(true);
    const publish = () => {
      const merged = withProfileData(alertsRef.current, profilesRef.current);
      setReports(sortAlerts(merged));
    };

    const alertsNode = ref(db, SOS_RTDB_PATH);
    const profilesNode = ref(db, "profiles");

    const unsubAlerts = onValue(
      alertsNode,
      (snap) => {
        void (async () => {
          try {
            alertsRef.current = await snapshotToAlerts(snap.val());
            publish();
            setError(null);
          } catch (e) {
            setError(e instanceof Error ? e : new Error(String(e)));
          } finally {
            setLoading(false);
          }
        })();
      },
      (err) => {
        setError(err);
        setLoading(false);
      }
    );

    const unsubProfiles = onValue(
      profilesNode,
      (snap) => {
        void (async () => {
          try {
            profilesRef.current = await snapshotToProfiles(snap.val());
            publish();
            setError(null);
          } catch (e) {
            setError(e instanceof Error ? e : new Error(String(e)));
          } finally {
            setLoading(false);
          }
        })();
      },
      (err) => {
        setError(err);
        setLoading(false);
      }
    );

    return () => {
      unsubAlerts();
      unsubProfiles();
    };
  }, []);

  return { reports, loading, error, path: SOS_RTDB_PATH };
}

export function sosReportLabel(report) {
  if (!report) return "Alert";
  const msg = String(report.message || "").trim();
  if (msg) return msg.slice(0, 80);
  const st = report.status ? String(report.status) : "";
  if (st) return `${st} · ${report.user_id || report.id}`;
  return String(report.user_id || report.id || "Alert");
}
