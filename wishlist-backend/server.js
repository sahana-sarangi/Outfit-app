// server.js — backend for the clothing wishlist app
// Takes a product link, returns { name, image, price, currency, color, category, descriptors }

import express from "express";
import cors from "cors";
import * as cheerio from "cheerio";
import Anthropic from "@anthropic-ai/sdk";

const app = express();


app.use(cors({
  origin: [
    "https://eldenmartial.github.io",
    "http://localhost:5500",   // VS Code Live Server
    "http://127.0.0.1:5500",
  ],
}));

const anthropic = new Anthropic(); // reads ANTHROPIC_API_KEY from the environment

const CATEGORIES = [
  "t-shirt", "shirt", "sweater", "hoodie", "jacket", "coat",
  "pants", "jeans", "shorts", "skirt", "dress", "shoes", "bag", "accessory", "other",
];

// ---------- helpers ----------

// JSON-LD can be a single object, an array, or wrapped in "@graph".
// This digs through it and returns the first Product it finds.
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

// Turns "$49.00" or "49,00" into 49
function toNumber(value) {
  if (value == null) return null;
  const n = Number(String(value).replace(/[^0-9.,]/g, "").replace(",", "."));
  return Number.isFinite(n) && n > 0 ? n : null;
}

// Asks Claude for color, category, and style words.
// Wrapped in its own try/catch so a bad AI response never breaks the whole request.
async function enrichWithAI(item, pageText) {
  try {
    const ai = await anthropic.messages.create({
      model: "claude-haiku-5-5",
      max_tokens: 300,
      messages: [{
        role: "user",
        content: `Product name: ${item.name}
Description: ${item.description}
Known price: ${item.price ?? "unknown"}
Page text excerpt: ${pageText}

Return ONLY a JSON object, no other text:
{"category": one of ${JSON.stringify(CATEGORIES)},
 "color": main color in plain words (e.g. "dusty pink"),
 "price": number or null (only if clearly stated in the text),
 "descriptors": up to 4 short style words (e.g. "cropped", "wool", "oversized")}`,
      }],
    });

    const raw = ai.content.map((b) => b.text ?? "").join("").replace(/```json|```/g, "").trim();
    return JSON.parse(raw);
  } catch (err) {
    console.error("AI step failed:", err.message);
    return {}; // fall back to whatever the page itself gave us
  }
}

// ---------- routes ----------

// Quick check that the server is up: visit /
app.get("/", (req, res) => res.send("Wishlist backend is running"));

// Main endpoint: /api/scrape?url=https://store.com/product
app.get("/api/scrape", async (req, res) => {
  const url = req.query.url;
  if (!url || !/^https?:\/\//.test(url)) {
    return res.status(400).json({ error: "Please provide a full product link starting with http" });
  }

  try {
    // 1. Download the product page, looking like a normal browser
    const page = await fetch(url, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Safari/537.36",
        "Accept-Language": "en-US,en;q=0.9",
      },
    });
    if (!page.ok) {
      return res.status(502).json({ error: `That store blocked the request (status ${page.status})` });
    }

    const $ = cheerio.load(await page.text());
    const meta = (key) => $(`meta[property="${key}"], meta[name="${key}"]`).attr("content");

    // 2. Read structured product data (JSON-LD) if the page has it
    let product = null;
    $('script[type="application/ld+json"]').each((_, el) => {
      try { product ??= findProduct(JSON.parse($(el).text())); } catch { /* skip bad JSON */ }
    });
    const offers = product?.offers ?? product?.hasVariant?.[0]?.offers;
    const offer = Array.isArray(offers) ? offers[0] : offers;

    // 3. Build the item, falling back to Open Graph tags
    const item = {
      url,
      name: product?.name ?? meta("og:title") ?? $("title").text().trim(),
      image: firstImage(product?.image) ?? meta("og:image") ?? null,
      price: toNumber(offer?.price ?? offer?.lowPrice ?? meta("product:price:amount")),
      currency: offer?.priceCurrency ?? meta("product:price:currency") ?? null,
      description: product?.description ?? meta("og:description") ?? "",
      color: product?.color ?? null,
    };

    // 4. Let AI fill in color, category, descriptors (and price if missing)
    const pageText = $("body").text().replace(/\s+/g, " ").slice(0, 4000);
    const extra = await enrichWithAI(item, pageText);

    res.json({
      ...item,
      price: item.price ?? toNumber(extra.price),
      color: item.color ?? extra.color ?? null,
      category: CATEGORIES.includes(extra.category) ? extra.category : "other",
      descriptors: Array.isArray(extra.descriptors) ? extra.descriptors : [],
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Couldn't read that page" });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on http://localhost:${PORT}`));