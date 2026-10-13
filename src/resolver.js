const config = require('./config');

/**
 * Resolve link or handle debrid unlocker if configured
 */
async function resolveLink(btnId, userConfig = {}) {
  const customBase = userConfig.baseUrl || config.BASE_URL;
  // Fallback direct button URL
  const buttonUrl = `https://links.ol-am.top/${btnId}`;

  // If user configured a FlareSolverr or custom resolver proxy
  if (userConfig.flaresolverrUrl) {
    try {
      const solverRes = await fetch(`${userConfig.flaresolverrUrl}/v1`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          cmd: 'request.get',
          url: buttonUrl,
          maxTimeout: 15000,
        }),
      });
      const solverData = await solverRes.json();
      if (solverData && solverData.solution && solverData.solution.response) {
        // Look for extracted host link inside solution
        const match = solverData.solution.response.match(/https?:\/\/(?:drive\.google\.com|hubcloud|katdrive|pixeldrain)[^\s"'<>]+/);
        if (match) {
          return match[0];
        }
      }
    } catch (err) {
      console.warn(`[Resolver] FlareSolverr resolution failed:`, err.message);
    }
  }

  // If Real-Debrid API token is provided and we have a hoster link
  if (userConfig.realDebridKey && userConfig.hostLink) {
    try {
      const rdRes = await fetch('https://api.real-debrid.com/rest/1.0/unrestrict/link', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${userConfig.realDebridKey}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: `link=${encodeURIComponent(userConfig.hostLink)}`,
      });
      const rdData = await rdRes.json();
      if (rdData && rdData.download) {
        return rdData.download;
      }
    } catch (err) {
      console.warn(`[Resolver] Real-Debrid unrestrict failed:`, err.message);
    }
  }

  // Default redirect to the button resolver URL
  return buttonUrl;
}

module.exports = {
  resolveLink,
};
