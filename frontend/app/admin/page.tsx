"use client";

import { useState } from "react";
import axios from "axios";
import Link from "next/link";

export default function AdminPage() {
  const [eventName, setEventName] = useState("");
  const [eventId, setEventId] = useState<string>("");
  const [uploadStatus, setUploadStatus] = useState("");
  const [isUploading, setIsUploading] = useState(false);
  const [error, setError] = useState("");
  const [progress, setProgress] = useState(0);

  // 1. Create Event
  const handleCreateEvent = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    try {
      // Proxy request: /api/events -> Backend: /events/
      const res = await axios.post("/api/events/", {
        event_name: eventName,
        event_date: new Date().toISOString(),
      });
      setEventId(res.data.event_id);
      setEventName(""); // Clear input on success
    } catch (err: any) {
      console.error(err);
      setError(err.response?.data?.detail || "Failed to create event. Is the backend running?");
    }
  };

  // 2. Upload Photos
  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!e.target.files || !eventId) return;
    
    setIsUploading(true);
    setUploadStatus("Uploading...");
    setProgress(0);
    setError("");

    const formData = new FormData();
    // Add all selected files
    Array.from(e.target.files).forEach((file) => {
      formData.append("files", file);
    });

    try {
      // Direct upload to backend to bypass Next.js proxy body limits for large files
      // Use localhost:8000 which is exposed by Docker
      const res = await axios.post(`http://localhost:8000/events/${eventId}/upload`, formData, {
        onUploadProgress: (progressEvent) => {
          // Calculate percentage safely
          const total = progressEvent.total || progressEvent.loaded;
          const percentCompleted = Math.round((progressEvent.loaded * 100) / total);
          setProgress(percentCompleted);
        },
      });
      setUploadStatus(`Success! Uploaded ${res.data.photo_ids.length} photos.`);
      // Ensure we hit 100% on success even if progress events lagged
      setProgress(100);
    } catch (err: any) {
      console.error(err);
      setUploadStatus("Upload failed.");
      setError(err.response?.data?.detail || "Error uploading photos.");
    } finally {
      setIsUploading(false);
    }
  };

  return (
    <main className="min-h-screen bg-slate-50 text-slate-900">
      {/* Header */}
      <div className="bg-white shadow-sm border-b border-slate-200 px-6 py-4 flex justify-between items-center">
        <h1 className="text-xl font-bold text-slate-800">Wedding AI Admin</h1>
        <Link href="/" className="text-sm font-medium text-indigo-600 hover:text-indigo-500">
          &larr; Back to Home
        </Link>
      </div>

      <div className="max-w-3xl mx-auto p-8">
        {error && (
          <div className="mb-6 p-4 bg-red-50 border border-red-200 text-red-700 rounded-lg">
            {error}
          </div>
        )}

        <div className="grid gap-8">
          {/* Card 1: Create Event */}
          <section className="bg-white p-6 rounded-xl shadow-sm border border-slate-200">
            <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
              <span className="bg-indigo-100 text-indigo-700 w-6 h-6 rounded-full flex items-center justify-center text-xs">1</span>
              Create New Event
            </h2>
            <form onSubmit={handleCreateEvent} className="flex gap-3">
              <input
                type="text"
                placeholder="Event Name (e.g. Rohan Wedding)"
                className="flex-1 px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:outline-none"
                value={eventName}
                onChange={(e) => setEventName(e.target.value)}
                required
              />
              <button type="submit" className="bg-indigo-600 text-white px-6 py-2 rounded-lg hover:bg-indigo-700 font-medium transition-colors">
                Create Event
              </button>
            </form>
            {eventId && (
              <div className="mt-4 p-3 bg-green-50 text-green-700 rounded-lg border border-green-200">
                ✅ Event Active! ID: <strong>{eventId}</strong>
              </div>
            )}
          </section>

          {/* Card 2: Upload Photos */}
          <section className={`bg-white p-6 rounded-xl shadow-sm border border-slate-200 transition-opacity ${!eventId ? "opacity-50 pointer-events-none grayscale" : ""}`}>
            <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
              <span className="bg-indigo-100 text-indigo-700 w-6 h-6 rounded-full flex items-center justify-center text-xs">2</span>
              Upload Photos
            </h2>
            <p className="mb-4 text-sm text-slate-500">
              Select folder containing all raw photos for <strong>Event #{eventId}</strong>.
            </p>
            
            <label className="block w-full cursor-pointer">
              <input
                type="file"
                multiple
                accept="image/*"
                onChange={handleUpload}
                className="block w-full text-sm text-slate-500
                  file:mr-4 file:py-2.5 file:px-4
                  file:rounded-full file:border-0
                  file:text-sm file:font-semibold
                  file:bg-indigo-50 file:text-indigo-700
                  hover:file:bg-indigo-100
                  cursor-pointer"
              />
            </label>
            
            {isUploading && (
              <div className="mt-4 space-y-2">
                <div className="flex items-center gap-2 text-indigo-600">
                  <svg className="animate-spin h-5 w-5" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none"></circle>
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                  </svg>
                  <span className="font-medium">{uploadStatus} {progress}%</span>
                </div>
                <div className="w-full bg-gray-200 rounded-full h-2.5">
                  <div className="bg-indigo-600 h-2.5 rounded-full transition-all duration-300" style={{ width: `${progress}%` }}></div>
                </div>
              </div>
            )}
            {!isUploading && uploadStatus && (
              <p className="mt-4 text-green-600 font-medium flex items-center gap-2">
                ✅ {uploadStatus}
              </p>
            )}
          </section>
        </div>
      </div>
    </main>
  );
}