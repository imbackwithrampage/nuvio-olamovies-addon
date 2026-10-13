// ============================================================================
// Nuvio & Stremio OlaMovies Addon - Standalone Cloudflare Worker
// Runs 24/7 on Cloudflare's Edge Network (Zero Vercel/Render Datacenter Blocks)
// ============================================================================

const CONFIG = {
  BASE_URL: 'https://v6.olamovies.mov',
  CINEMETA_URL: 'https://v3-cinemeta.strem.io',
};

// ----------------------------------------------------
// Manifest
// ----------------------------------------------------
function getManifest() {
  return {
    id: 'org.nuvio.olamovies',
    version: '1.0.0',
    name: 'OlaMovies (Nuvio)',
    description: 'Direct high-quality 4K UHD, 1080p, HEVC, and multi-audio releases scraped from OlaMovies',
    logo: 'https://img.ol-am.top/uploads/2020/05/The-Marvel-Cinematic-Universe-Movies-Collection-Full-HD-Download.jpg',
    background: 'https://v6.olamovies.mov/og-image.jpg',
    resources: ['catalog', 'meta', 'stream'],
    types: ['movie', 'series'],
    catalogs: [
      {
        type: 'movie',
        id: 'olamovies_movies',
        name: 'OlaMovies - Movies',
        extra: [{ name: 'search', isRequired: false }, { name: 'skip', isRequired: false }]
      },
      {
        type: 'series',
        id: 'olamovies_series',
        name: 'OlaMovies - TV Series',
        extra: [{ name: 'search', isRequired: false }, { name: 'skip', isRequired: false }]
      }
    ],
    idPrefixes: ['olamovies:', 'tt'],
    behaviorHints: { configurable: true, configurationRequired: false }
  };
}

// ----------------------------------------------------
// Scraper & Parsers
// ----------------------------------------------------
async function fetchOlaHtml(url, customBase) {
  const targetUrl = customBase && url.startsWith(CONFIG.BASE_URL)
    ? url.replace(CONFIG.BASE_URL, customBase)
    : url;

  const headers = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
    'Accept-Language': 'en-US,en;q=0.9',
    'Sec-Ch-Ua': '"Chromium";v="130", "Google Chrome";v="130", "Not?A_Brand";v="99"',
    'Sec-Ch-Ua-Mobile': '?0',
    'Sec-Ch-Ua-Platform': '"Windows"',
    'Sec-Fetch-Dest': 'document',
    'Sec-Fetch-Mode': 'navigate',
    'Sec-Fetch-Site': 'none',
    'Sec-Fetch-User': '?1',
    'Upgrade-Insecure-Requests': '1',
  };

  const res = await fetch(targetUrl, { headers });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return await res.text();
}

function extractRscChunks(html) {
  const re = /self\.__next_f\.push\(\[1,"([\s\S]*?)"\]\)/g;
  let m;
  const chunks = [];
  while ((m = re.exec(html)) !== null) {
    chunks.push(m[1].replace(/\\"/g, '"').replace(/\\n/g, '\n').replace(/\\r/g, '\r'));
  }
  return chunks;
}

function parseCards(html, customBase) {
  const baseUrl = customBase || CONFIG.BASE_URL;
  const chunks = extractRscChunks(html);
  const items = [];
  const seenSlugs = new Set();

  for (const chunk of chunks) {
    if (!chunk.includes('group/card')) continue;

    const cardRegex = /href":"(\/(movies|tv-series)\/([^"]+))"[\s\S]*?src":"([^"]+)"[\s\S]*?text-\[13\.5px\][^"]*"[,\s]*"children":"([^"]+)"/g;
    let card;
    while ((card = cardRegex.exec(chunk)) !== null) {
      const path = card[1];
      const category = card[2];
      const slug = card[3];
      const poster = card[4];
      const rawTitle = card[5];

      if (seenSlugs.has(slug)) continue;
      seenSlugs.add(slug);

      const yearMatch = rawTitle.match(/\((\d{4})\)/);
      const year = yearMatch ? parseInt(yearMatch[1], 10) : null;
      let cleanTitle = rawTitle
        .replace(/^\[[^\]]+\]\s*/g, '')
        .replace(/\s*\(\d{4}(?:-\d{4})?\).*$/, '')
        .trim();

      const type = category === 'tv-series' ? 'series' : 'movie';
      items.push({
        id: `olamovies:${type}:${slug}`,
        slug,
        type,
        name: cleanTitle || slug.replace(/-/g, ' '),
        rawTitle,
        year,
        poster,
        url: `${baseUrl}${path}`,
      });
    }
  }

  // Fallback
  if (items.length === 0 && chunks.length > 0) {
    const fallbackRegex = /href":"(\/(movies|tv-series)\/([^"]+))"[\s\S]*?src":"([^"]+)"[\s\S]*?children":"([^"]+)"/g;
    for (const chunk of chunks) {
      let card;
      while ((card = fallbackRegex.exec(chunk)) !== null) {
        const path = card[1];
        const category = card[2];
        const slug = card[3];
        const poster = card[4];
        const rawTitle = card[5];

        if (path.includes('collection') || seenSlugs.has(slug)) continue;
        seenSlugs.add(slug);

        const yearMatch = rawTitle.match(/\((\d{4})\)/);
        const year = yearMatch ? parseInt(yearMatch[1], 10) : null;
        let cleanTitle = rawTitle.replace(/^\[[^\]]+\]\s*/g, '').replace(/\s*\(\d{4}(?:-\d{4})?\).*$/, '').trim();

        const type = category === 'tv-series' ? 'series' : 'movie';
        items.push({
          id: `olamovies:${type}:${slug}`,
          slug,
          type,
          name: cleanTitle || slug.replace(/-/g, ' '),
          rawTitle,
          year,
          poster,
          url: `${baseUrl}${path}`,
        });
      }
    }
  }

  return items;
}

function parseItemPage(html, slug, type, customBase) {
  const baseUrl = customBase || CONFIG.BASE_URL;
  const chunks = extractRscChunks(html);
  const fullText = chunks.length > 0 ? chunks.join('\n') : html;

  let imdbId = null;
  const imdbMatch = html.match(/imdb\.com\/title\/(tt\d+)/i) || fullText.match(/tt\d{6,8}/);
  if (imdbMatch) imdbId = imdbMatch[1] || imdbMatch[0];

  let title = slug.replace(/-/g, ' ');
  const ogTitleMatch = html.match(/property="og:title"\s+content="([^"]+)"/i) || html.match(/<title>([^<]+)<\/title>/i);
  if (ogTitleMatch) title = ogTitleMatch[1].replace(/~ OM Official.*$/i, '').trim();

  let poster = '';
  const ogImageMatch = html.match(/property="og:image"\s+content="([^"]+)"/i);
  if (ogImageMatch) {
    poster = ogImageMatch[1];
  } else {
    const posterFallback = fullText.match(/https:\/\/img\.ol-am\.top\/(?:posters|uploads)\/[^"'\s]+/);
    if (posterFallback) poster = posterFallback[0];
  }

  let synopsis = '';
  const synMatch = html.match(/Synopsis[\s\S]*?text-\[15px\][^>]*>([^<]+)<\/p>/) || html.match(/name="description"\s+content="([^"]+)"/i);
  if (synMatch) synopsis = synMatch[1].replace(/\\"/g, '"');

  const blocks = [];
  const files = [];

  const blocksIdx = fullText.indexOf('"blocks":[');
  if (blocksIdx !== -1) {
    try {
      let depth = 0;
      let startIdx = blocksIdx + 9;
      let endIdx = -1;
      for (let i = startIdx; i < fullText.length; i++) {
        if (fullText[i] === '[') depth++;
        else if (fullText[i] === ']') {
          depth--;
          if (depth === 0) {
            endIdx = i + 1;
            break;
          }
        }
      }
      if (endIdx !== -1) {
        const jsonStr = fullText.slice(startIdx, endIdx);
        const parsedBlocks = JSON.parse(jsonStr);
        for (const block of parsedBlocks) {
          blocks.push(block);
          if (Array.isArray(block.files)) {
            for (const file of block.files) {
              files.push({
                ...file,
                blockResolution: block.resolution,
                blockSpecs: block.labelSpecs || block.specs || [],
                blockSize: block.size,
              });
            }
          }
        }
      }
    } catch (e) {}
  }

  if (files.length === 0) {
    const fileRegex = /"btnId":"([^"]+)","url":"([^"]+)","label":"([^"]+)"[\s\S]*?"filename":"([^"]+)"[\s\S]*?"filesize":"([^"]+)"/g;
    let fileMatch;
    while ((fileMatch = fileRegex.exec(fullText)) !== null) {
      files.push({
        btnId: fileMatch[1],
        url: fileMatch[2],
        label: fileMatch[3],
        filename: fileMatch[4],
        filesize: fileMatch[5],
      });
    }
  }

  return {
    id: `olamovies:${type}:${slug}`,
    slug,
    type,
    title,
    imdbId,
    poster,
    synopsis,
    url: `${baseUrl}/${type === 'series' ? 'tv-series' : 'movies'}/${slug}`,
    blocks,
    files,
  };
}

function extractQuality(file) {
  if (file.face && file.face.quality) return file.face.quality.toUpperCase();
  const match = (file.filename || file.label || '').match(/\b(2160p|4k|1080p|720p|480p)\b/i);
  if (match) return match[1].toUpperCase();
  if (file.blockResolution) return file.blockResolution.toUpperCase();
  return 'HD';
}

function formatStreams(files, origin, season = null, episode = null) {
  if (!Array.isArray(files) || files.length === 0) return [];

  let matchedFiles = files;
  if (season !== null && episode !== null) {
    const sStr = String(season).padStart(2, '0');
    const eStr = String(episode).padStart(2, '0');
    const epPattern = new RegExp(`(?:S${sStr}\\s*E${eStr}|E(?:pisode)?\\s*${episode}\\b)`, 'i');

    const specificEpFiles = files.filter(f => {
      if (f.episode && Number(f.episode) === Number(episode)) return true;
      if (f.label && epPattern.test(f.label)) return true;
      if (f.filename && epPattern.test(f.filename)) return true;
      return false;
    });
    if (specificEpFiles.length > 0) matchedFiles = specificEpFiles;
  }

  const getQualityScore = (file) => {
    const q = extractQuality(file);
    if (q.includes('2160') || q.includes('4K')) return 400;
    if (q.includes('1080')) return 300;
    if (q.includes('720')) return 200;
    return 50;
  };

  matchedFiles.sort((a, b) => getQualityScore(b) - getQualityScore(a));

  return matchedFiles.map((file) => {
    const quality = extractQuality(file);
    const specs = [];
    if (file.face && Array.isArray(file.face.video)) specs.push(...file.face.video);
    if (file.face && Array.isArray(file.face.audio)) specs.push(...file.face.audio);
    if (file.blockSpecs && Array.isArray(file.blockSpecs)) specs.push(...file.blockSpecs);
    const specStr = [...new Set(specs)].slice(0, 4).join(' • ');

    const sizeStr = file.filesize || (file.blockSize ? `${file.blockSize} GB` : '');
    const filename = file.filename || file.label || 'Video';
    const btnId = file.btnId || (file.url ? file.url.split('/').pop() : '');
    const streamUrl = `${origin}/resolve/${btnId}?name=${encodeURIComponent(filename)}`;

    return {
      name: `[OlaMovies]\n${quality}`,
      title: `${filename}\n${[quality, specStr, sizeStr ? `💾 ${sizeStr}` : ''].filter(Boolean).join(' | ')}`,
      url: streamUrl,
      behaviorHints: {
        bingeGroup: `olamovies-${quality.toLowerCase()}`,
        notWebReady: true,
      },
    };
  });
}

// ----------------------------------------------------
// Worker Request Router
// ----------------------------------------------------
export default {
  async fetch(request) {
    const url = new URL(request.url);
    const pathname = url.pathname;
    const origin = url.origin;

    const corsHeaders = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
      'Access-Control-Allow-Headers': '*',
      'Content-Type': 'application/json',
    };

    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders });
    }

    try {
      // 1. Manifest
      if (pathname === '/manifest.json' || pathname.endsWith('/manifest.json')) {
        return new Response(JSON.stringify(getManifest()), { headers: corsHeaders });
      }

      // 2. Catalog
      const catalogMatch = pathname.match(/(?:\/[^\/]+)?\/catalog\/([^\/]+)\/([^\/]+?)(?:\/(.+))?\.json$/);
      if (catalogMatch) {
        const [, type, id, extra] = catalogMatch;
        let searchQuery = null;
        let skip = 0;
        if (extra) {
          const params = new URLSearchParams(extra);
          searchQuery = params.get('search');
          if (params.get('skip')) skip = parseInt(params.get('skip'), 10) || 0;
        }

        let items = [];
        if (searchQuery) {
          const html = await fetchOlaHtml(`${CONFIG.BASE_URL}/search?q=${encodeURIComponent(searchQuery)}`);
          items = parseCards(html);
        } else {
          const path = id === 'olamovies_series' ? '/categories/tv-series' : '/categories/movies';
          const html = await fetchOlaHtml(`${CONFIG.BASE_URL}${path}`);
          items = parseCards(html);
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
        return new Response(JSON.stringify({ metas }), { headers: corsHeaders });
      }

      // 3. Meta
      const metaMatch = pathname.match(/(?:\/[^\/]+)?\/meta\/([^\/]+)\/([^\/]+)\.json$/);
      if (metaMatch) {
        const [, type, fullId] = metaMatch;
        let details = null;

        if (fullId.startsWith('olamovies:')) {
          const parts = fullId.split(':');
          const itemType = parts[1] || type;
          const slug = parts.slice(2).join(':');
          const path = itemType === 'series' ? `/tv-series/${slug}` : `/movies/${slug}`;
          const html = await fetchOlaHtml(`${CONFIG.BASE_URL}${path}`);
          details = parseItemPage(html, slug, itemType);
        }

        if (!details) return new Response(JSON.stringify({ meta: null }), { headers: corsHeaders });

        const meta = {
          id: details.id,
          type: details.type,
          name: details.title,
          poster: details.poster,
          background: details.poster,
          description: details.synopsis || details.title,
          imdb_id: details.imdbId || undefined,
        };
        return new Response(JSON.stringify({ meta }), { headers: corsHeaders });
      }

      // 4. Stream
      const streamMatch = pathname.match(/(?:\/[^\/]+)?\/stream\/([^\/]+)\/([^\/]+)\.json$/);
      if (streamMatch) {
        const [, type, fullId] = streamMatch;
        let details = null;
        let season = null;
        let episode = null;

        if (fullId.startsWith('olamovies:')) {
          const parts = fullId.split(':');
          const itemType = parts[1] || type;
          const slug = parts[2];
          if (parts[3] && parts[4]) {
            season = parseInt(parts[3], 10);
            episode = parseInt(parts[4], 10);
          }
          const path = itemType === 'series' ? `/tv-series/${slug}` : `/movies/${slug}`;
          const html = await fetchOlaHtml(`${CONFIG.BASE_URL}${path}`);
          details = parseItemPage(html, slug, itemType);
        }

        if (!details || !Array.isArray(details.files)) {
          return new Response(JSON.stringify({ streams: [] }), { headers: corsHeaders });
        }

        const streams = formatStreams(details.files, origin, season, episode);
        return new Response(JSON.stringify({ streams }), { headers: corsHeaders });
      }

      // 5. Resolve Button Link
      const resolveMatch = pathname.match(/(?:\/[^\/]+)?\/resolve\/([^\/]+)/);
      if (resolveMatch) {
        const btnId = resolveMatch[1];
        return Response.redirect(`https://links.ol-am.top/${btnId}`, 302);
      }

      // 6. Search API
      if (pathname === '/api/search') {
        const q = url.searchParams.get('q') || '';
        if (!q.trim()) return new Response(JSON.stringify([]), { headers: corsHeaders });
        const html = await fetchOlaHtml(`${CONFIG.BASE_URL}/search?q=${encodeURIComponent(q)}`);
        const items = parseCards(html);
        return new Response(JSON.stringify(items), { headers: corsHeaders });
      }

      // 7. Status API
      if (pathname === '/api/status') {
        return new Response(JSON.stringify({ status: 'online', runtime: 'Cloudflare Worker' }), { headers: corsHeaders });
      }

      // Default: Simple Dashboard
      const htmlResponse = `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><title>OlaMovies Addon for Nuvio</title><meta name="viewport" content="width=device-width, initial-scale=1">
<style>
body { background: #0a0b10; color: #fff; font-family: sans-serif; display: grid; place-items: center; min-height: 100vh; margin: 0; padding: 20px; text-align: center; }
.card { background: #131722; padding: 36px; border-radius: 16px; border: 1px solid #232a3d; max-width: 500px; width: 100%; box-shadow: 0 10px 30px rgba(0,0,0,0.5); }
h1 { font-size: 26px; margin-bottom: 12px; color: #818cf8; }
p { color: #94a3b8; font-size: 14px; line-height: 1.6; }
.btn { display: inline-block; background: #6366f1; color: #fff; text-decoration: none; padding: 12px 24px; border-radius: 10px; font-weight: bold; margin-top: 18px; }
code { background: #000; padding: 8px 14px; border-radius: 8px; display: block; margin: 18px 0; font-size: 13px; color: #38bdf8; word-break: break-all; }
</style>
</head>
<body>
<div class="card">
<h1>OlaMovies (Nuvio Addon)</h1>
<p>24/7 Cloudflare Edge Addon Service</p>
<code>${origin}/manifest.json</code>
<a class="btn" href="stremio://${url.host}/manifest.json">Install in Nuvio / Stremio</a>
</div>
</body>
</html>`;

      return new Response(htmlResponse, { headers: { 'Content-Type': 'text/html' } });

    } catch (err) {
      return new Response(JSON.stringify({ error: err.message }), { status: 500, headers: corsHeaders });
    }
  }
};
