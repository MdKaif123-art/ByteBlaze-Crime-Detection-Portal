import { useEffect, useMemo, useState } from "react";
import { onValue, ref } from "firebase/database";
import { getRealtimeDb, PATROL_PROFILES_RTDB_PATH } from "./firebase";

/** patrol_profiles/{uid} — created after patrol signup; must include pid for dashboard enrollment */
function mapByUid(val) {
  if (!val || typeof val !== "object" || Array.isArray(val)) return {};
  const out = {};
  for (const [uid, data] of Object.entries(val)) {
    out[uid] = typeof data === "object" && data !== null ? data : {};
  }
  return out;
}

export function usePatrolProfiles() {
  const [byUid, setByUid] = useState({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    const db = getRealtimeDb();
    if (!db) {
      setByUid({});
      setLoading(false);
      return;
    }
    const unsub = onValue(
      ref(db, PATROL_PROFILES_RTDB_PATH),
      (snap) => {
        try {
          setByUid(mapByUid(snap.val()));
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

  const list = useMemo(
    () =>
      Object.entries(byUid).map(([uid, data]) => ({
        uid,
        pid: data?.pid != null ? String(data.pid) : "",
        ...data,
      })),
    [byUid]
  );

  return { byUid, list, loading, error, path: PATROL_PROFILES_RTDB_PATH };
}
