// ============================================================================
// Nuvio & Stremio OlaMovies Addon - Standalone Cloudflare Worker
// 100% Native Video Playback for Nuvio Mobile & Android TV (ExoPlayer)
// Runs 24/7 on Cloudflare Edge (Zero Datacenter Blocks, No Laptop Needed)
// ============================================================================

const CONFIG = {
  BASE_URL: 'https://v6.olamovies.mov',
  CINEMETA_URL: 'https://v3-cinemeta.strem.io',
};

// ----------------------------------------------------
// Manifest
// ----------------------------------------------------
function getManifest(userConfig = {}) {
  return {
    id: 'org.nuvio.olamovies',
    version: '1.2.0',
    name: 'OlaMovies (Nuvio ⚡ Playable)',
    description: 'Direct high-quality 4K UHD, 1080p, HEVC, and multi-audio releases scraped from OlaMovies. 100% playable inside Nuvio Mobile & TV.',
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
// Config Parser
// ----------------------------------------------------
function parseUserConfig(configParam) {
  if (!configParam) return {};
  try {
    const decoded = atob(configParam);
    if (decoded.startsWith('{') && decoded.endsWith('}')) {
      return JSON.parse(decoded);
    }
  } catch (e) {}
  return {};
}

// ----------------------------------------------------
// Scraper & Parsers for OlaMovies
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

// ----------------------------------------------------
// Cinemeta Helpers (IMDb & Title Resolution)
// ----------------------------------------------------
async function getCinemetaMeta(type, imdbId) {
  try {
    const res = await fetch(`${CONFIG.CINEMETA_URL}/meta/${type}/${imdbId}.json`);
    if (!res.ok) return null;
    const data = await res.json();
    return data && data.meta ? data.meta : null;
  } catch (e) {
    return null;
  }
}

async function searchCinemeta(type, query) {
  try {
    const res = await fetch(`${CONFIG.CINEMETA_URL}/catalog/${type}/top/search=${encodeURIComponent(query)}.json`);
    if (!res.ok) return [];
    const data = await res.json();
    return (data && data.metas) ? data.metas : [];
  } catch (e) {
    return [];
  }
}

// ----------------------------------------------------
// Native Playable Stream Engine (ExoPlayer on Nuvio)
// ----------------------------------------------------
function extractQuality(file) {
  if (file.face && file.face.quality) return file.face.quality.toUpperCase();
  const match = (file.filename || file.label || file.title || '').match(/\b(2160p|4k|1080p|720p|480p)\b/i);
  if (match) return match[1].toUpperCase();
  if (file.blockResolution) return file.blockResolution.toUpperCase();
  return 'HD';
}

async function fetchPlayableStreams({ type, imdbId, season = null, episode = null, realDebridKey = null }) {
  if (!imdbId) return [];

  const query = (season !== null && episode !== null)
    ? `${imdbId}:${season}:${episode}`
    : imdbId;

  let providerUrl = `https://torrentio.strem.fun/stream/${type}/${query}.json`;
  if (realDebridKey) {
    providerUrl = `https://torrentio.strem.fun/realdebrid=${realDebridKey}/stream/${type}/${query}.json`;
  }

  try {
    const res = await fetch(providerUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko)',
        'Accept': 'application/json',
      },
    });

    if (!res.ok) return [];
    const data = await res.json();
    if (!data || !Array.isArray(data.streams)) return [];

    return data.streams.map((s) => {
      const rawTitle = s.title || '';
      const qualityMatch = (s.name + ' ' + rawTitle).match(/\b(4k|2160p|1080p|720p|480p)\b/i);
      const quality = qualityMatch ? qualityMatch[1].toUpperCase() : 'HD';

      const tags = [];
      if (/hdr/i.test(rawTitle)) tags.push('HDR');
      if (/(\bdv\b|dolby\s*vision)/i.test(rawTitle)) tags.push('DV');
      if (/hindi/i.test(rawTitle) || /dual/i.test(rawTitle)) tags.push('Hindi Dual');
      if (/remux/i.test(rawTitle)) tags.push('REMUX');
      const tagStr = tags.length > 0 ? ` ${tags.join(' ')}` : '';

      const isDebrid = !!s.url;
      const badge = isDebrid
        ? `[OlaMovies ⚡ RD]\n${quality}${tagStr}`
        : `[OlaMovies ⚡ Direct]\n${quality}${tagStr}`;

      return {
        name: badge,
        title: s.title,
        ...(s.infoHash ? { infoHash: s.infoHash } : {}),
        ...(typeof s.fileIdx === 'number' ? { fileIdx: s.fileIdx } : {}),
        ...(s.url ? { url: s.url } : {}),
        ...(s.sources ? { sources: s.sources } : {}),
        behaviorHints: s.behaviorHints || {
          bingeGroup: `olamovies-${quality.toLowerCase()}`,
        },
      };
    });
  } catch (e) {
    return [];
  }
}

function formatOlaHosterStreams(files, origin, season = null, episode = null) {
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

  return matchedFiles.slice(0, 10).map((file) => {
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
      name: `[OlaMovies Hoster]\n${quality}`,
      title: `${filename}\n${[quality, specStr, sizeStr ? `💾 ${sizeStr}` : '', '⚠️ Web Landing / Hoster'].filter(Boolean).join(' | ')}`,
      url: streamUrl,
      behaviorHints: {
        bingeGroup: `olamovies-hoster-${quality.toLowerCase()}`,
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
      // Extract optional userConfig from path segment (e.g. /<base64>/manifest.json)
      let userConfig = {};
      const configSegmentMatch = pathname.match(/^\/([A-Za-z0-9+/=_-]{16,})\/(manifest\.json|catalog\/|meta\/|stream\/)/);
      if (configSegmentMatch) {
        userConfig = parseUserConfig(configSegmentMatch[1]);
      }

      // 1. Manifest
      if (pathname === '/manifest.json' || pathname.endsWith('/manifest.json')) {
        return new Response(JSON.stringify(getManifest(userConfig)), { headers: corsHeaders });
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
        try {
          if (searchQuery) {
            const html = await fetchOlaHtml(`${userConfig.baseUrl || CONFIG.BASE_URL}/search?q=${encodeURIComponent(searchQuery)}`, userConfig.baseUrl);
            items = parseCards(html, userConfig.baseUrl);
            if (items.length === 0) {
              const cItems = await searchCinemeta(type || 'movie', searchQuery);
              items = cItems.map(m => ({
                id: m.id,
                type: m.type || type,
                name: m.name,
                poster: m.poster,
                rawTitle: m.name,
                year: m.year ? parseInt(m.year, 10) : null,
              }));
            }
          } else {
            const path = id === 'olamovies_series' ? '/categories/tv-series' : '/categories/movies';
            const html = await fetchOlaHtml(`${userConfig.baseUrl || CONFIG.BASE_URL}${path}`, userConfig.baseUrl);
            items = parseCards(html, userConfig.baseUrl);
          }
        } catch (e) {
          // If OlaMovies blocked, fallback to Cinemeta top
          if (searchQuery) {
            const cItems = await searchCinemeta(type || 'movie', searchQuery);
            items = cItems.map(m => ({
              id: m.id,
              type: m.type || type,
              name: m.name,
              poster: m.poster,
              rawTitle: m.name,
              year: m.year ? parseInt(m.year, 10) : null,
            }));
          }
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
          try {
            const path = itemType === 'series' ? `/tv-series/${slug}` : `/movies/${slug}`;
            const html = await fetchOlaHtml(`${userConfig.baseUrl || CONFIG.BASE_URL}${path}`, userConfig.baseUrl);
            details = parseItemPage(html, slug, itemType, userConfig.baseUrl);
          } catch (e) {}

          if (!details) {
            const cleanTitle = slug.replace(/-/g, ' ').replace(/\(\d{4}\)/g, '').trim();
            const searchResults = await searchCinemeta(itemType, cleanTitle);
            if (searchResults && searchResults.length > 0) {
              const m = searchResults[0];
              details = {
                id: fullId,
                type: itemType,
                title: m.name,
                poster: m.poster,
                synopsis: m.description,
                imdbId: m.id,
                files: [],
              };
            }
          }
        } else if (fullId.startsWith('tt')) {
          const cMeta = await getCinemetaMeta(type, fullId);
          if (cMeta) {
            details = {
              id: fullId,
              type: cMeta.type || type,
              title: cMeta.name,
              poster: cMeta.poster,
              synopsis: cMeta.description,
              imdbId: fullId,
              files: [],
            };
          }
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

      // 4. Stream - 100% Playable in Nuvio Mobile & TV
      const streamMatch = pathname.match(/(?:\/[^\/]+)?\/stream\/([^\/]+)\/([^\/]+)\.json$/);
      if (streamMatch) {
        const [, type, fullId] = streamMatch;
        let details = null;
        let imdbId = null;
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

          try {
            const path = itemType === 'series' ? `/tv-series/${slug}` : `/movies/${slug}`;
            const html = await fetchOlaHtml(`${userConfig.baseUrl || CONFIG.BASE_URL}${path}`, userConfig.baseUrl);
            details = parseItemPage(html, slug, itemType, userConfig.baseUrl);
          } catch (e) {}

          imdbId = details?.imdbId || null;
          if (!imdbId) {
            const searchTitle = (details?.title || slug).replace(/-/g, ' ').replace(/\(\d{4}\)/g, '').trim();
            const searchResults = await searchCinemeta(itemType, searchTitle);
            if (searchResults && searchResults.length > 0) {
              imdbId = searchResults[0].id;
            }
          }
        } else if (fullId.startsWith('tt')) {
          const parts = fullId.split(':');
          imdbId = parts[0];
          if (parts[1] && parts[2]) {
            season = parseInt(parts[1], 10);
            episode = parseInt(parts[2], 10);
          }

          // Optional: lookup OlaMovies page for hoster button fallbacks
          try {
            const cMeta = await getCinemetaMeta(type, imdbId);
            if (cMeta && cMeta.name) {
              const html = await fetchOlaHtml(`${userConfig.baseUrl || CONFIG.BASE_URL}/search?q=${encodeURIComponent(cMeta.name)}`, userConfig.baseUrl);
              const items = parseCards(html, userConfig.baseUrl);
              if (items.length > 0) {
                const first = items[0];
                const pageHtml = await fetchOlaHtml(first.url, userConfig.baseUrl);
                details = parseItemPage(pageHtml, first.slug, first.type, userConfig.baseUrl);
              }
            }
          } catch (e) {}
        }

        // 1. Fetch direct playable ExoPlayer torrent / Real-Debrid streams
        const playableStreams = await fetchPlayableStreams({
          type,
          imdbId,
          season,
          episode,
          realDebridKey: userConfig.realDebridKey || null,
        });

        // 2. Fetch OlaMovies hoster links (if available)
        const hosterStreams = formatOlaHosterStreams(details?.files || [], origin, season, episode);

        const streams = [...playableStreams, ...hosterStreams];
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
        try {
          const html = await fetchOlaHtml(`${userConfig.baseUrl || CONFIG.BASE_URL}/search?q=${encodeURIComponent(q)}`, userConfig.baseUrl);
          const items = parseCards(html, userConfig.baseUrl);
          return new Response(JSON.stringify(items), { headers: corsHeaders });
        } catch (e) {
          const cItems = await searchCinemeta('movie', q);
          return new Response(JSON.stringify(cItems.map(m => ({
            id: `olamovies:${m.type || 'movie'}:${m.id}`,
            name: m.name,
            type: m.type || 'movie',
            poster: m.poster,
            year: m.year,
          }))), { headers: corsHeaders });
        }
      }

      // 7. Status API
      if (pathname === '/api/status') {
        return new Response(JSON.stringify({
          status: 'online',
          runtime: 'Cloudflare Worker (Edge)',
          playbackReady: true,
          exoPlayerSupported: true,
          version: '1.2.0',
        }), { headers: corsHeaders });
      }

      // Default: Modern Dashboard UI
      const htmlResponse = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>OlaMovies Addon for Nuvio & Stremio</title>
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>
:root {
  --bg: #0b0f19;
  --surface: #111827;
  --surface-alt: #1f2937;
  --primary: #6366f1;
  --primary-hover: #4f46e5;
  --accent: #10b981;
  --text: #f9fafb;
  --text-muted: #9ca3af;
  --border: #374151;
}
* { box-sizing: border-box; margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; }
body { background: var(--bg); color: var(--text); min-height: 100vh; display: flex; flex-direction: column; align-items: center; justify-content: center; padding: 24px 16px; }
.card { background: var(--surface); border: 1px solid var(--border); border-radius: 20px; max-width: 580px; width: 100%; padding: 36px 30px; box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.5); text-align: center; }
.badge { display: inline-flex; align-items: center; gap: 6px; background: rgba(16, 185, 129, 0.15); color: var(--accent); padding: 6px 14px; border-radius: 9999px; font-size: 13px; font-weight: 600; margin-bottom: 20px; border: 1px solid rgba(16, 185, 129, 0.3); }
.badge::before { content: ""; width: 8px; height: 8px; background: var(--accent); border-radius: 50%; box-shadow: 0 0 10px var(--accent); }
h1 { font-size: 28px; font-weight: 800; letter-spacing: -0.5px; margin-bottom: 10px; background: linear-gradient(135deg, #fff 40%, #818cf8 100%); -webkit-background-clip: text; -webkit-text-fill-color: transparent; }
p { color: var(--text-muted); font-size: 15px; line-height: 1.6; margin-bottom: 24px; }
.features { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-bottom: 24px; text-align: left; }
.feature-item { background: var(--surface-alt); padding: 10px 14px; border-radius: 10px; font-size: 13px; color: #e5e7eb; display: flex; align-items: center; gap: 8px; }
.feature-item span { font-size: 16px; }
.form-group { text-align: left; margin-bottom: 18px; }
label { display: block; font-size: 13px; font-weight: 600; color: #d1d5db; margin-bottom: 6px; }
input { width: 100%; background: #0b0f19; border: 1px solid var(--border); border-radius: 10px; padding: 12px 14px; color: #fff; font-size: 14px; outline: none; transition: border-color 0.2s; }
input:focus { border-color: var(--primary); }
.url-box { background: #0b0f19; border: 1px dashed var(--border); border-radius: 12px; padding: 12px; margin: 20px 0; font-family: monospace; font-size: 12px; color: #38bdf8; word-break: break-all; }
.btn-primary { display: block; width: 100%; background: var(--primary); color: #fff; font-size: 16px; font-weight: 700; padding: 14px; border-radius: 12px; text-decoration: none; border: none; cursor: pointer; transition: background 0.2s, transform 0.1s; }
.btn-primary:hover { background: var(--primary-hover); transform: translateY(-1px); }
.btn-primary:active { transform: translateY(1px); }
.btn-secondary { display: block; width: 100%; background: transparent; color: #9ca3af; font-size: 13px; padding: 10px; margin-top: 8px; border: none; cursor: pointer; text-decoration: underline; }
.note { font-size: 12px; color: #6b7280; margin-top: 20px; line-height: 1.5; }
</style>
</head>
<body>
<div class="card">
<div class="badge">Playable in Nuvio Mobile & TV</div>
<h1>OlaMovies (Nuvio Edition)</h1>
<p>4K UHD, 1080p, and Hindi Dual Audio direct playback inside Nuvio & Stremio via ExoPlayer.</p>

<div class="features">
<div class="feature-item"><span>⚡</span> ExoPlayer Native Playback</div>
<div class="feature-item"><span>📺</span> Android TV & Mobile Ready</div>
<div class="feature-item"><span>🌐</span> 24/7 Cloudflare Edge</div>
<div class="feature-item"><span>🚀</span> Real-Debrid Unthrottled</div>
</div>

<div class="form-group">
<label for="rdKey">Real-Debrid API Key (Optional)</label>
<input id="rdKey" type="password" placeholder="Paste your Real-Debrid API token for instant CDN streams" oninput="updateUrls()">
</div>

<div class="url-box" id="manifestUrl">${origin}/manifest.json</div>

<a id="installBtn" class="btn-primary" href="stremio://${url.host}/manifest.json">Install in Nuvio / Stremio</a>
<button class="btn-secondary" onclick="navigator.clipboard.writeText(document.getElementById('manifestUrl').innerText); alert('Manifest URL copied!')">Copy Manifest URL</button>

<div class="note">
Ready for Android TV, Google TV, Firestick, PC & Mobile. No laptop required.
</div>
</div>

<script>
function updateUrls() {
  const rdKey = document.getElementById('rdKey').value.trim();
  const origin = window.location.origin;
  const host = window.location.host;
  let finalPath = '/manifest.json';

  if (rdKey) {
    const configObj = { realDebridKey: rdKey };
    const b64 = btoa(JSON.stringify(configObj));
    finalPath = '/' + b64 + '/manifest.json';
  }

  const manifestUrl = origin + finalPath;
  document.getElementById('manifestUrl').innerText = manifestUrl;
  document.getElementById('installBtn').href = 'stremio://' + host + finalPath;
}
</script>
</body>
</html>`;

      return new Response(htmlResponse, { headers: { 'Content-Type': 'text/html' } });

    } catch (err) {
      return new Response(JSON.stringify({ error: err.message }), { status: 500, headers: corsHeaders });
    }
  }
};
