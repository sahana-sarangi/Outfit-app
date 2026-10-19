import { useEffect, useState } from "react";
import { filtersFrom, newId } from "../lib/items";
import OptionCard from "./OptionCard";

// Slide-in panel for a general idea: AI Discover (search results) and Saved Options
export default function GeneralDrawer({ item, open, onClose, searchForGeneral, updateItem, addProductToWishlist }) {
  const [tab, setTab] = useState("search");
  const [price, setPrice] = useState("ALL");
  const [size, setSize] = useState("ALL");
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const [adding, setAdding] = useState(null); // id of the saved option being added

  const itemId = item?.id;
  const filters = filtersFrom(price, size);
  const key = JSON.stringify(filters);
  const results = item?.searchCache?.[key];

  useEffect(() => { setTab("search"); setError(""); }, [itemId]);

  useEffect(() => {
    if (!item || !open || tab !== "search" || results) return;
    let cancelled = false;
    setError("");
    searchForGeneral(item, filters).catch((e) => !cancelled && setError(e.message));
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [itemId, open, tab, key, !!results, retry]);

  if (!item) return <div className="drawer" aria-hidden="true" />;

  const saved = item.savedOptions || [];
  const savedUrls = new Set(saved.map((o) => o.url));

  async function newResults() {
    setError("");
    setRefreshing(true);
    try {
      await searchForGeneral(item, filters, { fresh: true });
    } catch (e) {
      setError(e.message);
    } finally {
      setRefreshing(false);
    }
  }

  function saveOption(opt) {
    updateItem(item.id, (it) =>
      (it.savedOptions || []).some((o) => o.url === opt.url)
        ? it
        : { ...it, savedOptions: [...(it.savedOptions || []), { ...opt, id: newId() }] }
    );
  }

  function removeSaved(optId) {
    updateItem(item.id, (it) => ({ ...it, savedOptions: (it.savedOptions || []).filter((o) => o.id !== optId) }));
  }

  async function addToWishlist(opt) {
    setAdding(opt.id);
    // The general idea stays on the wishlist
    await addProductToWishlist(opt, { color: item.targetColor, size: filters.size });
    removeSaved(opt.id);
    setAdding(null);
  }

  return (
    <div className={`drawer ${open ? "open" : ""}`} aria-hidden={!open}>
      <div className="drawer-header">
        <h3 style={{ fontSize: 14, textTransform: "uppercase" }}>{item.title}</h3>
        <button className="close-btn" onClick={onClose} aria-label="Close">✕</button>
      </div>

      <div className="drawer-tabs">
        <button className={`drawer-tab ${tab === "search" ? "active" : ""}`} onClick={() => setTab("search")}>
          AI DISCOVER
        </button>
        <button className={`drawer-tab ${tab === "saved" ? "active" : ""}`} onClick={() => setTab("saved")}>
          SAVED OPTIONS ({saved.length})
        </button>
      </div>

      {tab === "search" && (
        <>
          <div className="discover-toolbar">
            <select value={price} onChange={(e) => setPrice(e.target.value)}>
              <option value="ALL">ANY PRICE</option>
              <option value="UNDER_50">UNDER $50</option>
              <option value="50_150">$50 - $150</option>
              <option value="OVER_150">OVER $150</option>
            </select>
            <select value={size} onChange={(e) => setSize(e.target.value)}>
              <option value="ALL">ALL SIZES</option>
              <option value="S">SMALL (S)</option>
              <option value="M">MEDIUM (M)</option>
              <option value="L">LARGE (L)</option>
            </select>
            <button
              className="btn-secondary"
              onClick={newResults}
              disabled={refreshing || !results}
              title="Search again for different options"
            >
              {refreshing ? "SEARCHING…" : "NEW RESULTS"}
            </button>
          </div>

          <div className="ai-grid">
            {error ? (
              <div className="empty-msg">
                Search failed: {error}
                <br /><br />
                <button className="btn-secondary" onClick={() => setRetry((n) => n + 1)}>TRY AGAIN</button>
              </div>
            ) : !results ? (
              <div className="empty-msg">Searching real stores for “{item.title}”. This can take up to a minute.</div>
            ) : !results.length ? (
              <div className="empty-msg">No matches with these filters. Try a wider price range or any size.</div>
            ) : (
              results.map((opt) => {
                const isSaved = savedUrls.has(opt.url);
                const note = opt.matched === "image" && item.targetColor
                  ? `Choose ${item.targetColor} on the store page` : null;
                return (
                  <OptionCard key={opt.id} opt={opt} note={note}>
                    <button className="ai-action-btn" disabled={isSaved} onClick={() => saveOption(opt)}>
                      {isSaved ? "SAVED" : "+ SAVE"}
                    </button>
                  </OptionCard>
                );
              })
            )}
          </div>
        </>
      )}

      {tab === "saved" && (
        <div className="ai-grid">
          {!saved.length && (
            <div className="empty-msg">No saved options yet. Save options from the AI Discover tab.</div>
          )}
          {saved.map((opt) => (
            <OptionCard key={opt.id} opt={opt} onRemove={() => removeSaved(opt.id)}>
              <button className="ai-action-btn" disabled={adding === opt.id} onClick={() => addToWishlist(opt)}>
                {adding === opt.id ? "ADDING…" : "ADD TO WISHLIST"}
              </button>
            </OptionCard>
          ))}
        </div>
      )}
    </div>
  );
}
