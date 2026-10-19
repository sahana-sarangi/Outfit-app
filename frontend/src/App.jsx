import { useCallback, useRef, useState } from "react";
import { api } from "./lib/api";
import { EMPTY_SLOTS, itemFromScrape, newId, optionFromResult, storeName } from "./lib/items";
import { usePersistentState } from "./hooks/usePersistentState";
import WishlistView from "./components/WishlistView";
import GraveyardView from "./components/GraveyardView";
import OutfitModeler from "./components/OutfitModeler";
import AddDrawer from "./components/AddDrawer";
import GeneralDrawer from "./components/GeneralDrawer";

// Same storage key and data shape as the old index.html
const STORAGE_KEY = "wishlist-app-v1";
const INITIAL_DATA = { wishlistData: [], graveyardData: [], outfitSlots: EMPTY_SLOTS };

const TABS = [
  { id: "wishlist", label: "WISHLIST" },
  { id: "modeler", label: "OUTFIT MODELER" },
  { id: "graveyard", label: "GRAVEYARD" },
];

export default function App() {
  const [data, setData] = usePersistentState(STORAGE_KEY, INITIAL_DATA);
  const wishlist = data.wishlistData;
  const graveyard = data.graveyardData;
  const slots = { ...EMPTY_SLOTS, ...data.outfitSlots };

  const [view, setView] = useState("wishlist");
  const [drawer, setDrawer] = useState(null); // null | { type: "add" } | { type: "general", id }

  // Searches in progress, so the same search isn't sent twice at once
  const pending = useRef(new Map());
  const [, setPendingCount] = useState(0); // re-renders when searches start/finish

  //  actions that change the saved data 

  const addItem = useCallback(
    (item) => setData((d) => ({ ...d, wishlistData: [...d.wishlistData, item] })),
    [setData]
  );

  const updateItem = useCallback(
    (id, change) =>
      setData((d) => ({ ...d, wishlistData: d.wishlistData.map((i) => (i.id === id ? change(i) : i)) })),
    [setData]
  );

  function moveToGraveyard(id) {
    setData((d) => {
      const item = d.wishlistData.find((i) => i.id === id);
      if (!item) return d;
      return {
        ...d,
        wishlistData: d.wishlistData.filter((i) => i.id !== id),
        graveyardData: [...d.graveyardData, item],
      };
    });
  }

  function restoreFromGraveyard(id) {
    setData((d) => {
      const item = d.graveyardData.find((i) => i.id === id);
      if (!item) return d;
      return {
        ...d,
        graveyardData: d.graveyardData.filter((i) => i.id !== id),
        wishlistData: [...d.wishlistData, item],
      };
    });
  }

  function setSlot(slot, item) {
    setData((d) => ({ ...d, outfitSlots: { ...EMPTY_SLOTS, ...d.outfitSlots, [slot]: item } }));
  }

  function clearOutfit() {
    setData((d) => ({ ...d, outfitSlots: EMPTY_SLOTS }));
  }

  // talking to the server

  // Runs /api/search for a general idea and remembers the results on the item,
  // one set per filter combination, so reopening the drawer is instant.
  const searchForGeneral = useCallback(
    async (item, filters = {}, { fresh = false } = {}) => {
      const key = JSON.stringify(filters);
      if (!fresh && item.searchCache?.[key]) return item.searchCache[key];

      const pendingKey = `${item.id}|${key}`;
      if (pending.current.has(pendingKey)) return pending.current.get(pendingKey);

      const job = (async () => {
        const res = await api("/api/search", { q: item.title, ...filters });
        const color = res.targetColor ? res.targetColor.toLowerCase() : null;
        const results = res.results.map((r) => optionFromResult(r, res.itemType || item.category, color));

        updateItem(item.id, (it) => ({
          ...it,
          category: res.itemType || it.category,
          color: color ?? it.color,
          targetColor: res.targetColor || null,
          searchCache: { ...(it.searchCache || {}), [key]: results },
          // the unfiltered search feeds the rotating card
          searchResults: key === "{}" || !it.searchResults?.length ? results : it.searchResults,
        }));
        return results;
      })();

      pending.current.set(pendingKey, job);
      setPendingCount((n) => n + 1);
      try {
        return await job;
      } finally {
        pending.current.delete(pendingKey);
        setPendingCount((n) => n - 1);
      }
    },
    [updateItem]
  );

  const isSearching = (id) => [...pending.current.keys()].some((k) => k.startsWith(id + "|"));

  // Adds a product (from a search option or the mannequin) to the wishlist.
  // Re-reads the product page so it gets full tags; if the store blocks that,
  // it still adds the item with the details we already have.
  const addProductToWishlist = useCallback(
    async (opt, { color = null, size = null } = {}) => {
      let item;
      try {
        const d = await api("/api/scrape", { url: opt.url, color, size });
        item = itemFromScrape(d);
        if (!item.image) item.image = opt.image;
      } catch (e) {
        console.warn("Full tagging failed, adding with basic info:", e.message);
        item = {
          id: newId(), type: "specific", title: opt.title, price: opt.price, url: opt.url,
          image: opt.image, store: opt.store || storeName(opt.url), category: opt.category || "Accessories",
          subcategory: null, color: opt.color || null, colorDetail: null, pattern: null,
          material: null, descriptors: [], dateAdded: Date.now(),
        };
      }
      addItem(item);
      return item;
    },
    [addItem]
  );

  function createGeneralIdea(title) {
    const item = {
      id: newId(),
      type: "general",
      title,
      category: null, // filled in by the search (e.g. "Bottoms")
      color: null,    // filled in by the search (e.g. "pink")
      dateAdded: Date.now(),
      savedOptions: [],
      searchResults: null,
      searchCache: {},
    };
    addItem(item);
    // One search right away so the card can start rotating. Searches only ever start from
    // a user action, never automatically on page load, so refreshing the page can't cost money.
    searchForGeneral(item).catch((e) => console.warn("Search failed:", e.message));
  }

  // layout

  const activeGeneral = drawer?.type === "general" ? wishlist.find((i) => i.id === drawer.id) : null;
  const closeDrawer = () => setDrawer(null);

  return (
    <>
      <header>
        <div className="user-title">hi elden & sahana</div>
        <nav className="nav-tabs">
          {TABS.map((t) => (
            <button
              key={t.id}
              className={`nav-btn ${view === t.id ? "active" : ""}`}
              onClick={() => setView(t.id)}
            >
              {t.label}
            </button>
          ))}
        </nav>
      </header>

      {view === "wishlist" && (
        <WishlistView
          items={wishlist}
          isSearching={isSearching}
          onAdd={() => setDrawer({ type: "add" })}
          onOpenGeneral={(id) => setDrawer({ type: "general", id })}
          onTrash={moveToGraveyard}
        />
      )}

      {view === "graveyard" && <GraveyardView items={graveyard} onRestore={restoreFromGraveyard} />}

      {view === "modeler" && (
        <OutfitModeler
          wishlist={wishlist}
          slots={slots}
          setSlot={setSlot}
          clearOutfit={clearOutfit}
          searchForGeneral={searchForGeneral}
          addProductToWishlist={addProductToWishlist}
        />
      )}

      {/* Drawers stay in the page so they can slide in and out */}
      <div className={`drawer-overlay ${drawer ? "open" : ""}`} onClick={closeDrawer} />

      <AddDrawer
        open={drawer?.type === "add"}
        onClose={closeDrawer}
        onAddSpecific={addItem}
        onCreateGeneral={createGeneralIdea}
      />

      <GeneralDrawer
        item={activeGeneral}
        open={!!activeGeneral}
        onClose={closeDrawer}
        searchForGeneral={searchForGeneral}
        updateItem={updateItem}
        addProductToWishlist={addProductToWishlist}
      />
    </>
  );
}
