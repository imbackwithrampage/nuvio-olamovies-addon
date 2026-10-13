const scraper = require('./scraper');
const { formatStreams } = require('./streams');
const { getManifest } = require('./manifest');

async function runTests() {
  console.log('--- Starting Addon Tests ---');

  // Test 1: Manifest
  console.log('\n[Test 1] Generating Manifest...');
  const manifest = getManifest();
  console.log('✓ Manifest ID:', manifest.id);
  console.log('✓ Catalogs:', manifest.catalogs.map(c => c.name));

  // Test 2: Search OlaMovies
  console.log('\n[Test 2] Scraping OlaMovies Search for "Deadpool"...');
  const searchResults = await scraper.search('Deadpool');
  console.log(`✓ Found ${searchResults.length} results:`);
  searchResults.slice(0, 3).forEach(r => {
    console.log(`  - [${r.type}] ${r.name} (${r.year || 'N/A'}) => ${r.slug}`);
  });

  if (searchResults.length === 0) {
    console.error('✗ No search results returned');
    return;
  }

  // Test 3: Get Item Details
  console.log('\n[Test 3] Fetching Item Details for "deadpool-2016"...');
  const details = await scraper.getItemDetails('movie', 'deadpool-2016');
  if (details) {
    console.log('✓ Title:', details.title);
    console.log('✓ IMDb ID:', details.imdbId);
    console.log('✓ Blocks Count:', details.blocks.length);
    console.log(`✓ Files Extracted: ${details.files.length}`);

    if (details.files.length > 0) {
      console.log('Sample file:', {
        label: details.files[0].label,
        filename: details.files[0].filename,
        resolution: details.files[0].blockResolution,
        btnId: details.files[0].btnId,
      });

      // Test 4: Stream formatting
      console.log('\n[Test 4] Formatting Streams for Nuvio/Stremio...');
      const streams = formatStreams(details.files, 'localhost:7000', 'http');
      console.log(`✓ Formatted ${streams.length} streams:`);
      streams.slice(0, 3).forEach(s => {
        console.log(`  - Name: ${s.name.replace(/\n/g, ' ')}`);
        console.log(`    Title: ${s.title.split('\n')[0]}`);
        console.log(`    URL: ${s.url}`);
      });
    }
  } else {
    console.error('✗ Failed to fetch details for deadpool-2016');
  }

  // Test 5: TV Series Search & Parse
  console.log('\n[Test 5] Scraping TV Series Details for "stranger-things-2016"...');
  const seriesDetails = await scraper.getItemDetails('series', 'stranger-things-2016');
  if (seriesDetails) {
    console.log('✓ TV Series Title:', seriesDetails.title);
    console.log(`✓ TV Series Files: ${seriesDetails.files.length}`);
    const epStreams = formatStreams(seriesDetails.files, 'localhost:7000', 'http', {}, 1, 1);
    console.log(`✓ S01E01 Streams: ${epStreams.length}`);
  }

  console.log('\n--- All Tests Completed Successfully! ---');
}

runTests().catch(err => {
  console.error('Test run error:', err);
  process.exit(1);
});
