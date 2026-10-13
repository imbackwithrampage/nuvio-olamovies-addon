const config = require('./config');
const cache = require('./cache');

/**
 * Resolves an IMDb ID to title and year using Cinemeta API
 * @param {string} type - 'movie' or 'series'
 * @param {string} imdbId - e.g. 'tt1431045'
 * @returns {Promise<{name: string, year: number|null, type: string}|null>}
 */
async function getMetaFromCinemeta(type, imdbId) {
  const cacheKey = `cinemeta:${type}:${imdbId}`;
  const cached = cache.get(cacheKey);
  if (cached) return cached;

  try {
    const url = `${config.CINEMETA_URL}/meta/${type}/${imdbId}.json`;
    const res = await fetch(url, {
      headers: { 'User-Agent': config.USER_AGENT },
      signal: AbortSignal.timeout(6000),
    });

    if (!res.ok) {
      console.warn(`[Cinemeta] Failed with status ${res.status} for ${imdbId}`);
      return null;
    }

    const data = await res.json();
    if (!data || !data.meta) return null;

    const meta = {
      name: data.meta.name,
      year: data.meta.year ? parseInt(data.meta.year, 10) : null,
      type: data.meta.type || type,
      imdb_id: imdbId,
      poster: data.meta.poster,
      description: data.meta.description,
    };

    cache.set(cacheKey, meta, 1000 * 60 * 60 * 24); // 24 hours cache
    return meta;
  } catch (err) {
    console.error(`[Cinemeta] Error fetching meta for ${imdbId}:`, err.message);
    return null;
  }
}

/**
 * Search Cinemeta by title
 * @param {string} type - 'movie' or 'series'
 * @param {string} query - search query
 */
async function searchCinemeta(type, query) {
  const cacheKey = `cinemeta_search:${type}:${query.toLowerCase().trim()}`;
  const cached = cache.get(cacheKey);
  if (cached) return cached;

  try {
    const url = `${config.CINEMETA_URL}/catalog/${type}/top/search=${encodeURIComponent(query)}.json`;
    const res = await fetch(url, {
      headers: { 'User-Agent': config.USER_AGENT },
      signal: AbortSignal.timeout(6000),
    });

    if (!res.ok) return [];

    const data = await res.json();
    const results = (data && data.metas) || [];
    cache.set(cacheKey, results, 1000 * 60 * 60 * 12);
    return results;
  } catch (err) {
    console.warn(`[Cinemeta] Search failed for ${query}:`, err.message);
    return [];
  }
}

module.exports = {
  getMetaFromCinemeta,
  searchCinemeta,
};
