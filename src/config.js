require('dotenv').config();

const config = {
  PORT: process.env.PORT || 7000,
  BASE_URL: process.env.OLA_BASE_URL || 'https://v6.olamovies.mov',
  CACHE_TTL_MS: parseInt(process.env.CACHE_TTL_MS, 10) || 1000 * 60 * 30, // 30 minutes
  USER_AGENT: process.env.USER_AGENT || 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  CINEMETA_URL: 'https://v3-cinemeta.strem.io',
};

module.exports = config;
