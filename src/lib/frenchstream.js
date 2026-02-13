const axios = require('axios');
const cheerio = require('cheerio');

const BASE_URL = 'https://fs02.lol';
const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

const headers = {
    'User-Agent': USER_AGENT,
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
    'Accept-Language': 'fr-FR,fr;q=0.9,en-US;q=0.8,en;q=0.7',
    'Referer': BASE_URL
};

async function search(query) {
    const url = `${BASE_URL}/?search=${encodeURIComponent(query)}`;
    try {
        const { data } = await axios.get(url, { headers });
        const $ = cheerio.load(data);
        const items = [];

        $('.short').each((i, element) => {
            const el = $(element);
            const link = el.find('.short-poster').attr('href');
            const poster = el.find('.short-poster img').attr('src');
            const title = el.find('.short-title').text().trim();

            if (link && poster && title) {
                // Determine type based on URL
                // Movies: /films/..., Series: /s-tv/...
                const type = link.includes('/s-tv/') ? 'series' : 'movie';

                // Use the relative path as ID
                const id = link.replace(BASE_URL, '').replace(/^\//, '');

                items.push({
                    id: `frenchstream:${type}:${id}`,
                    type: type,
                    name: title,
                    poster: poster.startsWith('http') ? poster : BASE_URL + poster
                });
            }
        });

        return items;
    } catch (error) {
        console.error('FrenchStream Search Error:', error.message);
        return [];
    }
}

async function getMeta(type, id) {
    // ID comes in as frenchstream:movie:films/123-slug.html
    const parts = id.split(':');
    const relativePath = parts.slice(2).join(':');
    const url = `${BASE_URL}/${relativePath}`;

    try {
        const { data } = await axios.get(url, { headers });
        const $ = cheerio.load(data);

        // Extract metadata
        const title = $('h1').first().text().trim();
        const description = $('.short-story-description, .full-text').first().text().trim();
        const poster = $('.dvd-container img').attr('src') || $('.short-poster img').first().attr('src');

        // Extract year from title or page
        const yearMatch = title.match(/\((\d{4})\)/);
        const year = yearMatch ? yearMatch[1] : '';

        // Extract genres
        const genres = [];
        $('a[href*="/xfsearch/genre"]').each((i, el) => {
            genres.push($(el).text().trim());
        });

        const meta = {
            id: id,
            type: type,
            name: title,
            description: description,
            poster: poster ? (poster.startsWith('http') ? poster : BASE_URL + poster) : '',
            releaseInfo: year,
            genres: genres,
            videos: []
        };

        // For series, we need to fetch episodes
        if (type === 'series') {
            // French Stream has episodes on the same page
            // Look for episode elements
            $('.ep-title').each((j, el) => {
                const epEl = $(el);
                const epTitle = epEl.text().trim();
                const epNum = parseInt(epTitle.match(/(\d+)/)?.[1] || (j + 1));

                // Episodes are typically loaded via JavaScript, so we'll need to handle this differently
                // For now, we'll create placeholder episode data
                meta.videos.push({
                    id: `${id}:${epNum}`,
                    title: epTitle,
                    season: 1, // French Stream often doesn't separate seasons clearly
                    episode: epNum,
                    released: new Date().toISOString()
                });
            });
        }

        return meta;
    } catch (error) {
        console.error('FrenchStream GetMeta Error:', error.message);
        return null;
    }
}

async function getStream(type, id) {
    // ID comes in as frenchstream:movie:films/123-slug.html or frenchstream:episode:...
    const parts = id.split(':');
    const relativePath = parts.slice(2).join(':');
    const url = `${BASE_URL}/${relativePath}`;

    try {
        const { data } = await axios.get(url, { headers });
        const $ = cheerio.load(data);
        const streams = [];

        // 1. Check for video iframe
        const iframe = $('#video-iframe').attr('src');
        if (iframe) {
            streams.push({
                url: iframe,
                title: 'FrenchStream - Player 1',
                behaviorHints: {
                    notWebReady: false
                }
            });
        }

        // 2. Look for alternative player options
        $('.player-option, .fsctab').each((i, el) => {
            const name = $(el).text().trim();
            const dataUrl = $(el).attr('data-url') || $(el).attr('data-src');

            if (dataUrl && dataUrl !== iframe) {
                streams.push({
                    url: dataUrl,
                    title: `FrenchStream - ${name}`,
                    behaviorHints: {
                        notWebReady: false
                    }
                });
            }
        });

        return streams;
    } catch (error) {
        console.error('FrenchStream GetStream Error:', error.message);
        return [];
    }
}

module.exports = {
    search,
    getMeta,
    getStream
};
