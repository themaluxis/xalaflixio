const axios = require('axios');
const cheerio = require('cheerio');
const fs = require('fs');

const BASE_URL = 'https://fs02.lol';
const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

const headers = {
    'User-Agent': USER_AGENT,
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
    'Referer': BASE_URL
};

async function debugSearch() {
    // Try the live search endpoint that the browser uses
    const url = `${BASE_URL}/?search=Inception`;

    try {
        const { data } = await axios.get(url, { headers });

        // Save the HTML to a file for inspection
        fs.writeFileSync('/tmp/frenchstream_search.html', data);
        console.log('HTML saved to /tmp/frenchstream_search.html');

        const $ = cheerio.load(data);

        console.log('\n=== Page Analysis ===');
        console.log('Title:', $('title').text());
        console.log('\n=== Looking for search results ===');

        // Try various selectors
        const selectors = [
            '.search-item',
            '.short',
            '.short-item',
            '.movie-item',
            '.item',
            'article',
            '.result',
            '[class*="search"]',
            '[class*="item"]'
        ];

        selectors.forEach(sel => {
            const count = $(sel).length;
            if (count > 0) {
                console.log(`${sel}: ${count} elements`);
                // Show first element's HTML
                console.log('First element HTML:', $(sel).first().html()?.substring(0, 200));
            }
        });

        // Look for links to films or shows
        console.log('\n=== Links to content ===');
        $('a[href*="/films/"], a[href*="/s-tv/"]').each((i, el) => {
            if (i < 5) { // Show first 5
                console.log(`Link ${i + 1}:`, $(el).attr('href'), '-', $(el).text().trim().substring(0, 50));
            }
        });

    } catch (error) {
        console.error('Error:', error.message);
    }
}

debugSearch();
