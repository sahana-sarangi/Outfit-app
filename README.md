# Wishlist & Outfit Modeler

A clothing wishlist for people who shop online across lots of stores. Paste a product link and it pulls in the photo, name, price, and tags automatically. Describe something you're looking for, like "pink shorts," and AI searches real stores for options. Then try pieces together on a mannequin before you buy.

Built by [@eldenmartial](https://github.com/eldenmartial) and [@sahana-sarangi](https://github.com/sahana-sarangi).

## Features

**Wishlist**
- **Add by link:** paste any product URL. The app reads the page and fills in the image, name, price, and store, then uses AI to tag the item's color, material, pattern, and type (tops, bottoms, outerwear, shoes, accessories). Click a card to open the item in its store.
- **Add a general idea:** type something like "pink shorts" or "leather trench coat." The app searches real online stores and the card rotates through the options it finds.
- **Discover and save:** open a general idea to browse options with price and size filters, save the ones you like, and move any saved option onto your main wishlist with a link to the store.
- **Search and filter:** find items by name, store, color, material, or style, filter by type and color, and sort by price or date.
- **Graveyard:** move items you've bought or no longer want out of the way, and restore them anytime.

**Outfit modeler**
- Click or drag wishlist items onto a mannequin. Each piece lands in the right spot (head, top, bottoms, shoes, accessories) with its background removed.
- Click a general idea to browse all its options, or use AI search to find new pieces right in the modeler.
- A running total shows what the whole outfit costs.

Your wishlist is saved in your browser (`localStorage`), so it stays between visits on the same device.

## How it works

```
GitHub Pages (index.html)  →  Node.js server on Render  →  Claude API (search + tagging)
                                        ↓                   store product pages
                                   remove.bg (optional)
```

The frontend is a single static page on GitHub Pages. Anything that needs secret API keys or has to read other websites happens on the backend, a small Express server:

- **Link scraping** reads a product page's structured data (JSON-LD and Open Graph tags) for the name, image, and price, then asks Claude to label color, material, pattern, and category from the photo and text.
- **Search** uses Claude with web search to find real product pages, then the server visits each page to confirm the image and price, drops dead or blocked links, and filters by price.
- **Color variants:** if you search for pink shorts and a product page defaults to blue, the server looks for the pink version. On Shopify stores it finds a direct link to that color; elsewhere it picks the product photo that shows it.
- **Background removal** turns product photos into cutouts for the mannequin, using remove.bg if a key is set or a free on-server model otherwise.

## Project structure

```
Outfit app/
├── index.html              # the whole frontend (HTML, CSS, JavaScript)
├── wishlist-backend/
│   ├── server.js           # Express server with all API endpoints
│   ├── package.json
│   └── .env                # API keys (local only, never committed)
├── rough wireframe.png
└── README.md
```

## Running it locally

**Requirements:** Node.js 20 or newer, and a Claude API key with credits and web search enabled.

1. Install the backend's dependencies:
   ```bash
   cd wishlist-backend
   npm install
   ```
2. Create `wishlist-backend/.env`:
   ```
   ANTHROPIC_API_KEY=your-claude-api-key
   REMOVE_BG_API_KEY=your-remove-bg-key   # optional
   ```
3. Start the server:
   ```bash
   npm run dev
   ```
   Visiting `http://localhost:3000` should show "Wishlist backend is running."
4. In `index.html`, set the backend address near the top of the script:
   ```js
   const API = "http://localhost:3000";
   ```
5. Open `index.html` with VS Code's **Live Server** extension. Opening the file directly (a `file://` address) won't work.

## Deploying

**Backend (Render):** create a Web Service from this repo with:
- Root Directory: `wishlist-backend`
- Build Command: `npm install`
- Start Command: `npm start`
- Environment variables: `ANTHROPIC_API_KEY`, and optionally `REMOVE_BG_API_KEY`

**Frontend (GitHub Pages):** set `API` in `index.html` to the Render URL, with no trailing slash, and push.

## API endpoints

| Endpoint | What it does |
|---|---|
| `GET /api/scrape?url=…` | Details and tags for one product link. Optional `&color=pink&size=M` jumps to that variant. |
| `GET /api/search?q=…` | Real products matching a description. Optional `minPrice`, `maxPrice`, `size`, `count`. |
| `GET /api/remove-bg?url=…` | The image at that URL as a PNG with its background removed. |

## Known limitations

- Some large retailers block automated requests or load their product info with JavaScript, so their links can't be added automatically.
- Render's free tier sleeps after about 15 minutes of inactivity; the first request afterward takes 30–60 seconds.
- The size filter is a preference, not a guarantee, since most stores don't show stock levels to automated requests.
- The mannequin layers background-removed product photos rather than generating an image of someone wearing the outfit.
- Wishlists are stored per browser, so they don't sync between devices.