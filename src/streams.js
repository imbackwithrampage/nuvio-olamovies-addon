/**
 * Extract quality string from file object or filename
 */
function extractQuality(file) {
  if (file.face && file.face.quality) {
    return file.face.quality.toUpperCase();
  }
  const match = (file.filename || file.label || file.title || '').match(/\b(2160p|4k|1080p|720p|480p)\b/i);
  if (match) {
    return match[1].toUpperCase();
  }
  if (file.blockResolution) {
    return file.blockResolution.toUpperCase();
  }
  return 'HD';
}

/**
 * Fetch direct playable streams (P2P torrent / RealDebrid unthrottled CDN)
 * Supported natively by Nuvio ExoPlayer on Mobile & Android TV
 */
async function fetchPlayableStreams({ type, imdbId, season = null, episode = null, realDebridKey = null }) {
  if (!imdbId) return [];

  const query = (season !== null && episode !== null)
    ? `${imdbId}:${season}:${episode}`
    : imdbId;

  // Use Real-Debrid endpoint if key provided, else standard high-speed torrent streams
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
      signal: AbortSignal.timeout(8000),
    });

    if (!res.ok) {
      console.warn(`[Stream Resolver] Provider status ${res.status} for ${query}`);
      return [];
    }

    const data = await res.json();
    if (!data || !Array.isArray(data.streams)) return [];

    return data.streams.map((s) => {
      // Determine quality from name/title
      const rawTitle = s.title || '';
      const qualityMatch = (s.name + ' ' + rawTitle).match(/\b(4k|2160p|1080p|720p|480p)\b/i);
      const quality = qualityMatch ? qualityMatch[1].toUpperCase() : 'HD';

      // Detect HDR / DV / Dual Audio
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
  } catch (err) {
    console.warn(`[Stream Resolver] Failed for ${query}:`, err.message);
    return [];
  }
}

/**
 * Format files from OlaMovies into fallback hoster stream links
 */
function formatOlaHosterStreams(files, reqHost, reqProtocol, season = null, episode = null) {
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

    if (specificEpFiles.length > 0) {
      matchedFiles = specificEpFiles;
    }
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
    const streamUrl = `${reqProtocol}://${reqHost}/resolve/${btnId}?name=${encodeURIComponent(filename)}`;

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

/**
 * Main unified stream resolver for Nuvio & Stremio
 */
async function resolveAllStreams({
  type,
  imdbId,
  season = null,
  episode = null,
  olaFiles = [],
  userConfig = {},
  reqHost = 'localhost:7000',
  reqProtocol = 'http',
}) {
  // 1. Fetch direct playable streams (100% working in Nuvio ExoPlayer on TV & mobile)
  const playableStreams = await fetchPlayableStreams({
    type,
    imdbId,
    season,
    episode,
    realDebridKey: userConfig.realDebridKey || null,
  });

  // 2. Fetch OlaMovies hoster button streams
  const hosterStreams = formatOlaHosterStreams(olaFiles, reqHost, reqProtocol, season, episode);

  // Return playable streams first, hoster buttons as secondary options
  return [...playableStreams, ...hosterStreams];
}

module.exports = {
  resolveAllStreams,
  fetchPlayableStreams,
  formatOlaHosterStreams,
  extractQuality,
};
