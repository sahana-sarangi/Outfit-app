// server.js — backend for the clothing wishlist app
//
// Endpoints:
//   GET /api/scrape?url=...   → details for one product link (image, price, color, pattern, category...)
//                               optional: &color=pink&size=M  → jump to that color variant if the page has one
//   GET /api/search?q=...     → searches the web for real products matching a general item or a style
//                               optional: &minPrice=20&maxPrice=60&size=M&count=8
//   GET /api/remove-bg?url=...→ the image at that URL as a PNG with the background removed

import express from "express";
import cors from "cors";
import * as cheerio from "cheerio";
import Anthropic from "@anthropic-ai/sdk";

const app = express();

// CHANGE "YOURNAME" to your GitHub username. No trailing slash.
app.use(cors({
  origin: [
  "https://sahana-sarangi.github.io",        // ← your real one, no trailing slash, no repo name
    /^http:\/\/(localhost|127\.0\.0\.1):\d+$/, // local testing
  ],
}));  

const anthropic = new Anthropic(); // reads ANTHROPIC_API_KEY from the environment

// Cheap, fast model for labeling and picking variants/images
const LABEL_MODEL = "claude-haiku-5-5";
// Smarter model for web searching (better at judging which results are real product pages)
const SEARCH_MODEL = "claude-sonnet-5-5";

const BROWSER_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Safari/537.36",
  "Accept-Language": "en-US,en;q=0.9",
};

// ---------- fixed label lists (keep values consistent for filtering) ----------

// Detailed garment kind ("subcategory")...
const CATEGORIES = [
  "t-shirt", "shirt", "sweater", "hoodie", "dress", "jacket", "coat",
  "pants", "jeans", "shorts", "skirt", "shoes",
  "bag", "hat", "belt", "jewelry", "sunglasses", "scarf", "accessory", "other",
];
// ...and the five main groups the wishlist filters and outfit modeler use ("category")
const TYPES = ["Tops", "Bottoms", "Outerwear", "Shoes", "Accessories"];
const TYPE_OF = {
  "t-shirt": "Tops", shirt: "Tops", sweater: "Tops", hoodie: "Tops", dress: "Tops",
  jacket: "Outerwear", coat: "Outerwear",
  pants: "Bottoms", jeans: "Bottoms", shorts: "Bottoms", skirt: "Bottoms",
  shoes: "Shoes",
  bag: "Accessories", hat: "Accessories", belt: "Accessories", jewelry: "Accessories",
  sunglasses: "Accessories", scarf: "Accessories", accessory: "Accessories",
};
const COLORS = [
  "black", "white", "cream", "gray", "beige", "brown", "red", "pink", "orange",
  "yellow", "green", "blue", "navy", "purple", "metallic", "multicolor",
];
const PATTERNS = [
  "solid", "striped", "plaid", "checked", "floral", "polka dot", "animal print",
  "camo", "graphic", "tie-dye", "abstract print", "other",
];

// ---------- small helpers ----------

// JSON-LD can be a single object, an array, or wrapped in "@graph".
function findProduct(node) {
  if (!node || typeof node !== "object") return null;
  if (Array.isArray(node)) return node.map(findProduct).find(Boolean) ?? null;
  const type = [node["@type"]].flat();
  if (type.includes("Product") || type.includes("ProductGroup")) return node;
  return findProduct(node["@graph"]);
}

// "image" can be a string, an object with .url, or an array of either
function imageUrl(img) {
  return typeof img === "string" ? img : img?.url ?? img?.contentUrl ?? null;
}
function firstImage(img) {
  return imageUrl(Array.isArray(img) ? img[0] : img);
}

// Product images are sometimes "//cdn..." or "/images/..." — make them full URLs
function absoluteUrl(src, pageUrl) {
  try { return src ? new URL(src, pageUrl).href : null; } catch { return null; }
}

// Turns "$49.00" or "49,00" into 49
function toNumber(value) {
  if (value == null) return null;
  const n = Number(String(value).replace(/[^0-9.,]/g, "").replace(",", "."));
  return Number.isFinite(n) && n > 0 ? n : null;
}

// Pulls the first JSON object or array out of an AI reply, even if it added extra words
function parseJSON(text, kind = "object") {
  const [open, close] = kind === "array" ? ["[", "]"] : ["{", "}"];
  const cleaned = text.replace(/```json|```/g, "");
  const start = cleaned.indexOf(open);
  const end = cleaned.lastIndexOf(close);
  if (start === -1 || end === -1) throw new Error("No JSON found in AI reply");
  return JSON.parse(cleaned.slice(start, end + 1));
}

// Text from all text blocks in a Claude response
function replyText(message) {
  return message.content.filter((b) => b.type === "text").map((b) => b.text).join("");
}

async function askHaiku(content, maxTokens = 300) {
  const ai = await anthropic.messages.create({
    model: LABEL_MODEL,
    max_tokens: maxTokens,
    messages: [{ role: "user", content }],
  });
  return parseJSON(replyText(ai));
}

// ---------- loading a product page ----------

async function loadPage(url) {
  const page = await fetch(url, { headers: BROWSER_HEADERS, signal: AbortSignal.timeout(10000) });
  if (!page.ok) {
    const err = new Error(`That store blocked the request (status ${page.status})`);
    err.status = 502;
    throw err;
  }
  const $ = cheerio.load(await page.text());
  const meta = (key) => $(`meta[property="${key}"], meta[name="${key}"]`).attr("content");

  let product = null;
  $('script[type="application/ld+json"]').each((_, el) => {
    try { product ??= findProduct(JSON.parse($(el).text())); } catch { /* skip bad JSON */ }
  });
  return { $, meta, product };
}

function baseItem(url, { $, meta, product }) {
  const offers = product?.offers ?? product?.hasVariant?.[0]?.offers;
  const offer = Array.isArray(offers) ? offers[0] : offers;
  return {
    url,
    name: product?.name ?? meta("og:title") ?? $("title").text().trim(),
    image: absoluteUrl(firstImage(product?.image) ?? meta("og:image"), url),
    price: toNumber(offer?.price ?? offer?.lowPrice ?? meta("product:price:amount")),
    currency: offer?.priceCurrency ?? meta("product:price:currency") ?? null,
    description: product?.description ?? meta("og:description") ?? "",
    storeColor: product?.color ?? null, // a hint for the AI, not trusted as the real color
  };
}

// ---------- finding a specific color variant ----------
//
// Many product pages default to one color. We try, in order:
//   1. Shopify stores: every product has a hidden "<product-url>.js" file listing all variants,
//      each with its own link (?variant=123) and usually its own image.
//   2. Structured data (JSON-LD "hasVariant") on other stores.
//   3. If neither exists: look through every image on the page and let AI pick the one
//      that shows the item in the wanted color. (Correct image, but the link opens the default color.)

async function shopifyVariants(url) {
  const u = new URL(url);
  if (!u.pathname.includes("/products/")) return null;
  const res = await fetch(`${u.origin}${u.pathname.replace(/\/$/, "")}.js`, {
    headers: BROWSER_HEADERS,
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok || !(res.headers.get("content-type") ?? "").includes("json")) return null;
  const data = await res.json();
  if (!Array.isArray(data.variants)) return null;

  return data.variants.map((v) => ({
    label: v.title ?? [v.option1, v.option2, v.option3].filter(Boolean).join(" / "),
    url: `${u.origin}/products/${data.handle}?variant=${v.id}`,
    image: absoluteUrl(v.featured_image?.src ?? null, url),
    price: v.price != null ? v.price / 100 : null, // Shopify .js prices are in cents
    available: v.available,
  }));
}

function jsonLdVariants(product, pageUrl) {
  return [product?.hasVariant].flat().filter(Boolean).map((v) => {
    const offer = Array.isArray(v.offers) ? v.offers[0] : v.offers;
    return {
      label: [v.color, v.size, v.name].filter(Boolean).join(" / "),
      url: absoluteUrl(v.url ?? offer?.url, pageUrl),
      image: absoluteUrl(firstImage(v.image), pageUrl),
      price: toNumber(offer?.price),
      available: offer?.availability ? !/OutOfStock/i.test(offer.availability) : undefined,
    };
  });
}

// AI reads the variant names ("Blush / M", "Rose Quartz / S"...) and picks the best match
async function pickVariant(variants, color, size) {
  const list = variants.slice(0, 150)
    .map((v, i) => `${i}: ${v.label}${v.available === false ? " (sold out)" : ""}`)
    .join("\n");

  const answer = await askHaiku(`A shopper wants this product in the color "${color}"${size ? `, size ${size}` : ""}.
Here are the store's variants:
${list}

Pick the variant whose COLOR matches "${color}". Shades and marketing names count
(e.g. for pink: blush, rose, fuchsia, bubblegum, "Pink Lemonade"). Pattern names alone are not colors.
Prefer the requested size and in-stock variants when several match.
If no variant is that color, use null.

Return ONLY JSON: {"index": number or null}`);

  const i = answer.index;
  return Number.isInteger(i) && i >= 0 && i < variants.length ? i : null;
}

// Every plausible product photo on the page
function pageImages($, product, pageUrl) {
  const srcs = [];
  [product?.image].flat().forEach((img) => srcs.push(imageUrl(img)));
  $("img").each((_, el) => {
    const $el = $(el);
    srcs.push(
      $el.attr("src") ||
      $el.attr("data-src") ||
      ($el.attr("srcset") || $el.attr("data-srcset") || "").split(",").pop()?.trim().split(" ")[0]
    );
  });
  const unique = [...new Set(srcs.map((s) => absoluteUrl(s, pageUrl)).filter(Boolean))];
  return unique
    .filter((s) => s.startsWith("https://"))
    .filter((s) => !/\.svg|logo|icon|sprite|payment|badge|flag|avatar|placeholder/i.test(s))
    .slice(0, 12);
}

// Downloads an image ourselves (stores often block other sites from loading their images)
async function fetchImage(src, timeout = 6000) {
  const res = await fetch(src, { headers: BROWSER_HEADERS, signal: AbortSignal.timeout(timeout) });
  const type = (res.headers.get("content-type") ?? "").split(";")[0];
  if (!res.ok || !["image/jpeg", "image/png", "image/gif", "image/webp"].includes(type)) {
    throw new Error(`Image unavailable (status ${res.status}, type ${type || "unknown"})`);
  }
  return { type, buffer: Buffer.from(await res.arrayBuffer()) };
}

// Same, but as base64 for sending to Claude. Returns null instead of throwing.
async function downloadImage(src) {
  try {
    const { type, buffer } = await fetchImage(src);
    if (buffer.length > 3_500_000) return null; // too big to send
    return { src, type, data: buffer.toString("base64") };
  } catch {
    return null;
  }
}

// AI looks at all the page's photos and picks the one showing the wanted color.
// Returns the image URL, null if it checked and none match, or undefined if it couldn't check.
async function pickImage(images, color, itemName) {
  const downloaded = (await Promise.all(images.map(downloadImage))).filter(Boolean);
  if (!downloaded.length) return undefined;

  const content = [];
  downloaded.forEach((img, i) => {
    content.push({ type: "text", text: `Image ${i}:` });
    content.push({ type: "image", source: { type: "base64", media_type: img.type, data: img.data } });
  });
  content.push({
    type: "text",
    text: `These are photos from the product page for "${itemName}".
Which image best shows THIS product in the color "${color}"? Prefer a clear product shot of the
garment itself over lifestyle photos, swatches, or other products. If none show it in that color, use null.

Return ONLY JSON: {"index": number or null}`,
  });

  const answer = await askHaiku(content);
  const i = answer.index;
  return Number.isInteger(i) && i >= 0 && i < downloaded.length ? downloaded[i].src : null;
}

// Returns { url, image, price, variantName, matched } where matched is:
//   "link"    → found the variant; url opens the store with that color selected
//   "image"   → found a photo in that color, but the store has no separate link for it
//   "none"    → checked, and this product doesn't seem to come in that color
//   "unknown" → couldn't check (no variant data, photos wouldn't load) — kept, shown as-is
async function resolveVariant({ url, page, item, color, size }) {
  let variants = null;
  try { variants = await shopifyVariants(url); } catch { /* not Shopify */ }
  if (!variants?.length) variants = jsonLdVariants(page.product, url);

  let variantsSayNo = false;
  if (variants.length) {
    let index;
    try {
      index = await pickVariant(variants, color, size);
    } catch (err) {
      console.error(`  variant pick failed for ${url}:`, err.message);
    }
    if (index != null) {
      const v = variants[index];
      let image = v.image;
      if (!image) image = await pickImage(pageImages(page.$, page.product, url), color, item.name).catch(() => undefined);
      return { url: v.url ?? url, image: image ?? item.image, price: v.price, variantName: v.label, matched: "link" };
    }
    if (index === null) variantsSayNo = true; // AI read the variant list and found no such color
  }

  let image;
  try {
    image = await pickImage(pageImages(page.$, page.product, url), color, item.name);
  } catch (err) {
    console.error(`  image pick failed for ${url}:`, err.message);
  }
  if (image) return { url, image, price: null, variantName: null, matched: "image" };

  const checked = variantsSayNo || image === null;
  return { url, image: item.image, price: null, variantName: null, matched: checked ? "none" : "unknown" };
}

// ---------- AI labeling (color, pattern, category) ----------

function buildLabelPrompt(item, pageText) {
  return `You are labeling a clothing product for a wishlist app.

Product name: ${item.name}
Store's color/variant name (may be a marketing name or a pattern, not a real color): ${item.storeColor ?? "none"}
Description: ${item.description}
Known price: ${item.price ?? "unknown"}
Page text excerpt: ${pageText}

Rules for color:
- "color" is the single dominant base color of the garment fabric — what most of the item is.
- Pattern words (striped, floral, plaid, print, camo, etc.) are NEVER colors. Put them in "pattern".
- Store names like "Ocean Breeze", "Oatmeal Heather", or "Navy Stripe" must be translated:
  "Navy Stripe" → color "navy", pattern "striped". "Oatmeal Heather" → color "beige".
- If an image is provided, trust what you see in the image over the text.
- Ignore the background, the model's skin, and other garments in the photo.
- Use "multicolor" only if no single color covers most of the garment.

Return ONLY a JSON object, no other text:
{"category": one of ${JSON.stringify(CATEGORIES)},
 "color": one of ${JSON.stringify(COLORS)},
 "colorDetail": a more specific shade in 1-3 words (e.g. "dusty rose", "forest green"),
 "secondaryColor": one of ${JSON.stringify(COLORS)} or null,
 "pattern": one of ${JSON.stringify(PATTERNS)},
 "material": main fabric or material in 1-3 words (e.g. "linen", "cotton denim", "leather"), or null if unknown,
 "price": number or null (only if clearly stated in the text),
 "descriptors": up to 4 short style words (e.g. "cropped", "relaxed fit", "oversized")}`;
}

async function enrichWithAI(item, pageText) {
  const prompt = buildLabelPrompt(item, pageText);

  if (item.image) {
    const img = await downloadImage(item.image);
    if (img) {
      try {
        return await askHaiku([
          { type: "image", source: { type: "base64", media_type: img.type, data: img.data } },
          { type: "text", text: prompt },
        ], 400);
      } catch (err) {
        console.error("AI with image failed, retrying text-only:", err.message);
      }
    }
  }

  try {
    return await askHaiku(prompt, 400);
  } catch (err) {
    console.error("AI labeling failed:", err.message);
    return {}; // fall back to whatever the page itself gave us
  }
}

// ---------- reading one product, start to finish ----------
// enrich=false skips the labeling step (search uses this for fast preview cards).
// color/size: try to switch to that variant first.

async function scrapeProduct(url, { enrich = true, color = null, size = null } = {}) {
  const page = await loadPage(url);
  let item = baseItem(url, page);

  if (color) {
    const v = await resolveVariant({ url, page, item, color, size });
    item = {
      ...item,
      url: v.url,
      image: v.image,
      price: v.price ?? item.price,
      storeColor: v.variantName ?? item.storeColor,
      variantName: v.variantName,
      matched: v.matched,
    };
  }

  if (!enrich) return item;

  const pageText = page.$("body").text().replace(/\s+/g, " ").slice(0, 4000);
  const extra = await enrichWithAI(item, pageText);

  return {
    ...item,
    price: item.price ?? toNumber(extra.price),
    color: COLORS.includes(extra.color) ? extra.color : null,
    colorDetail: extra.colorDetail ?? null,
    secondaryColor: COLORS.includes(extra.secondaryColor) ? extra.secondaryColor : null,
    pattern: PATTERNS.includes(extra.pattern) ? extra.pattern : null,
    material: typeof extra.material === "string" ? extra.material : null,
    subcategory: CATEGORIES.includes(extra.category) ? extra.category : "other",
    category: TYPE_OF[extra.category] ?? "Accessories",
    descriptors: Array.isArray(extra.descriptors) ? extra.descriptors : [],
  };
}

// ---------- web search ----------

// Stores that blocked us during this server session. Future searches skip them,
// so the search spends its effort on stores whose pages we can actually read.
// (Resets when the server restarts.)
const blockedStores = new Set();

function storeOf(url) {
  try { return new URL(url).hostname.replace(/^www\./, ""); } catch { return null; }
}

async function searchWebForProducts({ q, minPrice, maxPrice, size, count }) {
  const filters = [
    minPrice && `price at least $${minPrice}`,
    maxPrice && `price at most $${maxPrice}`,
    size && `available in size ${size} (prefer listings that show this size in stock)`,
  ].filter(Boolean).join("; ") || "none";

  // Ask for about twice as many as we need, since some will be blocked or filtered out
  const wanted = Math.min(count * 2, 20);

  const messages = [{
    role: "user",
    content: `Find ${wanted} real clothing products a shopper could buy right now online that match: "${q}".
Filters: ${filters}.

The request may be a specific item ("pink shorts", "leather trench coat") or a style or occasion
("business casual", "90s streetwear", "beach wedding guest"). For a style, find a MIX of different
pieces that fit it (tops, bottoms, outerwear, shoes, accessories) rather than one kind of item.

How to search:
- Run several DIFFERENT searches, not one. Vary the wording (e.g. add a material, fit, or style),
  and look beyond the first big retailers: independent brands, boutiques, and smaller online stores
  (many run on Shopify) are very welcome.
- Spread results across as many different stores as possible: AT MOST ONE product per store
  unless you truly cannot find enough stores.
- Avoid marketplaces and aggregators (Amazon, eBay, Etsy, Google Shopping, Lyst, ShopStyle, Pinterest).

Rules:
- Every result must be an individual PRODUCT PAGE (one item you can add to cart), not a category page,
  search results page, blog post, or "best of" article.
- If the shopper asked for a color, the product must be sold in that color. It's fine if the page
  opens on a different color by default.
- Respect the price filters; skip items clearly outside them.
- Only include URLs you actually saw in search results. Never guess or construct URLs.
- Use US-dollar prices when shown.

Return ONLY a JSON object, no other text:
{"targetColor": the color the shopper asked for in plain words, or null if none,
 "itemType": one of ${JSON.stringify(TYPES)} if the request is one kind of item, or null for a style/mix,
 "results": [{"name": string, "url": string, "store": string, "price": number or null,
              "category": one of ${JSON.stringify(TYPES)}}]}`,
  }];

  const searchTool = { type: "web_search_20250305", name: "web_search", max_uses: 10 };
  const skipDomains = [
    "amazon.com", "ebay.com", "etsy.com", "lyst.com", "shopstyle.com", "pinterest.com",
    ...blockedStores,
  ];
  searchTool.blocked_domains = [...new Set(skipDomains)].slice(0, 50);

  // Server tools can occasionally pause on long searches ("pause_turn");
  // when that happens we send the reply back so Claude can finish.
  let response;
  for (let attempt = 0; attempt < 3; attempt++) {
    response = await anthropic.messages.create({
      model: SEARCH_MODEL,
      max_tokens: 4000,
      tools: [searchTool],
      messages,
    });
    if (response.stop_reason !== "pause_turn") break;
    messages.push({ role: "assistant", content: response.content });
  }

  const data = parseJSON(replyText(response));
  const results = (Array.isArray(data.results) ? data.results : [])
    .filter((r) => typeof r?.url === "string" && /^https?:\/\//.test(r.url));
  return {
    targetColor: data.targetColor || null,
    itemType: TYPES.includes(data.itemType) ? data.itemType : null,
    results,
  };
}

// ---------- routes ----------

// Quick check that the server is up: visit /
app.get("/", (req, res) => res.send("Wishlist backend is running"));

// One product link → full details
app.get("/api/scrape", async (req, res) => {
  const url = req.query.url;
  if (!url || !/^https?:\/\//.test(url)) {
    return res.status(400).json({ error: "Please provide a full product link starting with http" });
  }
  const color = req.query.color ? String(req.query.color).slice(0, 40) : null;
  const size = req.query.size ? String(req.query.size).slice(0, 20) : null;

  try {
    res.json(await scrapeProduct(url, { color, size }));
  } catch (err) {
    console.error(err);
    res.status(err.status ?? 500).json({ error: err.status ? err.message : "Couldn't read that page" });
  }
});

// General item → list of real products from the web
app.get("/api/search", async (req, res) => {
  const q = String(req.query.q ?? "").trim();
  if (!q) return res.status(400).json({ error: "Please describe an item, e.g. ?q=pink shorts" });

  const minPrice = toNumber(req.query.minPrice);
  const maxPrice = toNumber(req.query.maxPrice);
  const size = req.query.size ? String(req.query.size).slice(0, 20) : null;
  const count = Math.min(Math.max(Number(req.query.count) || 8, 1), 12);

  try {
    // 1. Claude searches the web and picks candidate product pages
    const { targetColor, itemType, results: candidates } = await searchWebForProducts({ q, minPrice, maxPrice, size, count });

    // 2. Visit each page ourselves: real image and price, switch to the wanted color, drop dead links.
    //    All pages are processed at the same time so this stays reasonably fast.
    const checked = await Promise.allSettled(
      candidates.map(async (c) => {
        const page = await scrapeProduct(c.url, { enrich: false, color: targetColor, size });
        return {
          name: page.name || c.name,
          url: page.url,
          store: c.store ?? new URL(c.url).hostname.replace(/^www\./, ""),
          image: page.image,
          price: page.price ?? toNumber(c.price),
          currency: page.currency ?? "USD",
          variantName: page.variantName ?? null,
          matched: page.matched ?? null,
          category: TYPES.includes(c.category) ? c.category : itemType,
          color: targetColor,
        };
      })
    );

    // 3. Keep pages that loaded, have an image, come in the wanted color, and fit the price filter.
    //    Everything dropped goes in "skipped" with the reason, so you can see what happened.
    const MAX_PER_STORE = 2;
    const seen = new Set();
    const perStore = {};
    const results = [];
    const skipped = [];

    checked.forEach((r, i) => {
      const url = candidates[i].url;
      const store = storeOf(url);
      if (r.status === "rejected") {
        if (r.reason?.status === 502 && store) blockedStores.add(store); // skip this store in future searches
        const reason = r.reason?.name === "TimeoutError" ? "page took too long to load" : r.reason?.message ?? "failed to load";
        return skipped.push({ url, reason });
      }
      const p = r.value;
      if (!p.image) return skipped.push({ url, reason: "no product image found on page" });
      if (targetColor && p.matched === "none") return skipped.push({ url, reason: `not sold in ${targetColor}` });
      if (p.price != null && minPrice && p.price < minPrice) return skipped.push({ url, reason: `price $${p.price} under minimum` });
      if (p.price != null && maxPrice && p.price > maxPrice) return skipped.push({ url, reason: `price $${p.price} over maximum` });
      if (seen.has(p.url)) return skipped.push({ url, reason: "duplicate" });
      if ((perStore[store] ?? 0) >= MAX_PER_STORE) return skipped.push({ url, reason: `already have ${MAX_PER_STORE} from ${store}` });
      if (results.length >= count) return skipped.push({ url, reason: "extra (already have enough results)" });
      seen.add(p.url);
      perStore[store] = (perStore[store] ?? 0) + 1;
      results.push(p);
    });

    const storesUsed = Object.keys(perStore);
    console.log(`Search "${q}": ${candidates.length} candidates from ${new Set(candidates.map((c) => storeOf(c.url))).size} stores, ${results.length} kept from ${storesUsed.length} stores`);
    if (blockedStores.size) console.log(`  stores skipped in future searches: ${[...blockedStores].join(", ")}`);
    skipped.forEach((s) => console.log(`  skipped ${s.url} — ${s.reason}`));

    res.json({
      query: q,
      targetColor,
      itemType,
      filters: { minPrice, maxPrice, size },
      candidatesFound: candidates.length,
      storesUsed,
      results,
      skipped,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Search failed. Try again or rephrase the item." });
  }
});

// ---------- background removal ----------
//
// Two options:
//   • Default: @imgly/background-removal-node runs an AI model right on this server. Free, no key.
//     The first image takes longer while the model loads.
//   • If REMOVE_BG_API_KEY is set in .env, uses the remove.bg service instead (faster, lighter on
//     the server, limited free credits).

const bgCache = new Map();      // image URL → PNG buffer, so each image is only processed once
let bgQueue = Promise.resolve(); // process one image at a time so the server doesn't run out of memory

async function removeBackgroundPng({ buffer, type }) {
  if (process.env.REMOVE_BG_API_KEY) {
    const form = new FormData();
    form.append("image_file", new Blob([buffer], { type }), "image");
    form.append("size", "auto");
    const res = await fetch("https://api.remove.bg/v1.0/removebg", {
      method: "POST",
      headers: { "X-Api-Key": process.env.REMOVE_BG_API_KEY },
      body: form,
    });
    if (!res.ok) throw new Error(`remove.bg error ${res.status}: ${await res.text()}`);
    return Buffer.from(await res.arrayBuffer());
  }
  const { removeBackground } = await import("@imgly/background-removal-node");
  const blob = await removeBackground(new Blob([buffer], { type }));
  return Buffer.from(await blob.arrayBuffer());
}

app.get("/api/remove-bg", async (req, res) => {
  const src = req.query.url;
  if (!src || !/^https?:\/\//.test(src)) return res.status(400).send("Missing image url");

  try {
    let png = bgCache.get(src);
    if (!png) {
      const job = bgQueue.then(async () => removeBackgroundPng(await fetchImage(src, 10000)));
      bgQueue = job.catch(() => {}); // keep the queue moving even if this one fails
      png = await job;
      bgCache.set(src, png);
      if (bgCache.size > 200) bgCache.delete(bgCache.keys().next().value); // forget the oldest
    }
    res.set("Content-Type", "image/png");
    res.set("Cache-Control", "public, max-age=604800"); // browsers can keep it for a week
    res.send(png);
  } catch (err) {
    console.error("Background removal failed:", err.message);
    res.redirect(src); // fall back to the original image so something still shows
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on http://localhost:${PORT}`));  