import { useEffect, useState } from "react";
import { onValue, ref } from "firebase/database";
import { getRealtimeDb } from "./firebase";

function mapProfiles(val) {
  if (!val || typeof val !== "object" || Array.isArray(val)) return [];
  return Object.entries(val).map(([id, data]) => ({
    id,
    ...(typeof data === "object" && data !== null ? data : {}),
  }));
}

export function useProfiles() {
  const [profiles, setProfiles] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    const db = getRealtimeDb();
    if (!db) {
      setProfiles([]);
      setLoading(false);
      return;
    }
    const unsub = onValue(
      ref(db, "profiles"),
      (snap) => {
        try {
          setProfiles(mapProfiles(snap.val()));
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

  return { profiles, loading, error };
}
