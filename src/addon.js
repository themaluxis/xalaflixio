const axios = require('axios');
const { addonBuilder } = require('stremio-addon-sdk');
const { getCatalog, getMeta, getStream, search, searchAndGetEpisode } = require('./lib/purstream');
const frenchStream = require('./lib/frenchstream');

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

    // Handle direct purstream/frenchstream IDs first
    if (id.startsWith('purstream:')) {
        const streams = await getStream(type, id);
        return { streams: streams };
    }

    if (id.startsWith('frenchstream:')) {
        const streams = await frenchStream.getStream(type, id);
        return { streams: streams };
    }

    // Parse IMDB ID
    if (id.startsWith('tt')) {
        const parts = id.split(':');
        const imdbId = parts[0];
        let season = null;
        let episode = null;

        if (parts.length >= 3) {
            season = parseInt(parts[1]);
            episode = parseInt(parts[2]);
        }

        console.log(`Resolving IMDB ID: ${imdbId}${season ? ` S${season}E${episode}` : ''}`);

        try {
            // Get metadata from Cinemeta
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

            // Collect title variations
            const titlesToTry = [title];
            if (meta.slug) {
                const slugTitle = meta.slug.replace(/-/g, ' ');
                if (slugTitle.toLowerCase() !== title.toLowerCase()) {
                    titlesToTry.push(slugTitle);
                }
            }

            const targetType = type === 'series' ? 'series' : 'movie';
            let purstreamMatch = null;
            let frenchStreamMatch = null;

            // Search both sources
            for (const searchTitle of titlesToTry) {
                console.log(`Searching for: "${searchTitle}" (${year})`);

                // Search Purstream
                const purstreamResults = await search(searchTitle);
                console.log(`Found ${purstreamResults.length} Purstream results`);

                if (purstreamResults.length > 0) {
                    purstreamMatch = findBestMatch(purstreamResults, title, targetType, year);
                    if (!purstreamMatch) {
                        purstreamMatch = findBestMatch(purstreamResults, searchTitle, targetType, year);
                    }
                }

                // Search French Stream
                const frenchStreamResults = await frenchStream.search(searchTitle);
                console.log(`Found ${frenchStreamResults.length} FrenchStream results`);

                if (frenchStreamResults.length > 0) {
                    frenchStreamMatch = findBestMatch(frenchStreamResults, title, targetType, year);
                    if (!frenchStreamMatch) {
                        frenchStreamMatch = findBestMatch(frenchStreamResults, searchTitle, targetType, year);
                    }
                }

                if (purstreamMatch || frenchStreamMatch) break;
            }

            // Try simple search if no match
            if (!purstreamMatch && !frenchStreamMatch && title.split(' ').length <= 3) {
                const simpleTitle = title.split(' ')[0];
                console.log(`Trying simple search with: "${simpleTitle}"`);

                const purstreamResults = await search(simpleTitle);
                const frenchStreamResults = await frenchStream.search(simpleTitle);

                console.log(`Found ${purstreamResults.length} Purstream, ${frenchStreamResults.length} FrenchStream results`);

                if (purstreamResults.length > 0) {
                    purstreamMatch = findBestMatch(purstreamResults, title, targetType, year);
                }
                if (frenchStreamResults.length > 0) {
                    frenchStreamMatch = findBestMatch(frenchStreamResults, title, targetType, year);
                }
            }

            // Collect streams from all sources
            const allStreams = [];

            // Get Purstream streams
            if (purstreamMatch) {
                console.log(`Found Purstream match: "${purstreamMatch.name}" (${purstreamMatch.id})`);

                if (type === 'series' && season !== null && episode !== null) {
                    console.log(`Looking for S${season}E${episode} on Purstream...`);
                    const episodeId = await searchAndGetEpisode(purstreamMatch.id, season, episode);

                    if (episodeId) {
                        console.log(`Found episode: ${episodeId}`);
                        const streams = await getStream(type, episodeId);
                        allStreams.push(...streams);
                    } else {
                        console.log('Episode not found on Purstream');
                    }
                } else {
                    const streams = await getStream(type, purstreamMatch.id);
                    allStreams.push(...streams);
                }
            }

            // Get French Stream streams
            if (frenchStreamMatch) {
                console.log(`Found FrenchStream match: "${frenchStreamMatch.name}" (${frenchStreamMatch.id})`);

                try {
                    const fsStreams = await frenchStream.getStream(type, frenchStreamMatch.id);
                    allStreams.push(...fsStreams);
                } catch (e) {
                    console.error('Error getting FrenchStream streams:', e.message);
                }
            }

            if (allStreams.length === 0) {
                console.log('No streams found from any source');
                return { streams: [] };
            }

            return { streams: allStreams };

        } catch (e) {
            console.error('Error resolving IMDB ID:', e.message);
            return { streams: [] };
        }
    }

    return { streams: [] };
});

module.exports = builder.getInterface();
