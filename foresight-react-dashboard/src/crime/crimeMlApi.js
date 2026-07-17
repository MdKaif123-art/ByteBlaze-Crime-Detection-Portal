/**
 * HTTP helpers for the crime-prediction Node API (proxies to FastAPI ml-service).
 * Base URL is usually http://localhost:3000/api/v1 — set VITE_CRIME_API_BASE.
 */

export async function postRadiusIntelligence(apiBase, { latitude, longitude, radius_km, districts }) {
  const body = { latitude, longitude, radius_km };
  if (districts?.length) body.districts = districts;
  const res = await fetch(`${apiBase.replace(/\/$/, "")}/radius-intelligence`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg =
      data?.error || data?.detail || data?.message || `Request failed (${res.status})`;
    throw new Error(typeof msg === "string" ? msg : JSON.stringify(msg));
  }
  return data;
}

export async function getDistrictPredictions(apiBase, { area_id, horizon = 7, level = "district_name" }) {
  if (!area_id) throw new Error("area_id is required");
  const q = new URLSearchParams({
    level,
    area_id: String(area_id),
    horizon: String(horizon),
  });
  const res = await fetch(`${apiBase.replace(/\/$/, "")}/predictions?${q}`);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg =
      data?.error || data?.detail || data?.message || `Request failed (${res.status})`;
    throw new Error(typeof msg === "string" ? msg : JSON.stringify(msg));
  }
  return data;
}

export async function uploadFirCsv(apiBase, file) {
  const formData = new FormData();
  formData.append("file", file);
  const res = await fetch(`${apiBase.replace(/\/$/, "")}/upload-data`, {
    method: "POST",
    body: formData,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg =
      data?.error || data?.detail || data?.message || `Upload failed (${res.status})`;
    throw new Error(typeof msg === "string" ? msg : JSON.stringify(msg));
  }
  return data;
}
