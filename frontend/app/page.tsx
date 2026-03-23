"use client";

import { useState, useEffect } from "react";
import axios from "axios";
import Link from "next/link";

type ViewState = "login" | "search" | "results";

export default function Home() {
  // App State
  const [view, setView] = useState<ViewState>("login");

  // Login State
  const [eventCode, setEventCode] = useState("");
  const [checkingEvent, setCheckingEvent] = useState(false);

  // Search State
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);

  // Results State
  const [results, setResults] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [searchError, setSearchError] = useState<string | null>(null);

  // Selection State
  const [selectedPhotos, setSelectedPhotos] = useState<Set<number>>(new Set());
  const [isSelectMode, setIsSelectMode] = useState(false);
  const [isDownloading, setIsDownloading] = useState(false);
  const [downloadProgress, setDownloadProgress] = useState({ current: 0, total: 0 });
  const apiUrl = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

  useEffect(() => {
    if (typeof window === "undefined") return;
    const params = new URLSearchParams(window.location.search);
    const code = params.get("eventCode");
    if (code) {
      setEventCode(code);
      validateAndEnter(code);
    }
  }, []);

  // --- Visitor Tracking Hook ---
  useEffect(() => {
    if (view !== "login" && eventCode) {
      // Initial check-in when entering the event
      axios.post(`${apiUrl}/events/${eventCode}/visit`).catch(() => {});
      
      // Ping every 1 minute to keep session "Active"
      const interval = setInterval(() => {
        axios.post(`${apiUrl}/events/${eventCode}/visit`).catch(() => {});
      }, 60000);
      
      return () => clearInterval(interval);
    }
  }, [view, eventCode, apiUrl]);

  // --- Login Handlers ---

  const validateAndEnter = async (code: string) => {
    setCheckingEvent(true);
    try {
      await axios.get(`${apiUrl}/events/${code}`);
      setView("search");
    } catch (error) {
      console.error(error);
      // Stay on login page if invalid
    } finally {
      setCheckingEvent(false);
    }
  };

  const handleLogin = async () => {
    if (!eventCode) return alert("Please enter an Event Code");

    setCheckingEvent(true);
    // Validate Event Code against Backend
    try {
      await axios.get(`${apiUrl}/events/${eventCode}`);
      setView("search");
    } catch (error) {
      console.error(error);
      alert("Invalid Event Code. Please check and try again.");
    } finally {
      setCheckingEvent(false);
    }
  };

  // Download Multiple Photos Function
  const downloadPhotos = async (photosToDownload: any[]) => {
    if (photosToDownload.length === 0) return;

    if (photosToDownload.length === 1) {
      setIsDownloading(true);
      try {
        const photo = photosToDownload[0];
        const response = await fetch(`${apiUrl}${photo.download_url}`);
        if (!response.ok) throw new Error("Network response was not ok");

        const arrayBuffer = await response.arrayBuffer();
        const blob = new Blob([arrayBuffer], { type: "image/jpeg" });

        const url = window.URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.style.display = "none";
        a.href = url;
        a.download = `photo_${photo.photo_id}.jpg`;
        document.body.appendChild(a);
        a.click();

        setTimeout(() => {
          if (document.body.contains(a)) document.body.removeChild(a);
          window.URL.revokeObjectURL(url);
        }, 1000);
      } catch (error) {
        console.error("Failed to download photo", error);
      } finally {
        setIsDownloading(false);
      }
      return;
    }

    setIsDownloading(true);
    setDownloadProgress({ current: 0, total: photosToDownload.length });

    try {
      const photoIds = photosToDownload.map((p) => p.photo_id).join(",");
      const downloadUrl = `${apiUrl}/events/${eventCode}/download-zip?photo_ids=${photoIds}`;

      // Stream directly to the browser's download manager instead of buffering in memory
      const a = document.createElement("a");
      a.style.display = "none";
      a.href = downloadUrl;
      a.download = `memories_${eventCode}.zip`; // Content-Disposition handles the name too
      document.body.appendChild(a);
      a.click();

      setTimeout(() => {
        if (document.body.contains(a)) document.body.removeChild(a);
      }, 3000);
    } catch (error) {
      console.error("Failed to download zip", error);
      alert("Failed to download multiple photos. Please try again.");
    } finally {
      // Small delay after last one before resetting UI
      await new Promise(resolve => setTimeout(resolve, 800));
      setIsDownloading(false);
      setDownloadProgress({ current: 0, total: 0 });
    }
  };


  // --- Camera/File Handlers ---

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      const file = e.target.files[0];
      setSelectedFile(file);
      setPreview(URL.createObjectURL(file));
    }
  };

  const handleSearch = async () => {
    if (!selectedFile) return;

    setLoading(true);
    setResults([]);
    setProgress(0);
    setSearchError(null);
    setSelectedPhotos(new Set());
    setIsSelectMode(false);

    const formData = new FormData();
    formData.append("file", selectedFile);
    formData.append("event_id", eventCode);

    try {
      // Post directly to the backend to bypass the Next.js proxy, which can time out
      // or have issues with file uploads.
      const response = await axios.post(`${apiUrl}/search`, formData, {
        onUploadProgress: (progressEvent) => {
          const total = progressEvent.total || progressEvent.loaded;
          const percentCompleted = Math.round((progressEvent.loaded * 100) / total);
          setProgress(percentCompleted);
        },
      });
      setResults(response.data.matches);
      setView("results");
    } catch (error: any) {
      console.error("Search failed", error);
      const errorMsg = error.response?.data?.detail || "Search failed. Please try again.";
      setSearchError(errorMsg);
    } finally {
      setLoading(false);
    }
  };

  // Helper to resolve backend drive ID to Google Drive URL
  const getDriveThumbUrl = (id: string) => `https://drive.google.com/thumbnail?id=&sz=w600`;
  const getDriveFullUrl = (id: string) => `https://drive.google.com/uc?id=`;

  return (
    <main className="min-h-screen bg-slate-50 text-slate-800 font-sans">
      {/* Hero Header */}
      <header className="bg-white/80 backdrop-blur-md sticky top-0 z-10 border-b border-slate-200">
        <div className="max-w-6xl mx-auto px-4 h-16 flex justify-between items-center">
          <h1 className="text-2xl font-serif font-bold text-slate-900">Wedding Memories</h1>
          {view !== "login" && (
            <div className="flex items-center gap-4">
              <span className="text-sm font-medium text-slate-600 hidden sm:block">Event: {eventCode}</span>
              <button
                onClick={() => {
                  setView("login");
                  window.history.pushState({}, '', '/');
                }}
                className="text-sm text-red-500 hover:bg-red-50 px-3 py-1 rounded-full transition-colors"
              >
                Leave Event
              </button>
            </div>
          )}
        </div>
      </header>

      <div className="max-w-4xl mx-auto p-6">

        {/* VIEW: LOGIN */}
        {view === "login" && (
          <div className="max-w-md mx-auto bg-white rounded-2xl shadow-xl border border-slate-100 p-8 animate-fade-in">
            <h2 className="text-2xl font-semibold mb-6 text-center">Join Event</h2>

            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Event Code</label>
                <input
                  type="text"
                  value={eventCode}
                  onChange={(e: any) => setEventCode(e.target.value)}
                  onKeyDown={(e: any) => e.key === 'Enter' && handleLogin()}
                  placeholder="e.g. WED2024"
                  className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl focus:ring-2 focus:ring-indigo-500 focus:outline-none"
                />
              </div>

              <button
                onClick={handleLogin}
                disabled={checkingEvent}
                className="w-full bg-indigo-600 text-white px-6 py-3 rounded-xl font-bold hover:bg-indigo-700 transition-all shadow-lg shadow-indigo-200 disabled:opacity-70 disabled:cursor-not-allowed"
              >
                {checkingEvent ? "Checking..." : "Enter Event"}
              </button>
            </div>
          </div>
        )}

        {/* VIEW: SEARCH / CAPTURE */}
        {view === "search" && (
          <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-8 text-center animate-fade-in">
            <h2 className="text-xl font-medium mb-2">Find your photos</h2>
            <p className="text-slate-500 mb-8">Upload a clear selfie to find every photo you appeared in.</p>

            <div className="flex flex-col items-center gap-6">

              {/* Preview or Webcam Area */}
              <div className="relative w-64 h-64 md:w-80 md:h-80 rounded-2xl overflow-hidden bg-slate-900 shadow-inner">
                {preview ? (
                  <img src={preview} alt="Selfie" className="w-full h-full object-cover" />
                ) : (
                  <div className="w-full h-full flex items-center justify-center text-slate-500">
                    <span className="text-sm">No Image Selected</span>
                  </div>
                )}
              </div>

              {/* Error Alert */}
              {searchError && (
                <div className="w-full max-w-sm mb-4 animate-in fade-in slide-in-from-top-2 duration-300">
                  <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-xl flex items-start gap-3 text-left">
                    <svg className="w-5 h-5 mt-0.5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                    <div className="flex-1">
                      <p className="text-sm font-semibold mb-0.5">Wait, something's not right</p>
                      <p className="text-xs opacity-90">{searchError}</p>
                    </div>
                    <button onClick={() => setSearchError(null)} className="text-red-400 hover:text-red-600 transition-colors">
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" />
                      </svg>
                    </button>
                  </div>
                </div>
              )}

              {/* Controls */}
              <div className="flex flex-col gap-3 w-full max-w-xs">

                {selectedFile ? (
                  <div className="flex gap-2">
                    <label className="flex-1 cursor-pointer bg-white border border-slate-300 text-slate-700 px-4 py-3 rounded-xl hover:bg-slate-50 font-semibold text-center">
                      Change Photo
                      <input type="file" accept="image/*" onChange={handleFileChange} className="hidden" />
                    </label>
                    <button onClick={handleSearch} disabled={loading} className="flex-1 bg-indigo-600 text-white px-4 py-3 rounded-xl hover:bg-indigo-700 font-semibold disabled:opacity-50">
                      {loading ? "Scanning..." : "Search"}
                    </button>
                  </div>
                ) : (
                  <label className="block w-full cursor-pointer bg-indigo-600 text-white px-6 py-3 rounded-xl hover:bg-indigo-700 font-semibold">
                    Upload a Photo
                    <input type="file" accept="image/*" onChange={handleFileChange} className="hidden" />
                  </label>
                )}

                {loading && (
                  <div className="w-full mt-2">
                    <div className="w-full bg-gray-200 rounded-full h-2.5">
                      <div className="bg-indigo-600 h-2.5 rounded-full transition-all duration-300" style={{ width: `${progress}%` }}></div>
                    </div>
                    <p className="text-xs text-center text-slate-500 mt-1">{progress < 100 ? `Uploading... ${progress}%` : "Analyzing faces..."}</p>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* VIEW: RESULTS */}
        {view === "results" && (
          <div className="animate-fade-in">
            {/* Header Info & New Search */}
            <div className="flex flex-col items-center text-center mb-10 gap-4">
              <button
                onClick={() => setView("search")}
                className="group flex items-center gap-2 text-sm font-semibold text-indigo-600 bg-indigo-50 px-5 py-2.5 rounded-full hover:bg-indigo-100 active:scale-95 transition-all shadow-sm"
              >
                <svg className="w-4 h-4 transform group-hover:-translate-x-1 transition-transform" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M10 19l-7-7m0 0l7-7m-7 7h18"></path></svg>
                Try another selfie
              </button>

              <div className="mt-2">
                <h2 className="text-3xl font-bold text-slate-900 tracking-tight">Your Memories</h2>
                <p className="text-slate-500 mt-1 font-medium">We found {results.length} photos you appeared in</p>
              </div>
            </div>

            {results.length > 0 && (
              <div className="flex flex-col items-center w-full max-w-2xl mx-auto px-4 mb-12">
                {isDownloading && downloadProgress.total > 1 && (
                  <div className="w-full mb-6 p-4 bg-amber-50 border border-amber-200 rounded-2xl flex items-start gap-3 shadow-sm animate-in fade-in slide-in-from-top-4 duration-500">
                    <svg className="w-5 h-5 text-amber-500 mt-0.5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg>
                    <div className="text-sm text-amber-800 leading-relaxed">
                      <p className="font-bold mb-0.5">Packaging Photos...</p>
                      <p className="opacity-90">Please wait while we compress your selected photos into a single ZIP file.</p>
                    </div>
                  </div>
                )}

                <div className="inline-flex items-center bg-white p-2 rounded-2xl shadow-xl border border-slate-100 animate-in slide-in-from-bottom-4 duration-500">
                  {isSelectMode ? (
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => {
                          if (selectedPhotos.size === results.length) {
                            setSelectedPhotos(new Set());
                          } else {
                            setSelectedPhotos(new Set(results.map((p: any) => p.photo_id)));
                          }
                        }}
                        className="text-sm font-bold text-slate-600 hover:text-indigo-600 px-4 py-2 rounded-xl transition-colors active:scale-95"
                      >
                        {selectedPhotos.size === results.length ? "Deselect All" : "Select All"}
                      </button>

                      <div className="w-px h-6 bg-slate-200 mx-1" />

                      <button
                        onClick={() => {
                          const photosToDownload = results.filter((p: any) => selectedPhotos.has(p.photo_id));
                          downloadPhotos(photosToDownload);
                        }}
                        disabled={selectedPhotos.size === 0 || isDownloading}
                        className="bg-indigo-600 text-white text-sm font-bold px-6 py-2.5 rounded-xl hover:bg-indigo-700 active:scale-95 disabled:opacity-50 transition-all shadow-lg shadow-indigo-200 flex items-center gap-2"
                      >
                        {isDownloading ? (
                          <>
                            <svg className="animate-spin h-4 w-4 text-white" viewBox="0 0 24 24">
                              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none"></circle>
                              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                            </svg>
                            {downloadProgress.total > 1 ? `Packaging ${downloadProgress.total} Photos...` : "Downloading..."}
                          </>
                        ) : (
                          <>
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"></path></svg>
                            Download Selected ({selectedPhotos.size})
                          </>
                        )}
                      </button>

                      <button
                        onClick={() => {
                          setIsSelectMode(false);
                          setSelectedPhotos(new Set());
                        }}
                        className="text-sm font-bold text-slate-400 hover:text-red-500 px-4 py-2 rounded-xl transition-colors active:scale-95"
                      >
                        Cancel
                      </button>
                    </div>
                  ) : (
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => setIsSelectMode(true)}
                        className="text-sm font-bold text-slate-600 hover:text-indigo-600 px-5 py-2.5 rounded-xl transition-colors flex items-center gap-2 active:scale-95"
                      >
                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2"></path></svg>
                        Select Photos
                      </button>

                      <div className="w-px h-6 bg-slate-200 mx-1" />

                      <button
                        onClick={() => downloadPhotos(results)}
                        disabled={isDownloading}
                        className="text-sm font-bold text-white bg-indigo-600 px-6 py-2.5 rounded-xl hover:bg-indigo-700 active:scale-95 transition-all flex items-center gap-2 shadow-lg shadow-indigo-100"
                      >
                        {isDownloading ? (
                          <>
                            <svg className="animate-spin h-4 w-4 text-white" viewBox="0 0 24 24">
                              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none"></circle>
                              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                            </svg>
                            {downloadProgress.total > 1 ? `Packaging ${downloadProgress.total} Photos...` : "Downloading..."}
                          </>
                        ) : (
                          <>
                            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"></path></svg>
                            Download All
                          </>
                        )}
                      </button>
                    </div>
                  )}
                </div>
              </div>
            )}

            {results.length === 0 ? (
              <div className="text-center py-20 bg-slate-50 rounded-2xl border border-dashed border-slate-200">
                <p className="text-slate-400">No matches found. Try a clearer selfie with good lighting.</p>
              </div>
            ) : (
              /* Masonry Grid using CSS columns */
              <div className="columns-2 md:columns-3 gap-4 space-y-4">
                {results.map((photo, idx) => {
                  const isSelected = selectedPhotos.has(photo.photo_id);
                  return (
                    <div
                      key={idx}
                      className={`break-inside-avoid relative group overflow-hidden rounded-2xl shadow-sm transition-all duration-300 ${isSelectMode ? 'cursor-pointer' : ''} ${isSelected ? 'ring-4 ring-indigo-500 shadow-indigo-200' : 'hover:shadow-2xl hover:-translate-y-1'}`}
                      onClick={() => {
                        if (isSelectMode) {
                          const newSet = new Set(selectedPhotos);
                          if (isSelected) {
                            newSet.delete(photo.photo_id);
                          } else {
                            newSet.add(photo.photo_id);
                          }
                          setSelectedPhotos(newSet);
                        }
                      }}
                    >
                      <img
                        src={`${apiUrl}${photo.url}`}
                        alt={`Match `}
                        className={`w-full h-auto object-cover transform transition duration-700 ${!isSelectMode && 'group-hover:scale-105'} ${isSelected ? 'opacity-90' : ''}`}
                        loading="lazy"
                      />
                      <div className="absolute inset-0 bg-black/0 group-hover:bg-black/20 transition-colors pointer-events-none" />

                      {isSelectMode ? (
                        <div className="absolute top-4 right-4">
                          <div className={`w-8 h-8 rounded-full border-2 flex items-center justify-center transition-all ${isSelected ? 'bg-indigo-600 border-indigo-600 scale-110 shadow-lg' : 'border-white bg-black/20 backdrop-blur-sm shadow-sm'}`}>
                            {isSelected && (
                              <svg className="w-5 h-5 text-white animate-in zoom-in duration-200" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                              </svg>
                            )}
                          </div>
                        </div>
                      ) : (
                        <button
                          onClick={(e: any) => {
                            e.stopPropagation();
                            downloadPhotos([photo]);
                          }}
                          className="absolute bottom-4 right-4 bg-white/95 backdrop-blur-md p-3 rounded-full opacity-0 group-hover:opacity-100 transform translate-y-4 group-hover:translate-y-0 active:scale-95 transition-all text-slate-800 hover:text-indigo-600 shadow-xl border border-slate-100"
                          title="Download"
                        >
                          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"></path></svg>
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </div>
    </main>
  );
}
