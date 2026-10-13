const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');
const config = require('./config');
const { getManifest } = require('./manifest');
const scraper = require('./scraper');
const { resolveAllStreams } = require('./streams');
const { resolveLink } = require('./resolver');
const { getMetaFromCinemeta, searchCinemeta } = require('./cinemeta');
const cache = require('./cache');

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, '../public')));
app.use(express.static(path.join(process.cwd(), 'public')));

// Helper to parse user configuration from URL segment
function parseUserConfig(configParam) {
  if (!configParam) return {};
  try {
    const decoded = Buffer.from(configParam, 'base64').toString('utf8');
    if (decoded.startsWith('{') && decoded.endsWith('}')) {
      return JSON.parse(decoded);
    }
  } catch (e) {
    // Not base64 JSON
  }
  return {};
}

// Helper to determine protocol & host
function getRequestOrigin(req) {
  const protocol = req.headers['x-forwarded-proto'] || req.protocol || 'http';
  const host = req.headers['x-forwarded-host'] || req.get('host') || `localhost:${config.PORT}`;
  return { protocol, host };
}

// ----------------------------------------------------
// Manifest Routes
// ----------------------------------------------------
app.get(['/manifest.json', '/:config/manifest.json'], (req, res) => {
  const userConfig = parseUserConfig(req.params.config);
  res.setHeader('Cache-Control', 'max-age=86400, public');
  res.json(getManifest(userConfig));
});

// ----------------------------------------------------
// Catalog Routes
// ----------------------------------------------------
async function handleCatalog(req, res, userConfig) {
  const { type, id, extra } = req.params;
  const baseUrl = userConfig.baseUrl || config.BASE_URL;
  const proxy = userConfig.proxyUrl || userConfig.flaresolverrUrl || config.PROXY_URL;

  let searchQuery = null;
  let skip = 0;

  if (extra) {
    const params = new URLSearchParams(extra.replace(/\.json$/, ''));
    searchQuery = params.get('search');
    if (params.get('skip')) skip = parseInt(params.get('skip'), 10) || 0;
  }

  try {
    let items = [];
    if (searchQuery) {
      items = await scraper.search(searchQuery, baseUrl, proxy);
      if (items.length > 0 && type) {
        items = items.filter(it => it.type === type);
      }
      // If OlaMovies search returned 0 items, fallback to Cinemeta search
      if (items.length === 0) {
        const cItems = await searchCinemeta(type || 'movie', searchQuery);
        items = (cItems || []).map(m => ({
          id: m.id,
          type: m.type || type,
          name: m.name,
          poster: m.poster,
          rawTitle: m.name,
          year: m.year ? parseInt(m.year, 10) : null,
        }));
      }
    } else {
      items = await scraper.getCatalog(id, baseUrl, proxy);
    }

    const metas = items.slice(skip, skip + 50).map(item => ({
      id: item.id,
      type: item.type,
      name: item.name,
      poster: item.poster,
      posterShape: 'poster',
      description: item.rawTitle || item.name,
      releaseInfo: item.year ? String(item.year) : undefined,
    }));

    res.setHeader('Cache-Control', 'max-age=1800, public');
    res.json({ metas });
  } catch (err) {
    console.error('[Catalog Error]:', err.message);
    res.json({ metas: [] });
  }
}

app.get(['/catalog/:type/:id.json', '/catalog/:type/:id/:extra.json'], (req, res) => {
  handleCatalog(req, res, {});
});

app.get(['/:config/catalog/:type/:id.json', '/:config/catalog/:type/:id/:extra.json'], (req, res) => {
  const userConfig = parseUserConfig(req.params.config);
  handleCatalog(req, res, userConfig);
});

// ----------------------------------------------------
// Meta Routes
// ----------------------------------------------------
async function handleMeta(req, res, userConfig) {
  const { type, id } = req.params;
  const cleanId = id.replace(/\.json$/, '');
  const baseUrl = userConfig.baseUrl || config.BASE_URL;
  const proxy = userConfig.proxyUrl || userConfig.flaresolverrUrl || config.PROXY_URL;

  try {
    let details = null;

    if (cleanId.startsWith('olamovies:')) {
      // Format: olamovies:type:slug
      const parts = cleanId.split(':');
      const itemType = parts[1] || type;
      const slug = parts.slice(2).join(':');
      details = await scraper.getItemDetails(itemType, slug, baseUrl, proxy);

      if (!details) {
        const cleanTitle = slug.replace(/-/g, ' ').replace(/\(\d{4}\)/g, '').trim();
        const searchResults = await searchCinemeta(itemType, cleanTitle);
        if (searchResults && searchResults.length > 0) {
          const m = searchResults[0];
          details = {
            id: cleanId,
            type: itemType,
            title: m.name,
            poster: m.poster,
            synopsis: m.description,
            imdbId: m.id,
            files: [],
          };
        }
      }
    } else if (cleanId.startsWith('tt')) {
      // IMDb ID
      try {
        details = await scraper.findReleasesByImdbId(cleanId, type, baseUrl, proxy);
      } catch (e) {}

      if (!details) {
        const cMeta = await getMetaFromCinemeta(type, cleanId);
        if (cMeta) {
          details = {
            id: cleanId,
            type: cMeta.type || type,
            title: cMeta.name,
            poster: cMeta.poster,
            synopsis: cMeta.description,
            imdbId: cleanId,
            files: [],
          };
        }
      }
    }

    if (!details) {
      return res.json({ meta: null });
    }

    const meta = {
      id: details.id,
      type: details.type,
      name: details.title,
      poster: details.poster,
      background: details.poster,
      description: details.synopsis || details.title,
      imdb_id: details.imdbId || undefined,
      genres: ['Movies & Series'],
    };

    // If series, list episodes from files
    if (details.type === 'series' && Array.isArray(details.files)) {
      const episodes = [];
      const seenEps = new Set();

      details.files.forEach(f => {
        const epNum = f.episode || (f.label && f.label.match(/E(?:pisode)?\s*(\d+)/i)?.[1]);
        if (epNum && !seenEps.has(epNum)) {
          seenEps.add(epNum);
          episodes.push({
            id: `${details.id}:1:${epNum}`,
            title: `Episode ${epNum}`,
            season: 1,
            episode: parseInt(epNum, 10),
          });
        }
      });

      if (episodes.length > 0) {
        meta.videos = episodes;
      }
    }

    res.setHeader('Cache-Control', 'max-age=3600, public');
    res.json({ meta });
  } catch (err) {
    console.error('[Meta Error]:', err.message);
    res.json({ meta: null });
  }
}

app.get('/meta/:type/:id.json', (req, res) => {
  handleMeta(req, res, {});
});

app.get('/:config/meta/:type/:id.json', (req, res) => {
  const userConfig = parseUserConfig(req.params.config);
  handleMeta(req, res, userConfig);
});

// ----------------------------------------------------
// Stream Routes
// ----------------------------------------------------
async function handleStream(req, res, userConfig) {
  const { type, id } = req.params;
  const cleanId = id.replace(/\.json$/, '');
  const baseUrl = userConfig.baseUrl || config.BASE_URL;
  const proxy = userConfig.proxyUrl || userConfig.flaresolverrUrl || config.PROXY_URL;
  const { protocol, host } = getRequestOrigin(req);

  try {
    let details = null;
    let imdbId = null;
    let season = null;
    let episode = null;

    if (cleanId.startsWith('olamovies:')) {
      const parts = cleanId.split(':');
      const itemType = parts[1] || type;
      const slug = parts[2];
      if (parts[3] && parts[4]) {
        season = parseInt(parts[3], 10);
        episode = parseInt(parts[4], 10);
      }

      try {
        details = await scraper.getItemDetails(itemType, slug, baseUrl, proxy);
      } catch (e) {}

      imdbId = details?.imdbId || null;
      if (!imdbId) {
        const searchTitle = (details?.title || slug).replace(/-/g, ' ').replace(/\(\d{4}\)/g, '').trim();
        const searchResults = await searchCinemeta(itemType, searchTitle);
        if (searchResults && searchResults.length > 0) {
          imdbId = searchResults[0].id;
        }
      }
    } else if (cleanId.startsWith('tt')) {
      const parts = cleanId.split(':');
      imdbId = parts[0];
      if (parts[1] && parts[2]) {
        season = parseInt(parts[1], 10);
        episode = parseInt(parts[2], 10);
      }

      try {
        details = await scraper.findReleasesByImdbId(imdbId, type, baseUrl, proxy);
      } catch (e) {}
    }

    const streams = await resolveAllStreams({
      type,
      imdbId,
      season,
      episode,
      olaFiles: details?.files || [],
      userConfig,
      reqHost: host,
      reqProtocol: protocol,
    });

    res.setHeader('Cache-Control', 'max-age=1800, public');
    res.json({ streams });
  } catch (err) {
    console.error('[Stream Error]:', err.message);
    res.json({ streams: [] });
  }
}

app.get('/stream/:type/:id.json', (req, res) => {
  handleStream(req, res, {});
});

app.get('/:config/stream/:type/:id.json', (req, res) => {
  const userConfig = parseUserConfig(req.params.config);
  handleStream(req, res, userConfig);
});

// ----------------------------------------------------
// Resolver Route
// ----------------------------------------------------
app.get(['/resolve/:btnId', '/:config/resolve/:btnId'], async (req, res) => {
  const userConfig = parseUserConfig(req.params.config);
  const { btnId } = req.params;

  try {
    const finalUrl = await resolveLink(btnId, userConfig);
    res.redirect(finalUrl);
  } catch (err) {
    res.redirect(`https://links.ol-am.top/${btnId}`);
  }
});

// ----------------------------------------------------
// API Routes for Testing & Dashboard
// ----------------------------------------------------
app.get('/api/search', async (req, res) => {
  const q = req.query.q || '';
  if (!q.trim()) return res.json([]);
  try {
    let results = await scraper.search(q, req.query.baseUrl, req.query.proxyUrl);
    if (!results || results.length === 0) {
      const cResults = await searchCinemeta('movie', q);
      results = (cResults || []).map(m => ({
        id: `olamovies:${m.type || 'movie'}:${m.id}`,
        type: m.type || 'movie',
        name: m.name,
        rawTitle: m.name,
        year: m.year ? parseInt(m.year, 10) : null,
        poster: m.poster,
        url: `https://v6.olamovies.mov`,
      }));
    }
    res.json(results);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/item', async (req, res) => {
  const { type, slug } = req.query;
  if (!type || !slug) return res.status(400).json({ error: 'type and slug required' });
  try {
    const item = await scraper.getItemDetails(type, slug, req.query.baseUrl, req.query.proxyUrl);
    res.json(item || {});
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/status', (req, res) => {
  res.json({
    status: 'online',
    version: '1.2.0',
    target: config.BASE_URL,
    cacheItems: cache.size(),
    uptime: process.uptime(),
  });
});

// ----------------------------------------------------
// UI Routes
// ----------------------------------------------------
app.get(['/', '/configure'], (req, res) => {
  const possiblePaths = [
    path.join(__dirname, '../public/index.html'),
    path.join(process.cwd(), 'public/index.html'),
    path.join(__dirname, 'public/index.html'),
  ];
  for (const p of possiblePaths) {
    if (fs.existsSync(p)) {
      return res.sendFile(p);
    }
  }
  res.send('<h1>OlaMovies Addon for Nuvio & Stremio</h1><p>Manifest: <a href="/manifest.json">/manifest.json</a></p>');
});

// Start Server
if (require.main === module) {
  app.listen(config.PORT, () => {
    console.log(`====================================================`);
    console.log(`🚀 Nuvio OlaMovies Addon is running!`);
    console.log(`📡 Local Addon Server: http://localhost:${config.PORT}`);
    console.log(`📋 Manifest URL:     http://localhost:${config.PORT}/manifest.json`);
    console.log(`🎮 Nuvio/Stremio URL: stremio://localhost:${config.PORT}/manifest.json`);
    console.log(`====================================================`);
  });
}

module.exports = app;
