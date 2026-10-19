import { money, safeUrl } from "../lib/items";

// A specific product on the wishlist.
export default function ItemCard({ item, onTrash }) {
  const tags = [item.colorDetail || item.color, item.material, item.subcategory || item.category]
    .filter(Boolean).join(", ");
  const url = safeUrl(item.url);
  const image = safeUrl(item.image);
  const open = () => url && window.open(url, "_blank", "noopener");

  return (
    <div
      className="card"
      tabIndex={0}
      title={url ? `Open at ${item.store || "store"}` : undefined}
      onClick={open}
      onKeyDown={(e) => e.key === "Enter" && open()}
    >
      <button
        className="trash-btn"
        aria-label="Move to graveyard"
        onClick={(e) => { e.stopPropagation(); onTrash(item.id); }}
      >
        ✕
      </button>
      <div className="card-img-container">
        {image
          ? <img src={image} className="card-img" alt="" referrerPolicy="no-referrer" />
          : <div className="card-placeholder">{item.title}</div>}
      </div>
      <div className="card-details">
        <div className="card-title">{item.title}</div>
        <div className="card-price">{money(item.price) || "Price unknown"}</div>
        <div className="card-tags">{tags || item.store}</div>
      </div>
    </div>
  );
}
