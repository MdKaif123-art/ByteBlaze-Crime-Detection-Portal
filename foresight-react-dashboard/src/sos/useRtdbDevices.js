import { useEffect, useState } from "react";
import { ref, onValue } from "firebase/database";
import { getRealtimeDb, DEVICES_RTDB_PATH } from "./firebase";

/**
 * Same as admin `snapshotToDevices` / `Device`:
 * entries with location_lat + location_lng (RTDB key = device row id).
 */
function snapshotToDevices(val) {
  if (val == null) return [];
  const raw = typeof val === "object" && !Array.isArray(val) ? val : {};
  return Object.entries(raw)
    .map(([id, data]) => ({
      id,
      ...(typeof data === "object" && data !== null ? data : {}),
    }))
    .filter((x) => x.location_lat != null && x.location_lng != null);
}

function sortDevices(list) {
  return [...list].sort(
    (a, b) =>
      new Date(b.last_seen || 0).getTime() - new Date(a.last_seen || 0).getTime()
  );
}

/**
 * Live subscription — same as admin `onValue(ref(db, 'devices'), ...)` (internet / mesh pins).
 */
export function useRtdbDevices() {
  const [devices, setDevices] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    const db = getRealtimeDb();
    if (!db) {
      setLoading(false);
      setDevices([]);
      return;
    }

    setLoading(true);
    const r = ref(db, DEVICES_RTDB_PATH);
    const unsub = onValue(
      r,
      (snap) => {
        try {
          setDevices(sortDevices(snapshotToDevices(snap.val())));
          setError(null);
        } catch (e) {
          setError(e instanceof Error ? e : new Error(String(e)));
        } finally {
          setLoading(false);
        }
      },
      (err) => {
        setError(err);
        setLoading(false);
      }
    );

    return () => unsub();
  }, []);

  return { devices, loading, error, path: DEVICES_RTDB_PATH };
}
