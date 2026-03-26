"use client";

import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import axios from "axios";
import Link from "next/link";

interface Event {
  id: string;
  name: string;
  event_name?: string; // Handle potentially different backend mapping
  event_id?: string;
  preview_image_path?: string;
}

interface Photo {
  photo_id: string;
  file_path: string;
}

interface DbSummary {
  total_events: number;
  total_photos: number;
  pending: number;
  completed: number;
  failed: number;
  total_faces: number;
}

interface Visitor {
  id: number;
  event_id: number;
  event_name: string;
  ip_address: string;
  user_agent: string;
  first_seen: string;
  last_seen: string;
  is_active: boolean;
}

function resolveApiUrl(): string {
  const configured = process.env.NEXT_PUBLIC_API_URL?.trim();

  if (typeof window === "undefined") {
    return configured || "http://localhost:8000";
  }

  const isRemoteHost = !["localhost", "127.0.0.1"].includes(window.location.hostname);
  const configuredIsLocal = !!configured && /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(configured);

  // Ignore local-only config when app is opened on a remote forwarded host.
  if (configured && !(configuredIsLocal && isRemoteHost)) {
    return configured;
  }

  const { protocol, hostname, host } = window.location;
  if (hostname === "localhost" || hostname === "127.0.0.1") {
    return `${protocol}//${hostname}:8000`;
  }

  // GitHub Codespaces/forwarding pattern: 3000-<id> -> 8000-<id>
  const forwardedHost = host.match(/^\d+-(.+)$/);
  if (forwardedHost) {
    return `${protocol}//8000-${forwardedHost[1]}`;
  }

  return `${protocol}//${hostname}:8000`;
}

export default function AdminPage() {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [password, setPassword] = useState("");
  const [events, setEvents] = useState<Event[]>([]);
  const [newEventName, setNewEventName] = useState("");
  const [selectedEvent, setSelectedEvent] = useState<Event | null>(null);
  const [eventPhotos, setEventPhotos] = useState<Photo[]>([]);
  const [folderUrl, setFolderUrl] = useState("");
  const [syncing, setSyncing] = useState(false);
  const [syncProgress, setSyncProgress] = useState({ active: false, current: 0, total: 0 });
  const [previewUploading, setPreviewUploading] = useState(false);
  const [previewRefreshKey, setPreviewRefreshKey] = useState(Date.now());
  const [statusMessage, setStatusMessage] = useState("");

  // DB Management state
  const [dbSummary, setDbSummary] = useState<DbSummary | null>(null);
  const [dbLoading, setDbLoading] = useState(false);
  const [importing, setImporting] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [reseting, setReseting] = useState(false);
  const [importMessage, setImportMessage] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Visitors State
  const [visitors, setVisitors] = useState<Visitor[]>([]);
  const [showVisitors, setShowVisitors] = useState(false);

  const apiUrl = useMemo(() => resolveApiUrl(), []);

  const fetchEvents = useCallback(async () => {
    try {
      const response = await axios.get(`${apiUrl}/events`, { headers: { "X-API-Key": password } });
      setEvents(response.data);
    } catch (error) {
      console.error("Failed to fetch events", error);
      setStatusMessage("Error: Could not fetch events from the backend.");
    }
  }, [apiUrl, password]);

  const fetchEventPhotos = useCallback(async (eventId: string) => {
    try {
      const response = await axios.get(`${apiUrl}/events/${eventId}/photos`, { headers: { "X-API-Key": password } });
      setEventPhotos(response.data);
    } catch (error) {
      console.error("Failed to fetch photos", error);
    }
  }, [apiUrl, password]);

  const fetchDbStatus = useCallback(async () => {
    try {
      setDbLoading(true);
      const response = await axios.get(`${apiUrl}/admin/db-status`, { headers: { "X-API-Key": password } });
      setDbSummary(response.data.summary);
    } catch (error) {
      console.error("Failed to fetch DB status", error);
    } finally {
      setDbLoading(false);
    }
  }, [apiUrl, password]);

  const fetchVisitors = useCallback(async () => {
    try {
      const response = await axios.get(`${apiUrl}/admin/visitors`, { headers: { "X-API-Key": password } });
      setVisitors(response.data);
    } catch (error) {
      console.error("Failed to fetch visitors", error);
    }
  }, [apiUrl, password]);

  useEffect(() => {
    if (selectedEvent) {
      fetchEventPhotos(getEventId(selectedEvent));
    }
  }, [selectedEvent, fetchEventPhotos]);

  useEffect(() => {
    fetchEvents();
  }, [fetchEvents]);

  // Fetch DB status when authenticated and on main view
  useEffect(() => {
    if (isAuthenticated && !selectedEvent) {
      fetchDbStatus();
    }
  }, [isAuthenticated, selectedEvent, fetchDbStatus]);

  // Fetch visitors if panel is open
  useEffect(() => {
    if (isAuthenticated && !selectedEvent && showVisitors) {
      fetchVisitors();
      // Auto-refresh visitors every 30 seconds
      const interval = setInterval(fetchVisitors, 30000);
      return () => clearInterval(interval);
    }
  }, [isAuthenticated, selectedEvent, showVisitors, fetchVisitors]);

  const handleCreateEvent = async (e: React.MouseEvent) => {
    e.preventDefault();
    if (!newEventName.trim()) return;
    try {
      setStatusMessage("Creating event...");
      const response = await axios.post(`${apiUrl}/events`, { event_name: newEventName }, { headers: { "X-API-Key": password } });
      setStatusMessage(`Event "${response.data.event_name || response.data.name}" created.`);
      setNewEventName("");
      fetchEvents(); // Refresh the list
    } catch (error) {
      console.error("Failed to create event", error);
      setStatusMessage("Error: Failed to create event.");
    }
  };

  const handleSyncDrive = async () => {
    if (!folderUrl.trim() || !selectedEvent) return;

    setSyncing(true);
    setStatusMessage("Starting sync initialization...");
    setSyncProgress({ active: true, current: 0, total: 100 });

    try {
      const response = await axios.post(`${apiUrl}/events/${getEventId(selectedEvent)}/sync-drive`, {
        folder_url: folderUrl
      }, { headers: { "X-API-Key": password } });

      const { new_found, total_found } = response.data;

      if (new_found === 0) {
        setStatusMessage(`All ${total_found} images in the folder are already synced.`);
        setSyncProgress({ active: false, current: 0, total: 0 });
        setSyncing(false);
        setFolderUrl("");
        return;
      }

      setStatusMessage(`Syncing ${new_found} new photos...`);
      setSyncProgress({ active: true, current: 0, total: new_found });

      let currentPhotosCount = eventPhotos.length;
      let targetCount = currentPhotosCount + new_found;
      let consecutiveNoProgress = 0;
      let lastCount = currentPhotosCount;

      const interval = setInterval(async () => {
        try {
          const photosRes = await axios.get(`${apiUrl}/events/${getEventId(selectedEvent)}/photos`, { headers: { "X-API-Key": password } });
          const newPhotos = photosRes.data;

          setEventPhotos(newPhotos);

          let syncedNow = newPhotos.length - currentPhotosCount;
          if (syncedNow < 0) syncedNow = 0;

          setSyncProgress(prev => ({ ...prev, current: syncedNow }));

          if (newPhotos.length === lastCount) {
            consecutiveNoProgress++;
          } else {
            consecutiveNoProgress = 0;
            lastCount = newPhotos.length;
          }

          if (newPhotos.length >= targetCount || consecutiveNoProgress > 20) {
            clearInterval(interval);
            setSyncProgress({ active: false, current: 0, total: 0 });
            setSyncing(false);
            setFolderUrl("");
            if (newPhotos.length >= targetCount) {
              setStatusMessage(`Sync complete! Successfully imported ${new_found} new photos.`);
            } else {
              setStatusMessage(`Sync paused or encountered errors. Imported ${syncedNow} photos.`);
            }
          }
        } catch (e) {
          console.error("Polling error", e);
        }
      }, 2000);

    } catch (error) {
      console.error("Sync failed", error);
      setStatusMessage("Error: Failed to initiate Google Drive sync.");
      setSyncing(false);
      setSyncProgress({ active: false, current: 0, total: 0 });
    }
  };

  const handleDeletePhoto = async (photoId: string) => {
    if (!confirm("Are you sure you want to delete this photo?")) return;
    try {
      await axios.delete(`${apiUrl}/photos/${photoId}`, { headers: { "X-API-Key": password } });
      setEventPhotos(prev => prev.filter(p => p.photo_id !== photoId));
    } catch (error) {
      console.error("Delete failed", error);
      alert("Failed to delete photo");
    }
  };

  const handlePreviewImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!selectedEvent) return;
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      setPreviewUploading(true);
      const formData = new FormData();
      formData.append("file", file);

      const response = await axios.post(
        `${apiUrl}/events/${getEventId(selectedEvent)}/preview-image`,
        formData,
        { headers: { "X-API-Key": password } }
      );

      const updatedEvent = response.data?.event as Event | undefined;
      if (updatedEvent) {
        setSelectedEvent(updatedEvent);
        setEvents((prev) => prev.map((ev) => (getEventId(ev) === getEventId(updatedEvent) ? updatedEvent : ev)));
      }

      setPreviewRefreshKey(Date.now());
      setStatusMessage("Event preview image updated.");
    } catch (error) {
      console.error("Preview image upload failed", error);
      setStatusMessage("Error: Failed to update event preview image.");
    } finally {
      setPreviewUploading(false);
      e.target.value = "";
    }
  };

  const handleReset = async () => {
    if (window.confirm("Are you sure you want to reset all data? This cannot be undone.")) {
      try {
        setReseting(true);
        setStatusMessage("Resetting database...");
        await axios.delete(`${apiUrl}/reset`, { headers: { "X-API-Key": password } });
        setStatusMessage("Database has been reset.");
        setSelectedEvent(null);
        setEventPhotos([]);
        fetchEvents();
        fetchDbStatus();
      } catch (error) {
        console.error("Reset failed", error);
        setStatusMessage("Error: Failed to reset database.");
      } finally {
        setReseting(false);
      }
    }
  };

  const handleRetryPending = async () => {
    try {
      setDbLoading(true);
      setStatusMessage("Re-queueing stuck photos...");
      const response = await axios.post(`${apiUrl}/admin/retry-pending`, {}, { headers: { "X-API-Key": password } });
      setImportMessage(`✅ ${response.data.message}`);
      fetchDbStatus();
    } catch (error) {
      console.error("Retry failed", error);
      setImportMessage("❌ Error: Failed to retry pending photos.");
    } finally {
      setDbLoading(false);
    }
  };

  const handleExportDb = async () => {
    try {
      setExporting(true);
      const response = await axios.get(`${apiUrl}/admin/db-export`, { 
        responseType: "blob",
        headers: { "X-API-Key": password }
      });
      const url = window.URL.createObjectURL(new Blob([response.data]));
      const link = document.createElement("a");
      link.href = url;
      link.setAttribute("download", `sharememories_backup_${new Date().toISOString().slice(0, 10)}.json`);
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(url);
      setImportMessage("✅ Database exported successfully!");
      setTimeout(() => setImportMessage(""), 3000);
    } catch (error) {
      console.error("Export failed", error);
      setImportMessage("❌ Error: Failed to export database.");
    } finally {
      setExporting(false);
    }
  };

  const handleImportDb = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!window.confirm("This will import data into the database. Existing data will NOT be overwritten. Continue?")) {
      if (fileInputRef.current) fileInputRef.current.value = "";
      return;
    }

    setImporting(true);
    setImportMessage("Importing...");
    try {
      const formData = new FormData();
      formData.append("file", file);
      const response = await axios.post(`${apiUrl}/admin/db-import`, formData, { headers: { "X-API-Key": password } });
      setImportMessage(`✅ ${response.data.message}`);
      fetchEvents();
      fetchDbStatus();
    } catch (error: any) {
      console.error("Import failed", error);
      setImportMessage(`❌ Import failed: ${error.response?.data?.detail || error.message}`);
    } finally {
      setImporting(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  // Helper to normalize ID access (backend might return id or event_id)
  const getEventId = (ev: Event) => ev.id || ev.event_id || "";
  const getEventName = (ev: Event) => ev.name || ev.event_name || "Unnamed Event";
  const getPreviewImageUrl = (ev: Event) => `${apiUrl}/events/${getEventId(ev)}/preview-image?t=${previewRefreshKey}`;

  const copyShareLink = () => {
    if (!selectedEvent) return;
    const link = `${window.location.origin}/event/${encodeURIComponent(getEventId(selectedEvent))}`;
    navigator.clipboard.writeText(link);
    alert("Link copied to clipboard: " + link);
  };

  if (!isAuthenticated) {
    return (
      <main className="min-h-screen bg-slate-50 flex items-center justify-center font-sans p-6">
        <div className="bg-white p-8 rounded-2xl shadow-xl border border-slate-100 max-w-md w-full">
          <h2 className="text-2xl font-bold text-center mb-6 text-slate-900">Admin Login</h2>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              axios.get(`${apiUrl}/admin/db-status`, { headers: { "X-API-Key": password } })
                .then(() => {
                  setIsAuthenticated(true);
                })
                .catch((error) => {
                  console.error("Login error:", error);
                  if (error.response?.status === 403) {
                    alert("Incorrect password");
                  } else {
                    alert("Connection error. Check the browser console for details.");
                  }
                });
            }}
            className="space-y-4"
          >
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Password</label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-indigo-500 focus:outline-none"
                placeholder="Enter admin password"
                autoFocus
              />
            </div>
            <button
              type="submit"
              className="w-full bg-indigo-600 text-white px-6 py-3 rounded-xl font-bold hover:bg-indigo-700 transition-all shadow-lg shadow-indigo-200"
            >
              Login
            </button>
            <div className="text-center mt-4">
              <Link href="/" className="text-sm text-slate-500 hover:text-slate-700">Back to Guest View</Link>
            </div>
          </form>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-slate-50 text-slate-800 font-sans">
      <header className="bg-white py-6 border-b border-slate-200">
        <div className="max-w-6xl mx-auto px-6 flex justify-between items-center">
          <div className="flex items-center gap-4">
            <h1 className="text-2xl font-serif font-bold text-slate-900">Admin Dashboard</h1>
            {selectedEvent && (
              <>
                <span className="text-slate-300">/</span>
                <span className="font-medium text-indigo-600">{getEventName(selectedEvent)}</span>
              </>
            )}
          </div>
          <div className="flex items-center gap-2">
            <button
                      onClick={() => {
                        setIsAuthenticated(false);
                        setPassword("");
                      }}
              className="px-4 py-2 text-sm text-red-500 hover:bg-red-50 rounded-full transition-colors"
            >
              Logout
            </button>
            <Link href="/" className="px-4 py-2 text-sm text-slate-500 hover:bg-slate-100 rounded-full transition-colors">
              Back to Guest View
            </Link>
          </div>
        </div>
      </header>

      <div className="max-w-6xl mx-auto p-6">
        {!selectedEvent ? (
          // VIEW: EVENTS LIST
          <div className="space-y-8">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
              <div className="md:col-span-2 space-y-6">
                <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-6">
                  <div className="flex items-center justify-between mb-4">
                    <h2 className="text-lg font-semibold">Your Events</h2>
                    <button
                      onClick={fetchEvents}
                      className="text-sm text-indigo-600 hover:text-indigo-800 font-medium flex items-center gap-1"
                    >
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" /></svg>
                      Refresh
                    </button>
                  </div>
                  {events.length > 0 ? (
                    <div className="grid grid-cols-1 gap-4">
                      {events.map(event => (
                        <div
                          key={getEventId(event)}
                          onClick={() => setSelectedEvent(event)}
                          className="p-4 bg-slate-50 rounded-xl border border-slate-100 hover:border-indigo-300 hover:bg-indigo-50 cursor-pointer transition-all flex justify-between items-center group"
                        >
                          <div>
                            <p className="font-medium text-slate-800 text-lg">{getEventName(event)}</p>
                            <p className="text-slate-400 font-mono text-xs">ID: {getEventId(event)}</p>
                          </div>
                          <span className="text-indigo-600 opacity-0 group-hover:opacity-100 font-medium text-sm transition-opacity">Manage &rarr;</span>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="text-slate-400 text-sm">No events found. Create one to get started.</p>
                  )}
                </div>
              </div>

              <div className="md:col-span-1 space-y-6">
                <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-6">
                  <h2 className="text-lg font-semibold mb-4">Create New Event</h2>
                  <div className="flex flex-col gap-3">
                    <input
                      type="text"
                      value={newEventName}
                      onChange={(e) => setNewEventName(e.target.value)}
                      placeholder="e.g., Rohan & Priya's Wedding"
                      className="w-full px-3 py-2 bg-slate-50 border border-slate-200 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:outline-none"
                    />
                    <button
                      type="button"
                      onClick={handleCreateEvent}
                      className="w-full bg-indigo-600 text-white px-4 py-2 rounded-lg font-semibold hover:bg-indigo-700 transition-colors shadow-sm"
                    >
                      Create Event
                    </button>
                  </div>
                </div>

                {statusMessage && (
                  <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-4">
                    <div className="text-center text-sm text-slate-600 bg-slate-100 p-3 rounded-lg">
                      {statusMessage}
                    </div>
                  </div>
                )}

                <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-6">
                  <h2 className="text-lg font-semibold mb-4 text-red-600">Danger Zone</h2>
                  <button
                    onClick={handleReset}
                    disabled={reseting}
                    className="w-full bg-red-50 text-red-600 border border-red-200 px-4 py-2.5 rounded-lg font-semibold hover:bg-red-100 hover:border-red-300 transition-all flex items-center justify-center gap-2 disabled:opacity-50"
                  >
                    {reseting ? (
                      <>
                        <svg className="animate-spin h-4 w-4 text-red-600" viewBox="0 0 24 24">
                          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none"></circle>
                          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                        </svg>
                        Resetting...
                      </>
                    ) : (
                      "Reset All Data"
                    )}
                  </button>
                  <p className="text-xs text-slate-400 mt-2">This will delete all events, photos, and indexed faces from the database.</p>
                </div>
              </div>
            </div>

            {/* ==================== DATABASE MANAGEMENT SECTION ==================== */}
            <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-6">
              <div className="flex items-center justify-between mb-6">
                <h2 className="text-lg font-semibold flex items-center gap-2">
                  <svg className="w-5 h-5 text-indigo-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 7v10c0 2.21 3.582 4 8 4s8-1.79 8-4V7M4 7c0 2.21 3.582 4 8 4s8-1.79 8-4M4 7c0-2.21 3.582-4 8-4s8 1.79 8 4m0 5c0 2.21-3.582 4-8 4s-8-1.79-8-4" /></svg>
                  Database Management
                </h2>
                <button
                  onClick={fetchDbStatus}
                  disabled={dbLoading}
                  className="text-sm text-indigo-600 hover:text-indigo-800 font-medium disabled:text-slate-400 flex items-center gap-1"
                >
                  <svg className={`w-4 h-4 ${dbLoading ? "animate-spin" : ""}`} fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" /></svg>
                  Refresh
                </button>
              </div>

              {/* Status Overview Cards */}
              {dbSummary && (
                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-4 mb-6">
                  <div className="bg-slate-50 rounded-xl p-4 border border-slate-100 text-center">
                    <p className="text-2xl font-bold text-slate-800">{dbSummary.total_events}</p>
                    <p className="text-xs text-slate-500 font-medium mt-1">Events</p>
                  </div>
                  <div className="bg-slate-50 rounded-xl p-4 border border-slate-100 text-center">
                    <p className="text-2xl font-bold text-slate-800">{dbSummary.total_photos}</p>
                    <p className="text-xs text-slate-500 font-medium mt-1">Total Photos</p>
                  </div>
                  <div className="bg-amber-50 rounded-xl p-4 border border-amber-100 text-center">
                    <p className="text-2xl font-bold text-amber-600">{dbSummary.pending}</p>
                    <p className="text-xs text-amber-600 font-medium mt-1">Pending</p>
                  </div>
                  <div className="bg-emerald-50 rounded-xl p-4 border border-emerald-100 text-center">
                    <p className="text-2xl font-bold text-emerald-600">{dbSummary.completed}</p>
                    <p className="text-xs text-emerald-600 font-medium mt-1">Completed</p>
                  </div>
                  <div className="bg-red-50 rounded-xl p-4 border border-red-100 text-center">
                    <p className="text-2xl font-bold text-red-600">{dbSummary.failed}</p>
                    <p className="text-xs text-red-600 font-medium mt-1">Failed</p>
                  </div>
                  <div className="bg-indigo-50 rounded-xl p-4 border border-indigo-100 text-center">
                    <p className="text-2xl font-bold text-indigo-600">{dbSummary.total_faces}</p>
                    <p className="text-xs text-indigo-600 font-medium mt-1">Faces Indexed</p>
                  </div>
                </div>
              )}

              {/* Export / Import Buttons */}
              <div className="flex flex-col sm:flex-row gap-4 mb-6">
                <button
                  onClick={handleExportDb}
                  disabled={exporting}
                  className="flex-1 bg-emerald-600 text-white px-4 py-3 rounded-xl font-semibold hover:bg-emerald-700 transition-all shadow-sm flex items-center justify-center gap-2 disabled:opacity-50"
                >
                  {exporting ? (
                    <>
                      <svg className="animate-spin h-5 w-5 text-white" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none"></circle>
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                      </svg>
                      Exporting...
                    </>
                  ) : (
                    <>
                      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" /></svg>
                      Export Database (Backup)
                    </>
                  )}
                </button>
                <label className="flex-1">
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept=".json"
                    onChange={handleImportDb}
                    className="hidden"
                    disabled={importing}
                  />
                  <div className={`w-full px-4 py-3 rounded-xl font-semibold transition-all shadow-sm flex items-center justify-center gap-2 cursor-pointer ${importing ? "bg-slate-200 text-slate-400" : "bg-blue-600 text-white hover:bg-blue-700"}`}>
                    {importing ? (
                      <>
                        <svg className="animate-spin h-5 w-5 text-white" viewBox="0 0 24 24">
                          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none"></circle>
                          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                        </svg>
                        Importing...
                      </>
                    ) : (
                      <>
                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" /></svg>
                        Import Database (Restore)
                      </>
                    )}
                  </div>
                </label>
              </div>

              {/* Retry Stuck Photos Button */}
              {dbSummary && (dbSummary.pending > 0 || dbSummary.failed > 0) && (
                <div className="flex mb-6 animate-in fade-in zoom-in duration-300">
                  <button onClick={handleRetryPending} disabled={dbLoading} className="w-full bg-amber-100 text-amber-800 hover:bg-amber-200 border border-amber-200 px-4 py-3 rounded-xl font-semibold transition-all shadow-sm flex items-center justify-center gap-2">
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" /></svg>
                    Retry {dbSummary.pending + dbSummary.failed} Stuck/Failed Photos
                  </button>
                </div>
              )}

              {importMessage && (
                <div className={`text-center text-sm p-3 rounded-lg mb-6 ${importMessage.startsWith("✅") ? "bg-emerald-50 text-emerald-700" : importMessage.startsWith("❌") ? "bg-red-50 text-red-700" : "bg-blue-50 text-blue-700"}`}>
                  {importMessage}
                </div>
              )}
            </div>

            {/* ==================== VISITORS TRACKING SECTION ==================== */}
            <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-6">
              <div className="flex items-center justify-between mb-6">
                <h2 className="text-lg font-semibold flex items-center gap-2">
                  <svg className="w-5 h-5 text-indigo-600" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" /></svg>
                  Live Visitors & Access Logs
                </h2>
                <div className="flex items-center gap-2">
                  <button
                    onClick={fetchVisitors}
                    className="text-sm text-indigo-600 hover:text-indigo-800 font-medium flex items-center gap-1 px-3 py-1.5"
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" /></svg>
                    Refresh
                  </button>
                  <button
                    onClick={() => setShowVisitors(!showVisitors)}
                    className="text-sm bg-slate-100 hover:bg-slate-200 text-slate-700 px-3 py-1.5 rounded-lg font-medium transition-colors"
                  >
                    {showVisitors ? "Hide Logs" : "Show Logs"}
                  </button>
                </div>
              </div>

              {showVisitors && (
                <div className="animate-in fade-in duration-300">
                  <div className="flex gap-4 mb-4">
                    <div className="bg-emerald-50 text-emerald-700 px-4 py-2 rounded-lg text-sm font-semibold flex items-center gap-2 border border-emerald-100">
                      <span className="relative flex h-3 w-3">
                        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                        <span className="relative inline-flex rounded-full h-3 w-3 bg-emerald-500"></span>
                      </span>
                      Active Now: {visitors.filter(v => v.is_active).length}
                    </div>
                    <div className="bg-slate-50 text-slate-700 px-4 py-2 rounded-lg text-sm font-semibold border border-slate-200">
                      Total Unique IPs: {visitors.length}
                    </div>
                  </div>

                  <div className="overflow-x-auto rounded-xl border border-slate-200">
                    <table className="w-full text-left text-sm text-slate-600">
                      <thead className="bg-slate-50 text-slate-700 font-medium border-b border-slate-200">
                        <tr>
                          <th className="px-4 py-3">Status</th>
                          <th className="px-4 py-3">Event</th>
                          <th className="px-4 py-3">IP Address</th>
                          <th className="px-4 py-3">Last Active</th>
                          <th className="px-4 py-3">Device / Browser</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {visitors.length === 0 ? (
                          <tr><td colSpan={5} className="px-4 py-8 text-center text-slate-400">No visitors logged yet.</td></tr>
                        ) : (
                          visitors.map(v => (
                            <tr key={v.id} className="hover:bg-slate-50 transition-colors">
                              <td className="px-4 py-3">
                                {v.is_active ? (
                                  <span className="inline-flex items-center gap-1.5 px-2 py-1 rounded-md bg-emerald-100 text-emerald-700 text-xs font-semibold">Online</span>
                                ) : (
                                  <span className="inline-flex items-center gap-1.5 px-2 py-1 rounded-md bg-slate-100 text-slate-500 text-xs font-semibold">Offline</span>
                                )}
                              </td>
                              <td className="px-4 py-3 font-medium">{v.event_name}</td>
                              <td className="px-4 py-3 font-mono text-xs text-slate-500">{v.ip_address}</td>
                              <td className="px-4 py-3 whitespace-nowrap">{new Date(v.last_seen).toLocaleString()}</td>
                              <td className="px-4 py-3 text-xs truncate max-w-[200px]" title={v.user_agent}>{v.user_agent || "Unknown"}</td>
                            </tr>
                          ))
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>
          </div>
        ) : (
          // VIEW: EVENT DETAILS
          <div className="space-y-8">
            {/* Toolbar */}
            <div className="flex flex-col sm:flex-row gap-4 justify-between items-start sm:items-center">
              <button
                onClick={() => setSelectedEvent(null)}
                className="text-slate-500 hover:text-slate-800 flex items-center gap-2 transition-colors"
              >
                &larr; Back to Events
              </button>
              <button
                onClick={copyShareLink}
                className="bg-indigo-50 text-indigo-700 border border-indigo-200 px-4 py-2 rounded-lg font-semibold hover:bg-indigo-100 transition-colors flex items-center gap-2"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.368 2.684 3 3 0 00-5.368-2.684z"></path></svg>
                Copy Guest Link
              </button>
            </div>

            {/* Sync Area */}
            <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-6">
              <h2 className="text-lg font-semibold mb-4">Share Preview Image</h2>
              <p className="text-sm text-slate-500 mb-4">Upload the image that should appear when this event link is shared.</p>

              {selectedEvent?.preview_image_path ? (
                <div className="mb-4 rounded-xl border border-slate-200 overflow-hidden bg-slate-50">
                  <img
                    src={getPreviewImageUrl(selectedEvent)}
                    alt={`${getEventName(selectedEvent)} preview`}
                    className="w-full max-h-72 object-cover"
                  />
                </div>
              ) : (
                <div className="mb-4 p-4 rounded-xl border border-dashed border-slate-300 text-sm text-slate-500 bg-slate-50">
                  No custom preview image yet. The default sharing image will be used.
                </div>
              )}

              <label className="inline-flex items-center gap-2 cursor-pointer bg-indigo-600 text-white px-4 py-2 rounded-lg hover:bg-indigo-700 transition-colors font-semibold">
                <input
                  type="file"
                  accept="image/*"
                  onChange={handlePreviewImageUpload}
                  className="hidden"
                  disabled={previewUploading}
                />
                {previewUploading ? "Uploading..." : "Upload Preview Image"}
              </label>
            </div>

            {/* Sync Area */}
            <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-6">
              <h2 className="text-lg font-semibold mb-4">Sync from Google Drive</h2>
              <div className="flex flex-col gap-4">
                <p className="text-sm text-slate-500">Paste a Google Drive Folder Link to automatically import all images.</p>
                <input
                  type="text"
                  value={folderUrl}
                  onChange={(e) => setFolderUrl(e.target.value)}
                  placeholder="https://drive.google.com/drive/folders/..."
                  className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-indigo-500 focus:outline-none"
                  disabled={syncing}
                />

                <button
                  onClick={handleSyncDrive}
                  disabled={!folderUrl.trim() || syncing}
                  className="w-full bg-indigo-600 text-white px-6 py-3 rounded-xl hover:bg-indigo-700 disabled:bg-slate-200 disabled:text-slate-400 font-semibold transition-all shadow-sm active:scale-95"
                >
                  {syncing ? "Sync in Progress..." : "Sync Folder"}
                </button>
              </div>

              {syncProgress.active && syncProgress.total > 0 && (
                <div className="mt-6">
                  <div className="flex justify-between text-sm text-slate-600 mb-2 font-medium">
                    <span>Importing Photos...</span>
                    <span>{syncProgress.current} / {syncProgress.total}</span>
                  </div>
                  <div className="w-full bg-slate-100 rounded-full h-3">
                    <div
                      className="bg-indigo-600 h-3 rounded-full transition-all duration-300 ease-out"
                      style={{ width: `${Math.min(100, (syncProgress.current / syncProgress.total) * 100)}%` }}
                    ></div>
                  </div>
                </div>
              )}

              {statusMessage && (
                <div className="mt-4 text-center text-sm text-slate-600 bg-slate-100 p-3 rounded-lg">
                  {statusMessage}
                </div>
              )}
            </div>

            {/* Photos Grid */}
            <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-6">
              <h2 className="text-lg font-semibold mb-4">Event Photos ({eventPhotos.length})</h2>
              {eventPhotos.length === 0 ? (
                <p className="text-slate-400 text-sm text-center py-8">No photos uploaded yet.</p>
              ) : (
                <div className="flex flex-col gap-2 max-h-[500px] overflow-y-auto pr-2">
                  {eventPhotos.map((photo) => (
                    <div key={photo.photo_id} className="flex items-center justify-between bg-slate-50 p-3 rounded-xl border border-slate-100 hover:border-slate-300 transition-colors">
                      <div className="flex items-center gap-3 overflow-hidden">
                        <svg className="w-5 h-5 text-slate-400 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"></path></svg>
                        <span className="text-sm font-mono text-slate-600 truncate" title={photo.file_path}>
                          {photo.file_path.split('/').pop() || `Photo ID: ${photo.photo_id}`}
                        </span>
                      </div>
                      <button
                        onClick={() => handleDeletePhoto(photo.photo_id)}
                        className="text-slate-400 hover:text-red-600 p-2 rounded-lg hover:bg-red-50 transition-colors shrink-0"
                        title="Delete Photo"
                      >
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"></path></svg>
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </main>
  );
}
