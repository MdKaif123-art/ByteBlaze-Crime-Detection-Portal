import { useEffect, useMemo, useState } from "react";
import { push, ref, set } from "firebase/database";
import { useSosReports, sosReportLabel } from "./useSosReports";
import { DEVICES_RTDB_PATH, getRealtimeDb } from "./firebase";
import "./sos-panel.css";

export default function SosPanel({
  selectedReport = null,
  onSelectReport,
  onReportsChange,
  onTogglePatrolEnroll,
  patrolEnrollMode = false,
  patrolAssignments = [],
}) {
  const { reports, loading, error, path } = useSosReports();
  const [localSelected, setLocalSelected] = useState(null);
  const [showHistory, setShowHistory] = useState(false);
  const [adminMessage, setAdminMessage] = useState("");
  const [isSendingMessage, setIsSendingMessage] = useState(false);
  const [sendStatus, setSendStatus] = useState("");
  const selected = selectedReport ?? localSelected;
  const latestReports = useMemo(() => latestByUser(reports), [reports]);
  const selectedUserHistory = useMemo(() => {
    if (!selected) return [];
    const key = getUserKey(selected);
    return reports.filter((r) => getUserKey(r) === key);
  }, [reports, selected]);

  const patrolResponse = useMemo(() => {
    if (!selected?.id) return null;
    return pickAssignmentForSosId(patrolAssignments, selected.id);
  }, [patrolAssignments, selected]);

  function selectReport(report) {
    if (onSelectReport) onSelectReport(report);
    else setLocalSelected(report);
    setShowHistory(false);
    setSendStatus("");
  }

  async function sendAdminMessage() {
    const target = selected;
    const userId = target?.user_id ? String(target.user_id) : "";
    const messageText = adminMessage.trim();
    if (!target || !userId) {
      setSendStatus("User id missing for this alert.");
      return;
    }
    if (!messageText) {
      setSendStatus("Please type a message first.");
      return;
    }
    const db = getRealtimeDb();
    if (!db) {
      setSendStatus("Firebase not configured.");
      return;
    }
    setIsSendingMessage(true);
    setSendStatus("Sending...");
    try {
      const notificationRef = push(ref(db, `admin_notifications/${userId}`));
      await set(notificationRef, {
        title: "Admin Message",
        message: messageText,
        created_at: new Date().toISOString(),
      });
      setAdminMessage("");
      setSendStatus("Message sent.");
    } catch (e) {
      setSendStatus(`Failed: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setIsSendingMessage(false);
    }
  }

  useEffect(() => {
    if (onReportsChange) onReportsChange(reports);
  }, [reports, onReportsChange]);

  return (
    <div className="sos-panel">
      <div className="sos-meta">
        <span className="sos-path" title="Same RTDB paths as sos admin app">
          List: <code>{path}</code>
          <br />
          Map pins: <code>{path}</code> (red) + <code>{DEVICES_RTDB_PATH}</code> (blue)
        </span>
        {onTogglePatrolEnroll && (
          <button
            type="button"
            className="sos-close"
            style={{ marginLeft: 8 }}
            onClick={onTogglePatrolEnroll}
          >
            {patrolEnrollMode ? "Stop Mark Patrol" : "Mark Patrol"}
          </button>
        )}
      </div>

      {loading && <div className="sos-status">Loading SOS reports…</div>}
      {error && (
        <div className="sos-error" role="alert">
          {error.message}
        </div>
      )}

      {!loading && !error && latestReports.length === 0 && (
        <div className="sos-empty">No SOS reports found at this path.</div>
      )}

      <div className="sos-split">
        <div className="sos-list">
          {latestReports.map((r) => (
            <button
              key={r.id}
              type="button"
              className={`sos-item ${selected?.id === r.id ? "active" : ""}`}
              onClick={() => selectReport(r)}
            >
              <div className="sos-item-title">🚺 {displayUserLabel(r)}</div>
              <div className="sos-item-sub">
                <span>{sosReportLabel(r)}</span>
                {r.created_at != null && <span>{formatTime(r.created_at)}</span>}
                {r.user_id != null && (
                  <span>
                    {r.created_at != null ? " · " : ""}
                    {String(r.user_id).slice(0, 36)}
                  </span>
                )}
              </div>
            </button>
          ))}
        </div>

        {selected && (
          <div className="sos-detail">
            <div className="sos-detail-head">
              <strong>SOS report</strong>
              <div className="sos-actions">
                <button type="button" className="sos-close" onClick={() => setShowHistory((v) => !v)}>
                  {showHistory ? "Hide history" : "Show history"}
                </button>
                <button type="button" className="sos-close" onClick={() => selectReport(null)}>
                  Close
                </button>
              </div>
            </div>
            <div className="sos-detail-body">
              {patrolResponse && (
                <div className="sos-patrol-response" role="status">
                  <div className="sos-patrol-response-title">Patrol response</div>
                  <div className="sos-patrol-response-row">
                    <span className="sos-key">Status</span>
                    <span className="sos-val">{String(patrolResponse.status || "—")}</span>
                  </div>
                  <div className="sos-patrol-response-row">
                    <span className="sos-key">Patrol PID</span>
                    <span className="sos-val">{String(patrolResponse.patrol_pid || "—")}</span>
                  </div>
                  {patrolResponse.distance_m != null && (
                    <div className="sos-patrol-response-row">
                      <span className="sos-key">Dispatch distance</span>
                      <span className="sos-val">{(Number(patrolResponse.distance_m) / 1000).toFixed(2)} km</span>
                    </div>
                  )}
                  {patrolResponse.assigned_at != null && (
                    <div className="sos-patrol-response-row">
                      <span className="sos-key">Assigned at</span>
                      <span className="sos-val">{formatTime(patrolResponse.assigned_at)}</span>
                    </div>
                  )}
                  {patrolResponse.reached_at != null && (
                    <div className="sos-patrol-response-row">
                      <span className="sos-key">Reached at</span>
                      <span className="sos-val">{formatTime(patrolResponse.reached_at)}</span>
                    </div>
                  )}
                </div>
              )}
              <div className="sos-message-box">
                <label className="sos-message-label">Message user</label>
                <textarea
                  className="sos-message-input"
                  rows={3}
                  value={adminMessage}
                  onChange={(e) => setAdminMessage(e.target.value)}
                  placeholder="Type admin message..."
                />
                <div className="sos-message-actions">
                  <button
                    type="button"
                    className="sos-close"
                    disabled={isSendingMessage}
                    onClick={sendAdminMessage}
                  >
                    {isSendingMessage ? "Sending..." : "Send Message"}
                  </button>
                  {sendStatus && <span className="sos-message-status">{sendStatus}</span>}
                </div>
              </div>
              {Object.entries(flattenForDisplay(selected)).map(([k, v]) => (
                <div className="sos-row" key={k}>
                  <span className="sos-key">{k}</span>
                  <span className="sos-val">{formatValue(v)}</span>
                </div>
              ))}
              {showHistory && (
                <div className="sos-history">
                  <div className="sos-history-title">History for {displayUserLabel(selected)}</div>
                  {selectedUserHistory.length <= 1 && (
                    <div className="sos-history-empty">No older records for this user.</div>
                  )}
                  {selectedUserHistory.slice(1).map((item) => (
                    <button
                      key={item.id}
                      type="button"
                      className="sos-history-item"
                      onClick={() => selectReport(item)}
                    >
                      <span>{formatTime(item.created_at)}</span>
                      <span>{sosReportLabel(item)}</span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function formatTime(t) {
  if (t == null) return "";
  if (typeof t === "number") {
    const d = new Date(t);
    return Number.isNaN(d.getTime()) ? String(t) : d.toLocaleString();
  }
  const d = new Date(t);
  return Number.isNaN(d.getTime()) ? String(t) : d.toLocaleString();
}

function formatValue(v) {
  if (v == null) return "";
  if (typeof v === "object") return JSON.stringify(v, null, 2);
  return String(v);
}

function pickAssignmentForSosId(patrolAssignments, sosId) {
  if (sosId == null || !Array.isArray(patrolAssignments) || patrolAssignments.length === 0) return null;
  const sid = String(sosId);
  const matches = patrolAssignments.filter((a) => String(a.sos_id) === sid);
  if (!matches.length) return null;
  return matches.sort((a, b) => new Date(b.assigned_at || 0) - new Date(a.assigned_at || 0))[0];
}

function getUserKey(report) {
  if (!report || typeof report !== "object") return "";
  return String(report.user_id || report.phone || report.mobile || report.phone_number || report.id || "");
}

function displayUserLabel(report) {
  const name = report?.name || report?.user_name || report?.username || report?.full_name;
  const userId = report?.user_id != null ? String(report.user_id) : "";
  const phone = report?.phone || report?.mobile || report?.phone_number;
  if (name) return String(name);
  if (phone) return String(phone);
  if (userId) return userId;
  return `User ${report?.id || ""}`.trim();
}

function latestByUser(reports) {
  const out = [];
  const seen = new Set();
  for (const report of reports) {
    const key = getUserKey(report);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(report);
  }
  return out;
}

/** Flatten nested objects one level for display; deep values as JSON */
function flattenForDisplay(obj, prefix = "") {
  const out = {};
  for (const [k, v] of Object.entries(obj)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (v != null && typeof v === "object" && !Array.isArray(v) && !(v instanceof Date)) {
      Object.assign(out, flattenForDisplay(v, key));
    } else {
      out[key] = v;
    }
  }
  return out;
}
