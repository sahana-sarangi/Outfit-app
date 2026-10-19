// Shared constants and small helpers for wishlist items.

// Same lists the server uses, so filters always match the tags
export const COLORS = ["black", "white", "cream", "gray", "beige", "brown", "red", "pink", "orange",
  "yellow", "green", "blue", "navy", "purple", "metallic", "multicolor"];
export const TYPES = ["Tops", "Bottoms", "Outerwear", "Shoes", "Accessories"];
export const SLOTS = ["Head", "Tops", "Bottoms", "Shoes", "Accessories"];
export const EMPTY_SLOTS = { Head: null, Tops: null, Bottoms: null, Shoes: null, Accessories: null };

export function money(p) {
  if (p == null || p === "") return "";
  const n = Number(p);
  return Number.isFinite(n) ? `$${n % 1 ? n.toFixed(2) : n}` : "";
}

export function newId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

export function storeName(url) {
  try { return new URL(url).hostname.replace(/^www\./, ""); } catch { return ""; }
}

// Only allow normal web links in href/src (blocks "javascript:" links from scraped data)
export function safeUrl(url) {
  return typeof url === "string" && /^https?:\/\//.test(url) ? url : undefined;
}

// /api/scrape response → wishlist item
export function itemFromScrape(d) {
  return {
    id: newId(),
    type: "specific",
    title: d.name || "Untitled item",
    price: d.price ?? null,
    url: d.url,
    image: d.image,
    store: storeName(d.url),
    category: d.category || "Accessories", // Tops / Bottoms / Outerwear / Shoes / Accessories
    subcategory: d.subcategory || null,    // shorts, hat, sweater...
    color: d.color || null,
    colorDetail: d.colorDetail || null,
    pattern: d.pattern || null,
    material: d.material || null,
    descriptors: d.descriptors || [],
    dateAdded: Date.now(),
  };
}

// /api/search result → option card (also usable on the mannequin)
export function optionFromResult(r, fallbackCategory, fallbackColor) {
  return {
    id: newId(),
    title: r.name || "Untitled item",
    price: r.price ?? null,
    url: r.url,
    image: r.image,
    store: r.store || storeName(r.url),
    category: r.category || fallbackCategory || "Accessories",
    color: r.color || fallbackColor || null,
    matched: r.matched || null,
    variantName: r.variantName || null,
  };
}

// Price/size dropdown values → search filters for the server
export function filtersFrom(price, size) {
  const f = {};
  if (price === "UNDER_50") f.maxPrice = 50;
  if (price === "50_150") { f.minPrice = 50; f.maxPrice = 150; }
  if (price === "OVER_150") f.minPrice = 150;
  if (size !== "ALL") f.size = size;
  return f;
}

// Images a general idea's card cycles through: saved picks first, then search results
export function rotationImages(item) {
  const imgs = [...(item.savedOptions || []), ...(item.searchResults || [])]
    .map((o) => safeUrl(o.image)).filter(Boolean);
  return [...new Set(imgs)].slice(0, 12);
}

// Which mannequin slot an item belongs in
export function slotFor(item) {
  if (item.subcategory === "hat") return "Head";
  if (item.category === "Tops" || item.category === "Outerwear") return "Tops";
  if (item.category === "Bottoms") return "Bottoms";
  if (item.category === "Shoes") return "Shoes";
  return "Accessories";
}
