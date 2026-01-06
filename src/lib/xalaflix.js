const axios = require('axios');
const cheerio = require('cheerio');

const BASE_URL = 'https://xalaflix.men';
const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

const headers = {
    'User-Agent': USER_AGENT,
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
    'Accept-Language': 'fr-FR,fr;q=0.9,en-US;q=0.8,en;q=0.7',
    'Referer': BASE_URL
};

async function getCatalog(type, page = 1) {
    let url = '';
    if (type === 'movie') {
        url = page === 1 ? `${BASE_URL}/movies` : `${BASE_URL}/movies/page/${page}`;
    } else if (type === 'series') {
        url = page === 1 ? `${BASE_URL}/shows` : `${BASE_URL}/shows/page/${page}`;
    } else {
        return [];
    }

    try {
        const { data } = await axios.get(url, { headers });
        const $ = cheerio.load(data);
        const items = [];

        $('.single-video').each((i, element) => {
            const el = $(element);
            const link = el.find('a').attr('href');
            const poster = el.find('img').attr('src');
            const title = el.text().trim(); // Fallback if specific title selector fails, or optimize below

            if (link && poster) {
                // Extract ID from link
                // URL format: https://xalaflix.men/movies/watch/slug/ID
                // or https://xalaflix.men/shows/details/slug/ID
                // or similar. Let's just grab the last segment.
                const segments = link.split('/').filter(s => s.length > 0);
                const id = segments[segments.length - 1];

                // Better title extraction?
                // Visual check suggests title is often in an h3 or just text inside the anchor.
                // Subagent said: "Title: a span"
                // Clean up title: Remove extra whitespace and known badges
                let titleClean = titleText.replace(/\s+/g, ' ').trim();
                // Heuristic: Remove "TOP 50" prefix if present (common badge)
                titleClean = titleClean.replace(/^TOP\s+\d+\s+/, '').trim();

                items.push({
                    id: `xalaflix:${type}:${id}`,
                    type: type,
                    name: titleClean,
                    poster: poster,
                    description: ''
                });
            }
        });

        return items;
    } catch (error) {
        console.error('Error fetching catalog:', error.message);
        return [];
    }
}

async function search(query) {
    const url = `${BASE_URL}/search_elastic?s=${encodeURIComponent(query)}`;
    try {
        // Search endpoint returns HTML according to previous turn
        const { data } = await axios.get(url, { headers });
        // The return structure might be fragments. Let's assume it returns a list of items similar to catalog.
        // If it returns a JSON with html, we handle that.
        // Subagent said "returns HTML fragments".

        const $ = cheerio.load(data);
        const items = [];

        // We assume the search result uses the same .single-video or similar structure, 
        // OR it might be distinct <li> elements. 
        // Looking at typical WordPress search results:
        $('a').each((i, element) => {
            const link = $(element).attr('href');
            const poster = $(element).find('img').attr('src');
            const rawTitle = $(element).text().trim();
            let titleClean = rawTitle.replace(/\s+/g, ' ').trim();
            titleClean = titleClean.replace(/^TOP\s+\d+\s+/, '').trim();

            if (link && (link.includes('/movies/') || link.includes('/shows/')) && poster) {
                const type = link.includes('/shows/') ? 'series' : 'movie';
                const segments = link.split('/').filter(s => s.length > 0);
                const id = segments[segments.length - 1];

                items.push({
                    id: `xalaflix:${type}:${id}`,
                    type: type,
                    name: titleClean,
                    poster: poster
                });
            }
        });

        return items;
    } catch (error) {
        console.error('Error searching:', error.message);
        return [];
    }
}

async function getMeta(type, id) {
    // id: xalaflix:movie:123 or xalaflix:series:123
    const realId = id.split(':')[2];

    // Determine initial URL
    let url = '';
    if (type === 'movie') {
        url = `${BASE_URL}/movies/watch/video/${realId}`;
    } else {
        // For series, we need the main show page first
        // We might not know the exact slug, but let's try constructing one or using a search approach if this fails.
        // However, usually the ID is the key. 
        // Based on findings: https://xalaflix.men/shows/details/slug/id
        // We'll try a wildcard slug 'details'
        url = `${BASE_URL}/shows/details/show/${realId}`;
    }

    try {
        const { data } = await axios.get(url, { headers });
        const $ = cheerio.load(data);

        // Common Metadata
        const description = $('#tab1').text().trim() || $('.video-description').text().trim() || '';
        const year = $('.date-video').text().trim();
        let background = '';
        const bgStyle = $('.vfx-item-ptb-top').attr('style');
        if (bgStyle && bgStyle.includes('url(')) {
            background = bgStyle.match(/url\(['"]?(.*?)['"]?\)/)[1];
        } else {
            background = $('.video-background img').attr('src');
        }
        const poster = $('.video-img img').attr('src');

        const genres = [];
        $('a[href*="genre_id"]').each((i, el) => genres.push($(el).text().trim()));

        const cast = [];
        $('a[href*="actor_id"]').each((i, el) => cast.push($(el).text().trim()));

        const title = $('h1').text().trim();

        const meta = {
            id: id,
            type: type,
            name: title,
            description: description,
            releaseInfo: year,
            background: background,
            poster: poster,
            genres: genres,
            cast: cast,
            videos: []
        };

        if (type === 'series') {
            // Find Season Links
            // Selector: a[href*="/seasons/"]
            const seasonLinks = [];
            $('a[href*="/seasons/"]').each((i, el) => {
                seasonLinks.push($(el).attr('href'));
            });

            // Fetch episodes from each season page
            // We limit to 5 seasons to avoid timeout, or we can try to be faster
            const promises = seasonLinks.slice(0, 5).map(async (seasonUrl) => {
                try {
                    const sData = (await axios.get(seasonUrl, { headers })).data;
                    const $s = cheerio.load(sData);
                    const episodes = [];

                    // Parse Season Number from URL or Title?
                    // URL: .../seasons/stranger-things-1/246
                    // Often "stranger-things-1" implies Season 1.
                    // Or we look for "Saison 1" in the page.
                    let seasonNum = 1;
                    const pageTitle = $s('h1').text(); // e.g. "Stranger Things - Saison 1"
                    const match = pageTitle.match(/Saison\s+(\d+)/i);
                    if (match) seasonNum = parseInt(match[1]);

                    $s('.single-video').each((j, el) => {
                        const epEl = $s(el);
                        const epLink = epEl.find('a').attr('href');
                        const epTitle = epEl.find('.entry-title').text().trim() || epEl.find('a').attr('title');
                        const epImg = epEl.find('img').attr('src');

                        if (epLink) {
                            const segments = epLink.split('/').filter(s => s.length > 0);
                            const epId = segments[segments.length - 1];

                            // Extract Episode Number
                            // Title usually "Episode 1" or "1x01" etc
                            let epNum = j + 1; // Fallback
                            const epMatch = epTitle.match(/(?:Episode|Ep)\s*(\d+)/i);
                            if (epMatch) epNum = parseInt(epMatch[1]);

                            episodes.push({
                                id: `xalaflix:episode:${epId}`,
                                title: epTitle,
                                released: new Date().toISOString(), // Unknown date
                                season: seasonNum,
                                episode: epNum,
                                thumbnail: epImg
                            });
                        }
                    });
                    return episodes;
                } catch (e) {
                    console.error(`Failed to fetch season: ${seasonUrl}`, e.message);
                    return [];
                }
            });

            const results = await Promise.all(promises);
            meta.videos = results.flat().sort((a, b) => (a.season - b.season) || (a.episode - b.episode));
        }

        return meta;

    } catch (error) {
        console.error('Error fetching meta:', error.message);
        return null;
    }
}

async function getStream(type, id) {
    // id: xalaflix:movie:123 or xalaflix:episode:456
    const parts = id.split(':');
    const realType = parts[1]; // movie or episode
    const realId = parts[2];

    let url = '';
    if (realType === 'movie') {
        // We verified that /movies/watch/anything/ID works
        url = `${BASE_URL}/movies/watch/video/${realId}`;
    } else {
        // Episode
        // We assume a similar pattern for episodes. 
        // Based on scraping, shows use /shows/details/...
        url = `${BASE_URL}/shows/details/video/${realId}`;
    }

    console.log(`Fetching stream from: ${url}`);

    try {
        const { data } = await axios.get(url, { headers });
        const $ = cheerio.load(data);

        // 1. Check direct video tag (found in dump)
        const videoSrc = $('video#player source').attr('src') || $('video#player').attr('src');
        if (videoSrc) {
            // Use the proxy
            // Note: In production add-ons, you'd want to detect the host or use a config.
            // For local usage, we assume localhost:7000 or relative if supported (Stremio doesn't like relative).
            // We'll trust the process.env.HOST or default.
            const addonHost = process.env.ADDON_HOST || 'http://127.0.0.1:7000';
            const proxyUrl = `${addonHost}/proxy?url=${encodeURIComponent(videoSrc)}`;

            return [{
                url: proxyUrl,
                title: '1080p (Proxied)',
                behaviorHints: {
                    notWebReady: false, // It IS web ready now because we proxy it
                    bingeGroup: `xalaflix-${realId}`
                }
            }];
        }

        // 2. Check iframe
        const iframeSrc = $('iframe').attr('src');
        if (iframeSrc) {
            return [{
                url: iframeSrc,
                title: 'Embed'
            }];
        }

        return [];
    } catch (e) {
        console.error('Error in getStream:', e.message);
        return [];
    }
}

module.exports = {
    getCatalog,
    search,
    getMeta,
    getStream
};
