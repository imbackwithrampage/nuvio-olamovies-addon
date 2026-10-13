# Nuvio & Stremio OlaMovies Addon 🎬

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https://github.com/imbackwithrampage/nuvio-olamovies-addon)

A high-performance **Nuvio** and **Stremio** Addon service that scrapes and resolves 4K UHD, 1080p, 720p, HEVC, and multi-audio releases from **OlaMovies** (`https://v6.olamovies.mov`).

Repository: [https://github.com/imbackwithrampage/nuvio-olamovies-addon](https://github.com/imbackwithrampage/nuvio-olamovies-addon)

---

## ✨ Features

- **Standard Stremio / Nuvio Protocol**: Implements `manifest.json`, `catalog`, `meta`, and `stream` resources.
- **Movies & TV Series Catalogs**:
  - Live catalog feeds for newly released movies and TV series.
  - Search integration supporting keyword queries and IMDb ID lookups.
- **Deep Scraper & Parser**:
  - React Server Components (RSC) and HTML parser that extracts individual release blocks, resolutions (2160p 4K, 1080p, 720p), file sizes, codecs (HEVC, x265, 10bit), and audio tracks (Dual Audio Hindi, English Atmos, 5.1).
  - Intelligent TV series episode filter: automatically isolates episodes (e.g., S01E01) from multi-season collections.
- **IMDb ID Resolution**:
  - Automatically queries Cinemeta metadata for IMDb requests (`tt...`) to search and match the best OlaMovies releases.
- **High-Speed In-Memory Cache**:
  - Caches search queries, catalogs, and item details with smart TTLs to ensure instant playback and avoid rate limits.
- **Interactive Web Dashboard & Configurator**:
  - Modern dark-mode web interface at `http://localhost:7000/`.
  - One-click **"Add to Nuvio / Stremio"** installation button.
  - Live OlaMovies release explorer and stream tester.
  - Custom mirror configurator (in case OlaMovies shifts domains, e.g. from `v6.olamovies.mov` to `v7`).
  - Optional FlareSolverr and Debrid API key unlocker support.

---

## 🚀 Quick Start

### 1. Prerequisites
- **Node.js** v18+ (tested on Node v26)
- **Nuvio** or **Stremio** app installed on your device (Android TV, Google TV, Firestick, Windows, Mac, Linux, or Mobile)

### 2. Install & Start
```bash
# Install dependencies
npm install

# Start the addon server
npm start
```

The server will launch at:
- **Web Dashboard**: [http://localhost:7000](http://localhost:7000)
- **Manifest URL**: [http://localhost:7000/manifest.json](http://localhost:7000/manifest.json)
- **Nuvio / Stremio Deep Link**: `stremio://localhost:7000/manifest.json`

---

## 📲 How to Install in Nuvio or Stremio

### In Nuvio:
1. Open the **Nuvio** app on your device.
2. Go to **Settings** > **Add-ons** (or use the web dashboard / QR sync).
3. Paste your Addon Manifest URL:
   ```
   http://localhost:7000/manifest.json
   ```
   *(If running on a PC while using an Android TV/Firestick, replace `localhost` with your computer's local IP address, e.g. `http://192.168.1.50:7000/manifest.json`)*.
4. Click **Install**.

### In Stremio:
1. Open Stremio.
2. In the search bar or under **Add-ons** > **Community Add-ons**, paste:
   ```
   http://localhost:7000/manifest.json
   ```
   or simply open [http://localhost:7000](http://localhost:7000) in your browser and click **"Add to Nuvio / Stremio"**.
3. Confirm installation.

---

## 🛠️ API & Addon Endpoints

| Endpoint | Description |
|---|---|
| `GET /manifest.json` | Returns standard addon manifest with catalogs and types |
| `GET /catalog/:type/:id.json` | Returns movie or TV series catalog |
| `GET /catalog/:type/:id/:extra.json` | Catalog with search or pagination (`search=...`) |
| `GET /meta/:type/:id.json` | Detailed item metadata (`olamovies:...` or `tt...`) |
| `GET /stream/:type/:id.json` | Stream streams sorted by 4K > 1080p > 720p |
| `GET /resolve/:btnId` | Resolves download / hoster buttons |
| `GET /api/search?q=...` | JSON search endpoint for web client |
| `GET /api/status` | Live health, uptime, and cache statistics |

---

## ⚙️ Configuration & Environment Variables

You can configure options via environment variables or a `.env` file:

```env
PORT=7000
OLA_BASE_URL=https://v6.olamovies.mov
CACHE_TTL_MS=1800000
```

---

## 🧪 Running Tests
To run the automated scraper and stream test suite:
```bash
npm test
```
