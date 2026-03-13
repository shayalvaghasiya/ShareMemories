"use client";

import { useState } from "react";
import axios from "axios";
import Link from "next/link";

export default function Home() {
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [results, setResults] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [hasSearched, setHasSearched] = useState(false);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      const file = e.target.files[0];
      setSelectedFile(file);
      setPreview(URL.createObjectURL(file));
      setHasSearched(false);
    }
  };

  const handleSearch = async () => {
    if (!selectedFile) return;

    setLoading(true);
    setHasSearched(true);
    setResults([]);
    
    const formData = new FormData();
    formData.append("file", selectedFile);

    try {
      // Post directly to the backend to bypass the Next.js proxy, which can time out
      // or have issues with file uploads.
      const response = await axios.post("http://localhost:8000/search", formData);
      setResults(response.data.matches);
    } catch (error) {
      console.error("Search failed", error);
      alert("Search failed. Ensure backend is running.");
    } finally {
      setLoading(false);
    }
  };

  // Helper to resolve backend image paths to local URL
  // API returns /storage/events/..., mapped to http://localhost:8000/storage/...
  const getImageUrl = (path: string) => `http://localhost:8000${path}`;

  return (
    <main className="min-h-screen bg-slate-50 text-slate-800 font-sans">
      {/* Hero Header */}
      <header className="bg-white py-8 border-b border-slate-200">
        <div className="max-w-4xl mx-auto px-6 flex justify-between items-center">
          <h1 className="text-2xl font-serif font-bold text-slate-900">Wedding Memories</h1>
          <Link href="/admin" className="px-4 py-2 text-sm text-slate-500 hover:bg-slate-100 rounded-full transition-colors">
            Photographer Login
          </Link>
        </div>
      </header>

      <div className="max-w-3xl mx-auto p-6">
        
        {/* Search Card */}
        <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-8 text-center mb-10">
          <h2 className="text-xl font-medium mb-2">Find your photos</h2>
          <p className="text-slate-500 mb-8">Upload a clear selfie to find every photo you appeared in.</p>
          
          <div className="flex flex-col items-center gap-6">
            {/* Preview Area */}
            <div className={`relative w-40 h-40 rounded-full overflow-hidden border-4 ${preview ? 'border-indigo-100' : 'border-slate-100 bg-slate-50'}`}>
            {preview ? (
              <img src={preview} alt="Selfie" className="w-full h-full object-cover" />
            ) : (
              <div className="w-full h-full flex flex-col items-center justify-center text-slate-300">
                <svg className="w-12 h-12 mb-2" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z"></path><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 13a3 3 0 11-6 0 3 3 0 016 0z"></path></svg>
                <span className="text-xs font-medium">No Selfie</span>
              </div>
            )}
            </div>
          
            {/* Controls */}
            <div className="flex flex-col gap-3 w-full max-w-xs">
              <label className="block w-full">
                <span className="sr-only">Choose selfie</span>
                <input 
                  type="file" 
                  accept="image/*" 
                  onChange={handleFileChange}
                  className="block w-full text-sm text-slate-500
                    file:mr-4 file:py-2 file:px-4
                    file:rounded-full file:border-0
                    file:text-sm file:font-semibold
                    file:bg-slate-100 file:text-slate-700
                    hover:file:bg-slate-200
                    cursor-pointer mx-auto"
                />
              </label>
              
              <button
                onClick={handleSearch}
                disabled={!selectedFile || loading}
                className="w-full bg-indigo-600 text-white px-6 py-3 rounded-xl hover:bg-indigo-700 disabled:bg-slate-200 disabled:text-slate-400 font-semibold transition-all shadow-sm active:scale-95"
              >
                {loading ? "Scanning Gallery..." : "Find My Photos"}
              </button>
            </div>
          </div>
        </div>

        {/* Results Section */}
        {hasSearched && !loading && (
          <div className="animate-fade-in">
            <h3 className="text-lg font-semibold mb-6 flex items-center gap-2">
              Found Matches 
              <span className="bg-indigo-100 text-indigo-700 text-xs px-2 py-1 rounded-full">{results.length}</span>
            </h3>
            
            {results.length === 0 ? (
              <div className="text-center py-12 text-slate-400">
                No matches found. Try a clearer selfie?
              </div>
            ) : (
              <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                {results.map((path, idx) => (
                  <div key={idx} className="relative group overflow-hidden rounded-xl shadow-sm bg-gray-200 aspect-square">
                    <img
                      src={getImageUrl(path)}
                      alt={`Match ${idx}`}
                      className="w-full h-full object-cover transition duration-500 group-hover:scale-105"
                      loading="lazy"
                    />
                    <div className="absolute inset-0 bg-black/0 group-hover:bg-black/10 transition-colors pointer-events-none" />
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </main>
  );
}
