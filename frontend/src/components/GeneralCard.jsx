import { useEffect, useState } from "react";
import { rotationImages } from "../lib/items";

// A general idea ("pink shorts"). Its picture rotates through the options found online.
export default function GeneralCard({ item, searching, onOpen, onTrash }) {
  const imgs = rotationImages(item);
  const [index, setIndex] = useState(0);
  const [visible, setVisible] = useState(true);

  // Every 3 seconds: fade out, switch to the next image, fade back in
  useEffect(() => {
    if (imgs.length < 2) return;
    const timer = setInterval(() => {
      setVisible(false);
      setTimeout(() => { setIndex((i) => i + 1); setVisible(true); }, 300);
    }, 3000);
    return () => clearInterval(timer);
  }, [imgs.length]);

  const current = imgs.length ? imgs[index % imgs.length] : null;

  return (
    <div
      className="card"
      tabIndex={0}
      onClick={() => onOpen(item.id)}
      onKeyDown={(e) => e.key === "Enter" && onOpen(item.id)}
    >
      <button
        className="trash-btn"
        aria-label="Move to graveyard"
        onClick={(e) => { e.stopPropagation(); onTrash(item.id); }}
      >
        ✕
      </button>
      <span className="card-badge">GENERAL IDEA</span>
      <div className="card-img-container">
        {current ? (
          <img
            src={current}
            className="card-img card-img-fade"
            style={{ opacity: visible ? 1 : 0 }}
            alt=""
            referrerPolicy="no-referrer"
          />
        ) : (
          <div className="card-placeholder">
            {item.title}
            <small>{searching ? "Finding options in stores…" : "Click to find options"}</small>
          </div>
        )}
      </div>
      <div className="card-details">
        <div className="card-title">{item.title}</div>
        <div className="card-price" style={{ fontSize: 10, color: "var(--mid-gray)" }}>
          {item.searchResults?.length || 0} options, {item.savedOptions?.length || 0} saved
        </div>
      </div>
    </div>
  );
}
