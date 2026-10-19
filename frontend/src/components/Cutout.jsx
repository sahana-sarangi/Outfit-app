import { useState } from "react";
import { cutoutUrl } from "../lib/api";
import { safeUrl } from "../lib/items";

// Background-removed image from the server. falls back to original if removal fails.
export default function Cutout({ src, className = "" }) {
  const original = safeUrl(src);
  const [failed, setFailed] = useState(false);
  const [loaded, setLoaded] = useState(false);
  if (!original) return null;

  return (
    <img
      alt=""
      referrerPolicy="no-referrer"
      className={`${className} ${loaded ? "" : "loading"}`.trim()}
      src={failed ? original : cutoutUrl(original)}
      onLoad={() => setLoaded(true)}
      onError={() => (failed ? setLoaded(true) : setFailed(true))}
    />
  );
}
