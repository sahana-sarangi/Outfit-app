// server.js — backend for the clothing wishlist app
//
// Endpoints:
//   GET /api/scrape?url=...   → details for one product link (image, price, color, pattern, category...)
//   GET /api/search?q=...     → searches the web for real products matching a general item
//                               optional: &minPrice=20&maxPrice=60&size=M&count=8

import express from "express";
import cors from "cors";
import * as cheerio from "cheerio";
import Anthropic from "@anthropic-ai/sdk";

const app = express();

// CHANGE "YOURNAME" to your GitHub username. No trailing slash.
app.use(cors({
  origin: [
    "https://eldenmartial.github.io",
    "http://localhost:5500",   // VS Code Live Server
    "http://127.0.0.1:5500",
  ],
}));

const anthropic = new Anthropic(); // reads ANTHROPIC_API_KEY from the environment

// Cheap, fast model for labeling one product
const LABEL_MODEL = "claude-haiku-5-5";
// Smarter model for web searching (better at judging which results are real product pages)
const SEARCH_MODEL = "claude-sonnet-5-5";

// ---------- fixed label lists (keep values consistent for filtering) ----------

const CATEGORIES = [
  "t-shirt", "shirt", "sweater", "hoodie", "jacket", "coat",
  "pants", "jeans", "shorts", "skirt", "dress", "shoes", "bag", "accessory", "other",
];
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

// "image" can be a string, an array of strings, or an object with .url
function firstImage(img) {
  const first = Array.isArray(img) ? img[0] : img;
  return typeof first === "string" ? first : first?.url;
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
 "price": number or null (only if clearly stated in the text),
 "descriptors": up to 4 short style words (e.g. "cropped", "wool", "oversized")}`;
}

async function askLabeler(content) {
  const ai = await anthropic.messages.create({
    model: LABEL_MODEL,
    max_tokens: 400,
    messages: [{ role: "user", content }],
  });
  return parseJSON(replyText(ai));
}

// Sends the product image when there is one, since color is easiest to judge visually.
async function enrichWithAI(item, pageText) {
  const prompt = buildLabelPrompt(item, pageText);

  if (item.image) {
    try {
      return await askLabeler([
        { type: "image", source: { type: "url", url: item.image } },
        { type: "text", text: prompt },
      ]);
    } catch (err) {
      console.error("AI with image failed, retrying text-only:", err.message);
    }
  }

  try {
    return await askLabeler(prompt);
  } catch (err) {
    console.error("AI labeling failed:", err.message);
    return {}; // fall back to whatever the page itself gave us
  }
}

// ---------- reading one product page ----------
// Used by both endpoints. With enrich=false it skips the AI step (faster, cheaper),
// which is what search uses for its preview cards.

async function scrapeProduct(url, { enrich = true } = {}) {
  const page = await fetch(url, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Safari/537.36",
      "Accept-Language": "en-US,en;q=0.9",
    },
    signal: AbortSignal.timeout(10000), // give up after 10 seconds
  });
  if (!page.ok) {
    const err = new Error(`That store blocked the request (status ${page.status})`);
    err.status = 502;
    throw err;
  }

  const $ = cheerio.load(await page.text());
  const meta = (key) => $(`meta[property="${key}"], meta[name="${key}"]`).attr("content");

  // Structured product data (JSON-LD), if the page has it
  let product = null;
  $('script[type="application/ld+json"]').each((_, el) => {
    try { product ??= findProduct(JSON.parse($(el).text())); } catch { /* skip bad JSON */ }
  });
  const offers = product?.offers ?? product?.hasVariant?.[0]?.offers;
  const offer = Array.isArray(offers) ? offers[0] : offers;

  // Build the item, falling back to Open Graph tags
  const item = {
    url,
    name: product?.name ?? meta("og:title") ?? $("title").text().trim(),
    image: absoluteUrl(firstImage(product?.image) ?? meta("og:image"), url),
    price: toNumber(offer?.price ?? offer?.lowPrice ?? meta("product:price:amount")),
    currency: offer?.priceCurrency ?? meta("product:price:currency") ?? null,
    description: product?.description ?? meta("og:description") ?? "",
    storeColor: product?.color ?? null, // a hint for the AI, not trusted as the real color
  };

  if (!enrich) return item;

  const pageText = $("body").text().replace(/\s+/g, " ").slice(0, 4000);
  const extra = await enrichWithAI(item, pageText);

  return {
    ...item,
    price: item.price ?? toNumber(extra.price),
    color: COLORS.includes(extra.color) ? extra.color : null,
    colorDetail: extra.colorDetail ?? null,
    secondaryColor: COLORS.includes(extra.secondaryColor) ? extra.secondaryColor : null,
    pattern: PATTERNS.includes(extra.pattern) ? extra.pattern : null,
    category: CATEGORIES.includes(extra.category) ? extra.category : "other",
    descriptors: Array.isArray(extra.descriptors) ? extra.descriptors : [],
  };
}

// ---------- web search ----------

async function searchWebForProducts({ q, minPrice, maxPrice, size, count }) {
  const filters = [
    minPrice && `price at least $${minPrice}`,
    maxPrice && `price at most $${maxPrice}`,
    size && `available in size ${size} (prefer listings that show this size in stock)`,
  ].filter(Boolean).join("; ") || "none";

  const messages = [{
    role: "user",
    content: `Find ${count} real clothing products a shopper could buy right now online that match: "${q}".
Filters: ${filters}.

Rules:
- Every result must be an individual PRODUCT PAGE (one item you can add to cart), not a category page,
  search results page, blog post, or "best of" article.
- Only include URLs you actually saw in search results. Never guess or construct URLs.
- Prefer a variety of stores and price points within the filters.
- Use US-dollar prices when shown.

Return ONLY a JSON array, no other text:
[{"name": string, "url": string, "store": string, "price": number or null}]`,
  }];

  // Server tools can occasionally pause on long searches ("pause_turn");
  // when that happens we send the reply back so Claude can finish.
  let response;
  for (let attempt = 0; attempt < 3; attempt++) {
    response = await anthropic.messages.create({
      model: SEARCH_MODEL,
      max_tokens: 3000,
      tools: [{ type: "web_search_20250305", name: "web_search", max_uses: 5 }],
      messages,
    });
    if (response.stop_reason !== "pause_turn") break;
    messages.push({ role: "assistant", content: response.content });
  }

  const results = parseJSON(replyText(response), "array");
  return results.filter((r) => typeof r?.url === "string" && /^https?:\/\//.test(r.url));
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
  try {
    res.json(await scrapeProduct(url));
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
    const candidates = await searchWebForProducts({ q, minPrice, maxPrice, size, count });

    // 2. Visit each page ourselves to get the real image and price, and to drop dead links.
    //    All pages are fetched at the same time so this stays reasonably fast.
    const checked = await Promise.allSettled(
      candidates.map(async (c) => {
        const page = await scrapeProduct(c.url, { enrich: false });
        return {
          name: page.name || c.name,
          url: c.url,
          store: c.store ?? new URL(c.url).hostname.replace(/^www\./, ""),
          image: page.image,
          price: page.price ?? toNumber(c.price),
          currency: page.currency ?? "USD",
        };
      })
    );

    // 3. Keep pages that loaded, have an image, and fit the price filter
    const seen = new Set();
    const results = checked
      .filter((r) => r.status === "fulfilled")
      .map((r) => r.value)
      .filter((p) => p.image)
      .filter((p) => p.price == null || ((!minPrice || p.price >= minPrice) && (!maxPrice || p.price <= maxPrice)))
      .filter((p) => {
        const key = p.url.split("?")[0];
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });

    res.json({ query: q, filters: { minPrice, maxPrice, size }, results });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Search failed. Try again or rephrase the item." });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on http://localhost:${PORT}`));