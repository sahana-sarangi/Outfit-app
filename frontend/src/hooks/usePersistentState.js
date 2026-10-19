import { useEffect, useState } from "react";

// Like useState, but the value is saved in this browser (localStorage) and restored on reload.
export function usePersistentState(key, initial) {
  const [value, setValue] = useState(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(key));
      return saved ? { ...initial, ...saved } : initial;
    } catch {
      return initial; // first visit or unreadable data: start fresh
    }
  });

  useEffect(() => {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch (e) {
      console.warn("Couldn't save to this browser:", e);
    }
  }, [key, value]);

  return [value, setValue];
}
