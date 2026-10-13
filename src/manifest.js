function getManifest(userConfig = {}) {
  const version = '1.0.0';
  const name = userConfig.addonName || 'OlaMovies';

  return {
    id: 'org.nuvio.olamovies',
    version,
    name: `${name} (Nuvio)`,
    description: 'High-quality Movies and TV Series scraped directly from OlaMovies. Supports 4K HDR, 1080p, HEVC, and multi-audio releases.',
    logo: 'https://img.ol-am.top/uploads/2020/05/The-Marvel-Cinematic-Universe-Movies-Collection-Full-HD-Download.jpg',
    background: 'https://v6.olamovies.mov/og-image.jpg',
    resources: [
      'catalog',
      'meta',
      'stream',
    ],
    types: ['movie', 'series'],
    catalogs: [
      {
        type: 'movie',
        id: 'olamovies_movies',
        name: 'OlaMovies - Movies',
        extra: [
          { name: 'search', isRequired: false },
          { name: 'skip', isRequired: false },
        ],
      },
      {
        type: 'series',
        id: 'olamovies_series',
        name: 'OlaMovies - TV Series',
        extra: [
          { name: 'search', isRequired: false },
          { name: 'skip', isRequired: false },
        ],
      },
    ],
    idPrefixes: ['olamovies:', 'tt'],
    behaviorHints: {
      configurable: true,
      configurationRequired: false,
    },
  };
}

module.exports = {
  getManifest,
};
