import { rotationImages, safeUrl } from "../lib/items";

export default function GraveyardView({ items, onRestore }) {
  return (
    <main>
      <p className="view-note">Items you bought or no longer want. Restore anything to put it back on your wishlist.</p>
      <div className="wishlist-grid">
        {!items.length && <div className="empty-msg">Graveyard is empty.</div>}
        {items.map((item) => {
          const img = safeUrl(item.image) || rotationImages(item)[0];
          return (
            <div className="card" style={{ cursor: "default" }} key={item.id}>
              <div className="card-img-container">
                {img
                  ? <img src={img} className="card-img" alt="" referrerPolicy="no-referrer" />
                  : <div className="card-placeholder">{item.title}</div>}
              </div>
              <div className="card-details">
                <div className="card-title">{item.title}</div>
                <button
                  className="btn-primary"
                  style={{ padding: 4, fontSize: 9, marginTop: 4 }}
                  onClick={() => onRestore(item.id)}
                >
                  RESTORE
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </main>
  );
}
