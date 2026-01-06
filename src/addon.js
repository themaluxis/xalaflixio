const axios = require('axios');
const { addonBuilder } = require('stremio-addon-sdk');
const { getCatalog, getMeta, getStream, search, searchAndGetEpisode } = require('./lib/xalaflix');

const manifest = require('./manifest');
const builder = new addonBuilder(manifest);

// Helper: Normalize string for comparison
function normalizeTitle(str) {
    return str.toLowerCase()
        .replace(/[^a-z0-9]/g, '')
        .replace(/\s+/g, '');
}

// Helper: Calculate similarity between two strings (Levenshtein-based)
function similarity(s1, s2) {
    const longer = s1.length > s2.length ? s1 : s2;
    const shorter = s1.length > s2.length ? s2 : s1;
    const longerLength = longer.length;
    if (longerLength === 0) return 1.0;
    return (longerLength - editDistance(longer, shorter)) / longerLength;
}

function editDistance(s1, s2) {
    const costs = [];
    for (let i = 0; i <= s1.length; i++) {
        let lastValue = i;
        for (let j = 0; j <= s2.length; j++) {
            if (i === 0) { costs[j] = j; }
            else if (j > 0) {
                let newValue = costs[j - 1];
                if (s1.charAt(i - 1) !== s2.charAt(j - 1)) {
                    newValue = Math.min(Math.min(newValue, lastValue), costs[j]) + 1;
                }
                costs[j - 1] = lastValue;
                lastValue = newValue;
            }
        }
        if (i > 0) costs[s2.length] = lastValue;
    }
    return costs[s2.length];
}

// Helper: Find best matching result from search
function findBestMatch(searchResults, title, targetType, year = null) {
    const normalizedTitle = normalizeTitle(title);

    // Filter by type first
    const typeFiltered = searchResults.filter(item => item.type === targetType);

    if (typeFiltered.length === 0) {
        // Fall back to all results if no type match
        return findBestMatchInList(searchResults, normalizedTitle, title, year);
    }

    return findBestMatchInList(typeFiltered, normalizedTitle, title, year);
}

function findBestMatchInList(items, normalizedTitle, originalTitle, year) {
    let bestMatch = null;
    let bestScore = 0;

    for (const item of items) {
        const normalizedItemName = normalizeTitle(item.name);

        // Exact match (normalized)
        if (normalizedItemName === normalizedTitle) {
            return item; // Perfect match
        }

        // Check if one contains the other
        if (normalizedItemName.includes(normalizedTitle) || normalizedTitle.includes(normalizedItemName)) {
            const score = similarity(normalizedItemName, normalizedTitle);
            if (score > bestScore) {
                bestScore = score;
                bestMatch = item;
            }
        }

        // Fuzzy match with similarity score
        const sim = similarity(normalizedItemName, normalizedTitle);
        if (sim > 0.7 && sim > bestScore) { // 70% similarity threshold
            bestScore = sim;
            bestMatch = item;
        }
    }

    return bestMatch;
}

builder.defineCatalogHandler(async ({ type, id, extra }) => {
    console.log('Catalog Request:', type, id, extra);

    if (extra.search) {
        const results = await search(extra.search);
        return { metas: results.filter(item => item.type === type) };
    }

    // Pagination
    const page = extra.skip ? Math.floor(extra.skip / 20) + 1 : 1;
    const items = await getCatalog(type, page);
    return { metas: items };
});

builder.defineMetaHandler(async ({ type, id }) => {
    console.log('Meta Request:', type, id);
    if (id.startsWith('tt')) return { meta: {} };

    const item = await getMeta(type, id);
    if (!item) return { meta: {} };
    return { meta: item };
});

builder.defineStreamHandler(async ({ type, id }) => {
    console.log('Stream Request:', type, id);

    // Parse the ID - could be:
    // - tt1234567 (IMDB movie)
    // - tt1234567:1:5 (IMDB series, season 1, episode 5)
    // - xalaflix:movie:123
    // - xalaflix:series:123
    // - xalaflix:episode:456

    let xalaflixId = id;
    let season = null;
    let episode = null;

    // Check if it's an IMDB ID
    if (id.startsWith('tt')) {
        // Parse IMDB ID - might include season:episode for series
        const parts = id.split(':');
        const imdbId = parts[0];

        if (parts.length >= 3) {
            // Series episode: tt1234567:1:5
            season = parseInt(parts[1]);
            episode = parseInt(parts[2]);
        }

        console.log(`Resolving IMDB ID: ${imdbId}${season ? ` S${season}E${episode}` : ''}`);

        try {
            // 1. Get Meta from Cinemeta to find the Title
            // For episodes, we need the parent series metadata
            const metaType = type === 'series' ? 'series' : 'movie';
            const metaUrl = `https://v3-cinemeta.strem.io/meta/${metaType}/${imdbId}.json`;
            const { data } = await axios.get(metaUrl);
            const meta = data.meta;

            if (!meta || !meta.name) {
                console.log('Could not find meta for:', imdbId);
                return { streams: [] };
            }

            const title = meta.name;
            const year = meta.releaseInfo ? meta.releaseInfo.substring(0, 4) : '';

            // Collect all possible title variations to search
            const titlesToTry = [title];

            // Add AKA titles if available (Cinemeta sometimes includes these)
            if (meta.slug) {
                const slugTitle = meta.slug.replace(/-/g, ' ');
                if (slugTitle.toLowerCase() !== title.toLowerCase()) {
                    titlesToTry.push(slugTitle);
                }
            }

            // Try searching with progressively simpler title variations
            let match = null;
            let searchResults = [];
            const targetType = type === 'series' ? 'series' : 'movie';

            for (const searchTitle of titlesToTry) {
                console.log(`Searching Xalaflix for: "${searchTitle}" (${year})`);
                searchResults = await search(searchTitle);
                console.log(`Found ${searchResults.length} search results`);

                if (searchResults.length > 0) {
                    match = findBestMatch(searchResults, title, targetType, year);
                    if (match) break;

                    // Also try matching against the current search title
                    match = findBestMatch(searchResults, searchTitle, targetType, year);
                    if (match) break;
                }
            }

            // If still no match, try with just the first word (for single-word titles)
            if (!match && title.split(' ').length <= 3) {
                const simpleTitle = title.split(' ')[0];
                console.log(`Trying simple search with: "${simpleTitle}"`);
                searchResults = await search(simpleTitle);
                console.log(`Found ${searchResults.length} search results`);

                if (searchResults.length > 0) {
                    match = findBestMatch(searchResults, title, targetType, year);
                }
            }

            if (match) {
                console.log(`Found match: "${match.name}" (${match.id}) with score`);

                if (type === 'series' && season !== null && episode !== null) {
                    // For series, we need to find the specific episode
                    console.log(`Looking for S${season}E${episode}...`);
                    const episodeId = await searchAndGetEpisode(match.id, season, episode);

                    if (episodeId) {
                        console.log(`Found episode: ${episodeId}`);
                        xalaflixId = episodeId;
                    } else {
                        console.log('Episode not found on Xalaflix');
                        return { streams: [] };
                    }
                } else {
                    xalaflixId = match.id;
                }
            } else {
                console.log('No match found on Xalaflix');
                return { streams: [] };
            }

        } catch (e) {
            console.error('Error resolving IMDB ID:', e.message);
            return { streams: [] };
        }
    }

    const streams = await getStream(type, xalaflixId);
    return { streams: streams };
});

module.exports = builder.getInterface();
