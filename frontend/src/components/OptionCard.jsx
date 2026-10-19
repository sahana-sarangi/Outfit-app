import { money, safeUrl } from "../lib/items";

// A product option found by search, shown in the general idea drawer.
// The buttons are passed in as children.
export default function OptionCard({ opt, note, onRemove, children }) {
  const image = safeUrl(opt.image);
  const url = safeUrl(opt.url);

  return (
    <div className="ai-item-card">
      {onRemove && (
        <button className="trash-btn" onClick={onRemove} aria-label="Remove from saved">✕</button>
      )}
      {image
        ? <img src={image} className="ai-item-img" alt="" referrerPolicy="no-referrer" />
        : <div className="ai-item-img" />}
      <div className="ai-item-title">{opt.title}</div>
      <div className="ai-item-brand">{opt.store}</div>
      <div className="ai-item-price">{money(opt.price) || "See store"}</div>
      {note && <div className="ai-item-note">{note}</div>}
      <div className="ai-btn-row">
        {url && <a className="ai-action-btn outline" href={url} target="_blank" rel="noopener noreferrer">VIEW</a>}
        {children}
      </div>
    </div>
  );
}
