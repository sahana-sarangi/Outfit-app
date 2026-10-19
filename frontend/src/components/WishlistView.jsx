import { useState } from "react";
import { COLORS, TYPES } from "../lib/items";
import ItemCard from "./ItemCard";
import GeneralCard from "./GeneralCard";

export default function WishlistView({ items, isSearching, onAdd, onOpenGeneral, onTrash }) {
  const [query, setQuery] = useState("");
  const [type, setType] = useState("ALL");
  const [color, setColor] = useState("ALL");
  const [sort, setSort] = useState("LATEST");

  const q = query.trim().toLowerCase();
  const shown = items.filter((item) => {
    if (type !== "ALL" && item.category !== type) return false;
    if (color !== "ALL" && item.color !== color) return false;
    if (q) {
      const haystack = [item.title, item.store, item.category, item.subcategory, item.color,
        item.colorDetail, item.material, item.pattern, ...(item.descriptors || [])]
        .filter(Boolean).join(" ").toLowerCase();
      if (!haystack.includes(q)) return false;
    }
    return true;
  });

  if (sort === "PRICE_LOW") shown.sort((a, b) => (a.price ?? Infinity) - (b.price ?? Infinity));
  else if (sort === "PRICE_HIGH") shown.sort((a, b) => (b.price ?? -1) - (a.price ?? -1));
  else shown.sort((a, b) => b.dateAdded - a.dateAdded);

  return (
    <>
      <div className="controls-bar">
        <div className="filters-group">
          <input
            type="search"
            id="filter-search"
            placeholder="Search your wishlist (linen, pink, Zara…)"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          <select value={type} onChange={(e) => setType(e.target.value)}>
            <option value="ALL">ALL TYPES</option>
            {TYPES.map((t) => <option key={t} value={t}>{t.toUpperCase()}</option>)}
          </select>
          <select value={color} onChange={(e) => setColor(e.target.value)}>
            <option value="ALL">ALL COLORS</option>
            {COLORS.map((c) => <option key={c} value={c}>{c.toUpperCase()}</option>)}
          </select>
          <select value={sort} onChange={(e) => setSort(e.target.value)}>
            <option value="LATEST">SORT: LATEST ADDED</option>
            <option value="PRICE_LOW">SORT: PRICE LOW TO HIGH</option>
            <option value="PRICE_HIGH">SORT: PRICE HIGH TO LOW</option>
          </select>
        </div>
      </div>

      <main>
        <div className="wishlist-grid">
          <div
            className="card card-add-trigger"
            role="button"
            tabIndex={0}
            aria-label="Add item"
            onClick={onAdd}
            onKeyDown={(e) => e.key === "Enter" && onAdd()}
          >
            +
          </div>

          {!shown.length && items.length > 0 && <div className="empty-msg">Nothing matches these filters.</div>}

          {shown.map((item) =>
            item.type === "general" ? (
              <GeneralCard
                key={item.id}
                item={item}
                searching={isSearching(item.id)}
                onOpen={onOpenGeneral}
                onTrash={onTrash}
              />
            ) : (
              <ItemCard key={item.id} item={item} onTrash={onTrash} />
            )
          )}
        </div>
      </main>
    </>
  );
}
