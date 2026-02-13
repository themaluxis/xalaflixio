const { search, getStream } = require('./src/lib/frenchstream');
const axios = require('axios');
const cheerio = require('cheerio');

async function test() {
    console.log('--- Testing Search (Movie) ---');
    const results = await search('Inception');
    console.log(`Found ${results.length} results`);
    if (results.length > 0) {
        console.log('First result:', results[0]);

        console.log('\n--- Testing Stream (Movie) ---');
        const streams = await getStream(results[0].type, results[0].id);
        console.log('Streams:', streams);
    }

    console.log('\n--- Testing Search (Series) ---');
    const seriesResults = await search('Breaking Bad');
    console.log(`Found ${seriesResults.length} results`);
    if (seriesResults.length > 0) {
        console.log('First result:', seriesResults[0]);

        // Let's inspect the series page content directly to help us build the episode parser
        console.log('\n--- Inspecting Series Page ---');
        const idParts = seriesResults[0].id.split(':');
        const path = idParts.slice(2).join(':');
        const url = `https://fs02.lol/${path}`;
        console.log('URL:', url);
        try {
            const { data } = await axios.get(url, {
                headers: {
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                    'Referer': 'https://fs02.lol'
                }
            });
            const $ = cheerio.load(data);

            console.log('Episode List Check:');
            // Check for common patterns
            const episodeElements = [];
            $('.ep-title, .episode-item, li a').each((i, el) => {
                const text = $(el).text().trim();
                const link = $(el).attr('href');
                const onclick = $(el).attr('onclick');
                if ((text.includes('Episode') || text.match(/^\d+$/)) && (link || onclick)) {
                    episodeElements.push({ text, link, onclick });
                }
            });
            console.log(episodeElements.slice(0, 10)); // Show first 10

            // Check for VF/VOSTFR sections
            const vfSection = $('#select-all-vf').length > 0;
            console.log('Has VF Section:', vfSection);

        } catch (e) {
            console.error('Error fetching series page:', e.message);
        }
    }
}

test();
