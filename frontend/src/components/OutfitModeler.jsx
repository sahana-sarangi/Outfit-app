import { useRef, useState } from "react";
import { api } from "../lib/api";
import { SLOTS, TYPES, money, optionFromResult, rotationImages, safeUrl, slotFor } from "../lib/items";
import Cutout from "./Cutout";

const SLOT_ZONES = [
  { slot: "Head", label: "HEAD", className: "slot-zone-head" },
  { slot: "Tops", label: "TOPS / OUTER", className: "slot-zone-top" },
  { slot: "Bottoms", label: "BOTTOMS", className: "slot-zone-bottom" },
  { slot: "Shoes", label: "SHOES", className: "slot-zone-shoes" },
  { slot: "Accessories", label: "ACCESSORIES", className: "slot-zone-accessory" },
];

const WISHLIST_VIEW = { mode: "wishlist", label: "", status: "ready", results: [], error: "" };

export default function OutfitModeler({ wishlist, slots, setSlot, clearOutfit, searchForGeneral, addProductToWishlist }) {
  const [typeFilter, setTypeFilter] = useState("ALL");
  const [query, setQuery] = useState("");
  const [sidebar, setSidebar] = useState(WISHLIST_VIEW); // wishlist, or a list of search results
  const [dragOver, setDragOver] = useState(null);         // which drop target is highlighted
  const [addingSlot, setAddingSlot] = useState(null);
  const latestLabel = useRef(""); // ignores slow searches that a newer one replaced

  const showingResults = sidebar.mode === "results";
  let list = showingResults ? sidebar.results : wishlist;
  if (typeFilter !== "ALL") list = list.filter((i) => i.category === typeFilter);

  const total = SLOTS.reduce((sum, s) => sum + (Number(slots[s]?.price) || 0), 0);
  const inWishlist = (item) => wishlist.some((w) => w.id === item.id || (item.url && w.url === item.url));

  // putting items on the mannequin

  function place(item, slot = null) {
    setSlot(slot || slotFor(item), {
      id: item.id, title: item.title, price: item.price, url: item.url, image: item.image,
      store: item.store, category: item.category, subcategory: item.subcategory || null,
      color: item.color || null,
    });
  }

  const dropProps = (target, slot = null) => ({
    onDragOver: (e) => { e.preventDefault(); setDragOver(target); },
    onDragLeave: () => setDragOver(null),
    onDrop: (e) => {
      e.preventDefault();
      setDragOver(null);
      try { place(JSON.parse(e.dataTransfer.getData("text/plain")), slot); } catch { /* not one of our items */ }
    },
  });

  async function addSlotToWishlist(slot) {
    const item = slots[slot];
    setAddingSlot(slot);
    const added = await addProductToWishlist(item, { color: item.color });
    setSlot(slot, { ...item, id: added.id });
    setAddingSlot(null);
  }

  //  sidebar: general ideas and AI search 

  async function openGeneral(item) {
    const label = `OPTIONS: ${item.title}`;
    latestLabel.current = label;
    const show = (results) => {
      const saved = item.savedOptions || [];
      const rest = results.filter((r) => !saved.some((s) => s.url === r.url));
      setSidebar({ mode: "results", label, status: "ready", results: [...saved, ...rest], error: "" });
    };

    if (item.searchResults?.length) return show(item.searchResults);

    setSidebar({ mode: "results", label, status: "loading", results: [], error: "" });
    try {
      const results = await searchForGeneral(item);
      if (latestLabel.current === label) show(results);
    } catch (e) {
      if (latestLabel.current === label) setSidebar({ mode: "results", label, status: "error", results: [], error: e.message });
    }
  }

  async function runSearch() {
    const q = query.trim();
    if (!q) return;
    const label = `RESULTS: ${q}`;
    latestLabel.current = label;
    setSidebar({ mode: "results", label, status: "loading", results: [], error: "" });
    try {
      const res = await api("/api/search", { q });
      if (latestLabel.current !== label) return;
      setSidebar({
        mode: "results", label, status: "ready", error: "",
        results: res.results.map((r) => optionFromResult(r, res.itemType, res.targetColor)),
      });
    } catch (e) {
      if (latestLabel.current === label) setSidebar({ mode: "results", label, status: "error", results: [], error: e.message });
    }
  }

  function backToWishlist() {
    latestLabel.current = "";
    setSidebar(WISHLIST_VIEW);
    setQuery("");
  }

  // layout 

  return (
    <main>
      <div className="modeler-container">
        {/* Mannequin */}
        <div className="mannequin-stage">
          <div className="total-counter">
            <span>OUTFIT TOTAL: {money(total) || "$0"}</span>
            <button className="btn-secondary" onClick={clearOutfit}>CLEAR</button>
          </div>

          <div className={`figure ${dragOver === "figure" ? "drag-over" : ""}`} {...dropProps("figure")}>
            <svg className="silhouette-svg" viewBox="0 0 100 220" aria-hidden="true">
              <circle cx="50" cy="22" r="11" />
              <rect x="47" y="33" width="6" height="8" />
              <path d="M 28 42 L 72 42 L 66 110 L 34 110 Z" />
              <path d="M 27 43 L 18 105 L 23 107 L 31 50 Z" />
              <path d="M 73 43 L 82 105 L 77 107 L 69 50 Z" />
              <rect x="36" y="112" width="11" height="85" />
              <rect x="53" y="112" width="11" height="85" />
              <path d="M 33 197 L 47 197 L 47 203 L 31 203 Z" />
              <path d="M 53 197 L 67 197 L 69 203 L 53 203 Z" />
            </svg>
            {SLOTS.map((slot) =>
              slots[slot]?.image ? (
                <Cutout key={`${slot}-${slots[slot].image}`} src={slots[slot].image} className={`worn worn-${slot}`} />
              ) : null
            )}
          </div>

          {SLOT_ZONES.map(({ slot, label, className }) => {
            const item = slots[slot];
            return (
              <div
                key={slot}
                className={`slot-zone ${className} ${dragOver === slot ? "drag-over" : ""}`}
                {...dropProps(slot, slot)}
              >
                <span className="slot-label">{label}</span>
                {item && (
                  <div className="slot-card" title={item.title}>
                    <Cutout key={item.image} src={item.image} />
                    <button className="slot-card-remove" onClick={() => setSlot(slot, null)} aria-label="Remove">✕</button>
                    {!inWishlist(item) && (
                      <button
                        className="slot-card-add-wl"
                        disabled={addingSlot === slot}
                        onClick={() => addSlotToWishlist(slot)}
                      >
                        {addingSlot === slot ? "ADDING…" : "+ WISHLIST"}
                      </button>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* Sidebar */}
        <div className="modeler-sidebar">
          <div className="sidebar-header">
            <div className="sidebar-title">
              <span>{showingResults ? sidebar.label : "WISHLIST ITEMS"}</span>
              {showingResults && (
                <button className="btn-clear-search" onClick={backToWishlist}>SHOW WISHLIST</button>
              )}
            </div>
            <div className="sidebar-controls">
              <select value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)}>
                <option value="ALL">ALL CLOTHING TYPES</option>
                {TYPES.map((t) => <option key={t} value={t}>{t.toUpperCase()}</option>)}
              </select>
              <div className="search-box-wrap">
                <input
                  type="text"
                  placeholder="Search new items…"
                  style={{ flex: 1 }}
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && runSearch()}
                />
                <button className="btn-primary" style={{ width: "auto", padding: "0 12px" }} onClick={runSearch}>
                  AI SEARCH
                </button>
              </div>
              <div className="sidebar-hint">Click an item to put it on the mannequin, or drag it to a slot.</div>
            </div>
          </div>

          <div className="sidebar-items-grid">
            {showingResults && sidebar.status === "loading" ? (
              <div className="empty-msg">Searching real stores. This can take up to a minute.</div>
            ) : showingResults && sidebar.status === "error" ? (
              <div className="empty-msg">Search failed: {sidebar.error}</div>
            ) : !list.length ? (
              <div className="empty-msg">No items here yet.</div>
            ) : (
              list.map((item) =>
                item.type === "general" ? (
                  // General idea: clicking shows the options found for it
                  <div key={item.id} className="sidebar-item general" onClick={() => openGeneral(item)}>
                    <span className="card-badge" style={{ top: 4, left: 4 }}>IDEA</span>
                    {rotationImages(item)[0]
                      ? <img src={rotationImages(item)[0]} alt="" referrerPolicy="no-referrer" />
                      : <div className="card-placeholder">{item.title}</div>}
                    <div className="sidebar-item-info">
                      <div className="sidebar-item-name">{item.title}</div>
                      <div className="sidebar-item-price">See options</div>
                    </div>
                  </div>
                ) : (
                  // Specific item or search result: click to wear, or drag to a slot
                  <div
                    key={item.id}
                    className="sidebar-item"
                    draggable
                    onDragStart={(e) => e.dataTransfer.setData("text/plain", JSON.stringify(item))}
                    onClick={() => place(item)}
                  >
                    <img src={safeUrl(item.image)} alt="" referrerPolicy="no-referrer" />
                    <div className="sidebar-item-info">
                      <div className="sidebar-item-name">{item.title}</div>
                      <div className="sidebar-item-price">{money(item.price)}</div>
                    </div>
                  </div>
                )
              )
            )}
          </div>
        </div>
      </div>
    </main>
  );
}
