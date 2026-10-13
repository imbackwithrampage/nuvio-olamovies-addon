/**
 * Extract quality string from file object or filename
 */
function extractQuality(file) {
  if (file.face && file.face.quality) {
    return file.face.quality.toUpperCase();
  }
  const match = (file.filename || file.label || '').match(/\b(2160p|4k|1080p|720p|480p)\b/i);
  if (match) {
    return match[1].toUpperCase();
  }
  if (file.blockResolution) {
    return file.blockResolution.toUpperCase();
  }
  return 'HD';
}

/**
 * Format files from OlaMovies into Stremio/Nuvio stream objects
 */
function formatStreams(files, reqHost, reqProtocol, userConfig = {}, season = null, episode = null) {
  if (!Array.isArray(files) || files.length === 0) {
    return [];
  }

  // Filter for episode if series
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

  // Quality ranking helper
  const getQualityScore = (file) => {
    const q = extractQuality(file);
    if (q.includes('2160') || q.includes('4K')) return 400;
    if (q.includes('1080')) return 300;
    if (q.includes('720')) return 200;
    if (q.includes('480')) return 100;
    return 50;
  };

  // Sort files: highest resolution first
  matchedFiles.sort((a, b) => getQualityScore(b) - getQualityScore(a));

  const streams = matchedFiles.map((file) => {
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

    // Build title lines
    const titleLines = [
      filename,
      [quality, specStr, sizeStr ? `💾 ${sizeStr}` : ''].filter(Boolean).join(' | '),
    ];

    return {
      name: `[OlaMovies]\n${quality}`,
      title: titleLines.join('\n'),
      url: streamUrl,
      behaviorHints: {
        bingeGroup: `olamovies-${quality.toLowerCase()}`,
        notWebReady: true,
      },
    };
  });

  return streams;
}

module.exports = {
  formatStreams,
  extractQuality,
};
