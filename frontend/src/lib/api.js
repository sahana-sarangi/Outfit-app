// Everything that talks to the Express backend lives here.

// Comes from .env.development / .env.production. Trailing slashes are removed,
// so "https://...onrender.com/" can't turn into a broken "//api/..." address.
export const API = (import.meta.env.VITE_API_URL || "http://localhost:3000").replace(/\/+$/, "");

// Calls the backend and returns its JSON, or throws an Error with a readable message
export async function api(path, params = {}) {
  const qs = new URLSearchParams(
    Object.entries(params).filter(([, v]) => v != null && v !== "" && v !== "ALL")
  );
  let res;
  try {
    res = await fetch(`${API}${path}?${qs}`);
  } catch {
    throw new Error("Can't reach the server. Is it running?");
  }
  const data = await res.json().catch(() => ({ error: `Server error ${res.status}` }));
  if (!res.ok || data.error) throw new Error(data.error || `Server error ${res.status}`);
  return data;
}

// Background-removed version of an image, made by the server
export function cutoutUrl(imageUrl) {
  return `${API}/api/remove-bg?url=${encodeURIComponent(imageUrl)}`;
}
