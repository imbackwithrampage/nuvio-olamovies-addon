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
    };

    cache.set(cacheKey, meta, 1000 * 60 * 60 * 24); // 24 hours cache
    return meta;
  } catch (err) {
    console.error(`[Cinemeta] Error fetching meta for ${imdbId}:`, err.message);
    return null;
  }
}

module.exports = {
  getMetaFromCinemeta,
};
