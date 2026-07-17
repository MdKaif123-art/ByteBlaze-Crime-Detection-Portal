import { useEffect, useState } from "react";
import { onValue, ref } from "firebase/database";
import { getRealtimeDb, PATROL_UNITS_RTDB_PATH } from "./firebase";

function mapPatrols(val) {
  if (!val || typeof val !== "object" || Array.isArray(val)) return [];
  return Object.entries(val).map(([key, data]) => {
    const d = typeof data === "object" && data !== null ? data : {};
    const pid = d.pid || key;
    const patrol_uid = d.patrol_uid || key;
    return {
      pid,
      patrol_uid,
      ...d,
    };
  });
}

export function usePatrolUnits() {
  const [patrolUnits, setPatrolUnits] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    const db = getRealtimeDb();
    if (!db) {
      setPatrolUnits([]);
      setLoading(false);
      return;
    }
    const unsub = onValue(
      ref(db, PATROL_UNITS_RTDB_PATH),
      (snap) => {
        try {
          setPatrolUnits(mapPatrols(snap.val()));
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

  return { patrolUnits, loading, error, path: PATROL_UNITS_RTDB_PATH };
}
