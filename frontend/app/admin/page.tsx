"use client";

import { useState, useEffect, useCallback } from "react";
import axios from "axios";
import Link from "next/link";

interface Event {
  id: string;
  name: string;
  event_name?: string; // Handle potentially different backend mapping
  event_id?: string;
}

interface Photo {
  photo_id: string;
  file_path: string;
}

export default function AdminPage() {
  const [events, setEvents] = useState<Event[]>([]);
  const [newEventName, setNewEventName] = useState("");
  const [selectedEvent, setSelectedEvent] = useState<Event | null>(null);
  const [eventPhotos, setEventPhotos] = useState<Photo[]>([]);
  const [files, setFiles] = useState<File[]>([]);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [isDragging, setIsDragging] = useState(false);
  const [statusMessage, setStatusMessage] = useState("");

  const apiUrl = process.env.NEXT_PUBLIC_API_URL || "http://127.0.0.1:8000";

  const fetchEvents = useCallback(async () => {
    try {
      const response = await axios.get(`${apiUrl}/events`);
      setEvents(response.data);
    } catch (error) {
      console.error("Failed to fetch events", error);
      setStatusMessage("Error: Could not fetch events from the backend.");
    }
  }, [apiUrl]);

  const fetchEventPhotos = useCallback(async (eventId: string) => {
    try {
      const response = await axios.get(`${apiUrl}/events/${eventId}/photos`);
      setEventPhotos(response.data);
    } catch (error) {
      console.error("Failed to fetch photos", error);
    }
  }, [apiUrl]);

  useEffect(() => {
    if (selectedEvent) {
      fetchEventPhotos(getEventId(selectedEvent));
    }
  }, [selectedEvent, fetchEventPhotos]);

  useEffect(() => {
    fetchEvents();
  }, [fetchEvents]);

  const handleCreateEvent = async () => {
    if (!newEventName.trim()) return;
    try {
      setStatusMessage("Creating event...");
      const response = await axios.post(`${apiUrl}/events`, { event_name: newEventName });
      setStatusMessage(`Event "${response.data.event_name || response.data.name}" created.`);
      setNewEventName("");
      fetchEvents(); // Refresh the list
    } catch (error) {
      console.error("Failed to create event", error);
      setStatusMessage("Error: Failed to create event.");
    }
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      setFiles(Array.from(e.target.files));
    }
  };

  const handleUpload = async () => {
    if (files.length === 0 || !selectedEvent) return;

    setUploading(true);
    setUploadProgress(0);
    setStatusMessage(`Uploading ${files.length} photos...`);

    const formData = new FormData();
    files.forEach(file => {
      formData.append("files", file);
    });

    try {
      // Use the correct endpoint matching backend
      await axios.post(`${apiUrl}/events/${getEventId(selectedEvent)}/upload`, formData, {
        onUploadProgress: (progressEvent) => {
          const total = progressEvent.total || progressEvent.loaded;
          const percentCompleted = Math.round((progressEvent.loaded * 100) / total);
          setUploadProgress(percentCompleted);
        },
      });
      setStatusMessage(`Successfully uploaded ${files.length} photos. They are now being indexed in the background.`);
      setFiles([]);
      fetchEventPhotos(getEventId(selectedEvent));
    } catch (error) {
      console.error("Upload failed", error);
      setStatusMessage("Error: Upload failed. Please check the console.");
    } finally {
      setUploading(false);
    }
  };

  const handleDeletePhoto = async (photoId: string) => {
    if (!confirm("Are you sure you want to delete this photo?")) return;
    try {
      await axios.delete(`${apiUrl}/photos/${photoId}`);
      setEventPhotos(prev => prev.filter(p => p.photo_id !== photoId));
    } catch (error) {
      console.error("Delete failed", error);
      alert("Failed to delete photo");
    }
  };

  const handleReset = async () => {
    if (window.confirm("Are you sure you want to reset all data? This cannot be undone.")) {
      try {
        setStatusMessage("Resetting database...");
        await axios.delete(`${apiUrl}/reset`);
        setStatusMessage("Database has been reset.");
        fetchEvents();
      } catch (error) {
        console.error("Reset failed", error);
        setStatusMessage("Error: Failed to reset database.");
      }
    }
  };

  // Drag and drop handlers
  const handleDragOver = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragging(false);
  };

  const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragging(false);
    if (e.dataTransfer.files) {
      setFiles(Array.from(e.dataTransfer.files));
      setStatusMessage(`${e.dataTransfer.files.length} files selected.`);
    }
  };

  // Helper to normalize ID access (backend might return id or event_id)
  const getEventId = (ev: Event) => ev.id || ev.event_id || "";
  const getEventName = (ev: Event) => ev.name || ev.event_name || "Unnamed Event";

  const copyShareLink = () => {
    if (!selectedEvent) return;
    const link = `${window.location.origin}/?eventCode=${getEventId(selectedEvent)}`;
    navigator.clipboard.writeText(link);
    alert("Link copied to clipboard: " + link);
  };

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
          <Link href="/" className="px-4 py-2 text-sm text-slate-500 hover:bg-slate-100 rounded-full transition-colors">
            Back to Guest View
          </Link>
        </div>
      </header>

      <div className="max-w-6xl mx-auto p-6">
        {!selectedEvent ? (
          // VIEW: EVENTS LIST
          <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
            <div className="md:col-span-2 space-y-6">
              <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-6">
                <h2 className="text-lg font-semibold mb-4">Your Events</h2>
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
                  className="w-full bg-red-50 text-red-600 border border-red-200 px-4 py-2 rounded-lg font-semibold hover:bg-red-100 hover:border-red-300 transition-colors"
                >
                  Reset All Data
                </button>
                <p className="text-xs text-slate-400 mt-2">This will delete all events, photos, and indexed faces from the database.</p>
              </div>
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

            {/* Upload Area */}
            <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-6">
            <h2 className="text-lg font-semibold mb-4">Upload Photos</h2>
            <div 
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onDrop={handleDrop}
              className={`border-2 border-dashed rounded-xl p-8 text-center transition-colors ${isDragging ? 'border-indigo-500 bg-indigo-50' : 'border-slate-200 bg-slate-50'}`}
            >
              <p className="text-slate-500 mb-4">Drag & drop photos here, or click to select files.</p>
              <input
                type="file"
                multiple
                onChange={handleFileSelect}
                className="hidden"
                id="file-upload"
              />
              <label htmlFor="file-upload" className="cursor-pointer bg-white text-slate-600 px-4 py-2 rounded-lg border border-slate-300 hover:bg-slate-50 font-semibold">
                Select Files
              </label>
            </div>

            {files.length > 0 && (
              <div className="mt-6">
                <h3 className="text-md font-medium mb-2">{files.length} file(s) selected:</h3>
                <ul className="text-sm text-slate-500 list-disc list-inside max-h-40 overflow-y-auto bg-slate-50 p-3 rounded-lg">
                  {files.map((file, i) => <li key={i} className="truncate">{file.name}</li>)}
                </ul>
              </div>
            )}

            <div className="mt-6">
              <button
                onClick={handleUpload}
                disabled={files.length === 0 || uploading}
                className="w-full bg-indigo-600 text-white px-6 py-3 rounded-xl hover:bg-indigo-700 disabled:bg-slate-200 disabled:text-slate-400 font-semibold transition-all shadow-sm active:scale-95"
              >
                {uploading ? `Uploading... ${uploadProgress}%` : `Upload ${files.length} Photos`}
              </button>
            </div>

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
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4">
                {eventPhotos.map((photo) => (
                  <div key={photo.photo_id} className="relative group aspect-square rounded-lg overflow-hidden bg-slate-100">
                    <img 
                      src={`${apiUrl}${photo.file_path}`} 
                      alt="Event photo" 
                      className="w-full h-full object-cover"
                      loading="lazy"
                    />
                    <button
                      onClick={() => handleDeletePhoto(photo.photo_id)}
                      className="absolute top-2 right-2 bg-red-600 text-white p-1.5 rounded-full opacity-0 group-hover:opacity-100 transition-opacity hover:bg-red-700 shadow-sm"
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