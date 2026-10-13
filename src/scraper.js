const config = require('./config');
const cache = require('./cache');
const { getMetaFromCinemeta } = require('./cinemeta');

/**
 * Fetch HTML text from OlaMovies with browser headers and proxy fallback
 */
async function fetchHtml(url, customBaseUrl, customProxy) {
  const targetUrl = customBaseUrl && url.startsWith(config.BASE_URL)
    ? url.replace(config.BASE_URL, customBaseUrl)
    : url;

  const headers = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7',
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

  const proxy = customProxy || config.PROXY_URL;

  const fetchViaProxy = async () => {
    if (!proxy) throw new Error('No proxy configured');
    const proxyUrl = `${proxy.replace(/\/$/, '')}/?url=${encodeURIComponent(targetUrl)}`;
    const res = await fetch(proxyUrl, { headers, signal: AbortSignal.timeout(12000) });
    if (!res.ok) throw new Error(`Proxy failed with HTTP ${res.status}`);
    const text = await res.text();
    if (text.includes('cf-mitigated') || text.includes('Just a moment')) {
      throw new Error('Proxy returned Cloudflare challenge');
    }
    return text;
  };

  const fetchDirect = async () => {
    const res = await fetch(targetUrl, { headers, signal: AbortSignal.timeout(10000) });
    const text = await res.text();
    if (res.status === 403 || text.includes('cf-mitigated') || text.includes('Just a moment')) {
      throw new Error(`Cloudflare challenge detected (${res.status})`);
    }
    return text;
  };

  // If proxy is configured, use proxy first (prevents Cloudflare 403 on Vercel/serverless)
  if (proxy) {
    try {
      return await fetchViaProxy();
    } catch (proxyErr) {
      console.warn('[Scraper] Proxy fetch failed, falling back to direct:', proxyErr.message);
      return await fetchDirect();
    }
  }

  // Otherwise direct
  return await fetchDirect();
}

/**
 * Extract RSC string chunks from Next.js HTML
 */
function extractRscChunks(html) {
  const re = /self\.__next_f\.push\(\[1,"([\s\S]*?)"\]\)/g;
  let m;
  const chunks = [];
  while ((m = re.exec(html)) !== null) {
    const unescaped = m[1].replace(/\\"/g, '"').replace(/\\n/g, '\n').replace(/\\r/g, '\r');
    chunks.push(unescaped);
  }
  return chunks;
}

/**
 * Parse cards/items from Next.js RSC chunks or HTML
 */
function parseCards(html, customBaseUrl) {
  const baseUrl = customBaseUrl || config.BASE_URL;
  const chunks = extractRscChunks(html);
  const items = [];
  const seenSlugs = new Set();

  // 1. Target "group/card" chunks (actual search results and category grids)
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

  // 2. Secondary fallback if group/card didn't find anything
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
  }

  return items;
}

/**
 * Parse item detail page (releases, files, metadata)
 */
function parseItemPage(html, slug, type, customBaseUrl) {
  const baseUrl = customBaseUrl || config.BASE_URL;
  const chunks = extractRscChunks(html);
  const fullText = chunks.length > 0 ? chunks.join('\n') : html;

  // Extract IMDb ID
  let imdbId = null;
  const imdbMatch = html.match(/imdb\.com\/title\/(tt\d+)/i) || fullText.match(/tt\d{6,8}/);
  if (imdbMatch) {
    imdbId = imdbMatch[1] || imdbMatch[0];
  }

  // Extract Title
  let title = slug.replace(/-/g, ' ');
  const ogTitleMatch = html.match(/property="og:title"\s+content="([^"]+)"/i) ||
                       html.match(/<title>([^<]+)<\/title>/i);
  if (ogTitleMatch) {
    title = ogTitleMatch[1].replace(/~ OM Official.*$/i, '').trim();
  }

  // Extract Poster
  let poster = '';
  const ogImageMatch = html.match(/property="og:image"\s+content="([^"]+)"/i);
  if (ogImageMatch) {
    poster = ogImageMatch[1];
  } else {
    const posterFallback = fullText.match(/https:\/\/img\.ol-am\.top\/(?:posters|uploads)\/[^"'\s]+/);
    if (posterFallback) poster = posterFallback[0];
  }

  // Extract Synopsis
  let synopsis = '';
  const synMatch = html.match(/Synopsis[\s\S]*?text-\[15px\][^>]*>([^<]+)<\/p>/) ||
                   fullText.match(/class="[^"]*leading-\[1.65\][^"]*">([^<]+)<\/p>/) ||
                   html.match(/name="description"\s+content="([^"]+)"/i);
  if (synMatch) {
    synopsis = synMatch[1].replace(/\\"/g, '"');
  }

  // Extract releases and files
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
                blockHeading: block.heading,
              });
            }
          }
        }
      }
    } catch (err) {
      console.warn(`[Parser] JSON parsing blocks failed for ${slug}:`, err.message);
    }
  }

  // Fallback: regex search for files
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

/**
 * Search OlaMovies
 */
async function search(query, customBaseUrl, customProxy) {
  const cacheKey = `search:${query}:${customBaseUrl || 'default'}`;
  const cached = cache.get(cacheKey);
  if (cached) return cached;

  const baseUrl = customBaseUrl || config.BASE_URL;
  const searchUrl = `${baseUrl}/search?q=${encodeURIComponent(query)}`;

  try {
    const html = await fetchHtml(searchUrl, baseUrl, customProxy);
    const results = parseCards(html, baseUrl);
    cache.set(cacheKey, results, 1000 * 60 * 15); // 15 mins
    return results;
  } catch (err) {
    console.error(`[Scraper] Search failed for query "${query}":`, err.message);
    return [];
  }
}

/**
 * Get catalog items for category
 */
async function getCatalog(catalogId, customBaseUrl, customProxy) {
  const cacheKey = `catalog:${catalogId}:${customBaseUrl || 'default'}`;
  const cached = cache.get(cacheKey);
  if (cached) return cached;

  const baseUrl = customBaseUrl || config.BASE_URL;
  let path = '/';
  if (catalogId === 'olamovies_movies') {
    path = '/categories/movies';
  } else if (catalogId === 'olamovies_series') {
    path = '/categories/tv-series';
  }

  try {
    const html = await fetchHtml(`${baseUrl}${path}`, baseUrl, customProxy);
    const items = parseCards(html, baseUrl);
    cache.set(cacheKey, items, 1000 * 60 * 30); // 30 mins
    return items;
  } catch (err) {
    console.error(`[Scraper] Catalog failed for "${catalogId}":`, err.message);
    return [];
  }
}

/**
 * Get details for a single item by slug and type
 */
async function getItemDetails(type, slug, customBaseUrl, customProxy) {
  const cacheKey = `item:${type}:${slug}:${customBaseUrl || 'default'}`;
  const cached = cache.get(cacheKey);
  if (cached) return cached;

  const baseUrl = customBaseUrl || config.BASE_URL;
  const path = type === 'series' ? `/tv-series/${slug}` : `/movies/${slug}`;
  const url = `${baseUrl}${path}`;

  try {
    const html = await fetchHtml(url, baseUrl, customProxy);
    const details = parseItemPage(html, slug, type, baseUrl);
    cache.set(cacheKey, details, 1000 * 60 * 60); // 1 hour
    return details;
  } catch (err) {
    console.error(`[Scraper] getItemDetails failed for "${slug}":`, err.message);
    return null;
  }
}

/**
 * Find releases and files by IMDb ID
 */
async function findReleasesByImdbId(imdbId, type, customBaseUrl, customProxy) {
  const cacheKey = `imdb:${type}:${imdbId}:${customBaseUrl || 'default'}`;
  const cached = cache.get(cacheKey);
  if (cached) return cached;

  // 1. Resolve IMDb info from Cinemeta
  const meta = await getMetaFromCinemeta(type, imdbId);
  const searchTerms = [];

  if (meta && meta.name) {
    searchTerms.push(meta.name);
  }
  searchTerms.push(imdbId);

  for (const term of searchTerms) {
    const results = await search(term, customBaseUrl, customProxy);
    if (results.length > 0) {
      let bestMatch = results[0];
      if (meta && meta.year) {
        const yearMatch = results.find(r => r.year === meta.year);
        if (yearMatch) bestMatch = yearMatch;
      }

      const details = await getItemDetails(bestMatch.type, bestMatch.slug, customBaseUrl, customProxy);
      if (details && details.files && details.files.length > 0) {
        cache.set(cacheKey, details, 1000 * 60 * 60);
        return details;
      }
    }
  }

  return null;
}

module.exports = {
  fetchHtml,
  parseCards,
  parseItemPage,
  search,
  getCatalog,
  getItemDetails,
  findReleasesByImdbId,
  extractRscChunks,
};
