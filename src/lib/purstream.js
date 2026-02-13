const axios = require('axios');

const API_BASE = 'https://api.purstream.me/api/v1';
const SITE_BASE = 'https://purstream.me';
const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

const headers = {
    'User-Agent': USER_AGENT,
    'Accept': 'application/json',
    'Accept-Language': 'fr-FR,fr;q=0.9,en-US;q=0.8,en;q=0.7',
    'Origin': SITE_BASE,
    'Referer': `${SITE_BASE}/`
};

/**
 * Fetch the catalog of movies or series from Purstream
 * @param {string} type - 'movie' or 'series'
 * @param {number} page - Page number (1-indexed)
 * @returns {Array} - List of items for Stremio
 */
async function getCatalog(type, page = 1) {
    // Map Stremio types to Purstream API types
    const apiType = type === 'series' ? 'tv' : 'movie';

    const url = `${API_BASE}/catalog/movies?page=${page}&sortBy=best-rated&types=${apiType}&categoriesIds=*&franchisesIds=*&perPage=20`;

    try {
        const { data } = await axios.get(url, { headers });

        if (data.type !== 'success' || !data.data?.items?.data) {
            console.error('Purstream catalog: unexpected response structure');
            return [];
        }

        return data.data.items.data.map(item => ({
            id: `purstream:${type}:${item.id}`,
            type: type,
            name: item.title,
            poster: item.large_poster_path,
            background: item.wallpaper_poster_path || item.small_poster_path,
            description: '',
            releaseInfo: item.release_date ? item.release_date.substring(0, 4) : ''
        }));

    } catch (error) {
        console.error('Error fetching Purstream catalog:', error.message);
        return [];
    }
}

/**
 * Search for movies and series on Purstream
 * @param {string} query - Search query
 * @returns {Array} - List of search results
 */
async function search(query) {
    const url = `${API_BASE}/search-bar/search/${encodeURIComponent(query)}`;

    try {
        const { data } = await axios.get(url, { headers });

        if (data.type !== 'success' || !data.data?.items?.movies?.items) {
            console.error('Purstream search: unexpected response structure');
            return [];
        }

        const items = data.data.items.movies.items;

        return items.map(item => {
            const stremioType = item.type === 'tv' ? 'series' : 'movie';
            return {
                id: `purstream:${stremioType}:${item.id}`,
                type: stremioType,
                name: item.title,
                poster: item.large_poster_path,
                releaseInfo: item.release_date ? item.release_date.substring(0, 4) : ''
            };
        });

    } catch (error) {
        console.error('Error searching Purstream:', error.message);
        return [];
    }
}

/**
 * Get metadata for a movie or series from Purstream
 * @param {string} type - 'movie' or 'series'
 * @param {string} id - Purstream ID (e.g., 'purstream:movie:2128')
 * @returns {Object|null} - Metadata object or null
 */
async function getMeta(type, id) {
    const realId = id.split(':')[2];
    const url = `${API_BASE}/media/${realId}/sheet`;

    try {
        const { data } = await axios.get(url, { headers });

        if (data.type !== 'success' || !data.data?.items) {
            console.error('Purstream getMeta: unexpected response structure');
            return null;
        }

        const item = data.data.items;

        const meta = {
            id: id,
            type: type,
            name: item.title,
            description: item.overview || '',
            releaseInfo: item.releaseDate || '',
            poster: item.posters?.large || '',
            background: item.posters?.wallpaper || item.posters?.small || '',
            genres: (item.categories || []).map(c => c.name),
            runtime: item.runtime ? item.runtime.human : '',
            videos: []
        };

        // For series, fetch season/episode data
        if (type === 'series' && item.seasons > 0) {
            const totalSeasons = item.seasons;
            const promises = [];

            for (let s = 1; s <= totalSeasons; s++) {
                promises.push(fetchSeason(realId, s, id));
            }

            const results = await Promise.all(promises);
            meta.videos = results.flat().sort((a, b) =>
                (a.season - b.season) || (a.episode - b.episode)
            );
        }

        return meta;

    } catch (error) {
        console.error('Error fetching Purstream meta:', error.message);
        return null;
    }
}

/**
 * Fetch episodes for a specific season
 * @param {string} mediaId - The numeric Purstream media ID
 * @param {number} seasonNum - Season number
 * @param {string} seriesId - The full Stremio ID prefix
 * @returns {Array} - List of episode video objects
 */
async function fetchSeason(mediaId, seasonNum, seriesId) {
    const url = `${API_BASE}/media/${mediaId}/season/${seasonNum}`;

    try {
        const { data } = await axios.get(url, { headers });

        if (data.type !== 'success' || !data.data?.items?.episodes) {
            return [];
        }

        return data.data.items.episodes.map(ep => ({
            id: `purstream:episode:${mediaId}:${seasonNum}:${ep.episode}`,
            title: ep.name || ep.formattedName || `S${seasonNum}E${ep.episode}`,
            released: ep.airDate ? new Date(ep.airDate).toISOString() : new Date().toISOString(),
            season: seasonNum,
            episode: ep.episode,
            overview: ep.overview || '',
            thumbnail: ep.poster || ''
        }));

    } catch (error) {
        console.error(`Error fetching Purstream season ${seasonNum}:`, error.message);
        return [];
    }
}

/**
 * Get stream URLs for a movie or episode
 * @param {string} type - 'movie' or 'series'
 * @param {string} id - Purstream ID (e.g., 'purstream:movie:2128' or 'purstream:episode:3830:1:1')
 * @returns {Array} - List of stream objects for Stremio
 */
async function getStream(type, id) {
    const parts = id.split(':');
    const realType = parts[1]; // movie or episode
    const mediaId = parts[2];

    let url;
    if (realType === 'episode') {
        const season = parts[3];
        const episode = parts[4];
        url = `${API_BASE}/stream/${mediaId}/episode?season=${season}&episode=${episode}`;
    } else {
        // movie
        url = `${API_BASE}/stream/${mediaId}`;
    }

    console.log(`Fetching Purstream stream from: ${url}`);

    try {
        const { data } = await axios.get(url, { headers });

        if (data.type !== 'success' || !data.data?.items?.sources) {
            console.error('Purstream getStream: unexpected response structure');
            return [];
        }

        const sources = data.data.items.sources;

        return sources.map(source => {
            const streamUrl = source.stream_url;

            // Use the proxy to handle CORS and headers
            const addonHost = process.env.ADDON_HOST || 'http://127.0.0.1:7000';
            const proxyUrl = `${addonHost}/proxy?url=${encodeURIComponent(streamUrl)}`;

            return {
                url: proxyUrl,
                title: `🇫🇷 Purstream ${source.source_name || 'Source'} (${source.format || 'mp4'})`,
                behaviorHints: {
                    notWebReady: false,
                    bingeGroup: `purstream-${mediaId}`
                }
            };
        });

    } catch (error) {
        console.error('Error fetching Purstream stream:', error.message);
        return [];
    }
}

/**
 * Search for a series and get a specific episode ID
 * @param {string} seriesId - The purstream series ID (e.g., 'purstream:series:3830')
 * @param {number} seasonNum - Season number
 * @param {number} episodeNum - Episode number
 * @returns {string|null} - Episode ID or null if not found
 */
async function searchAndGetEpisode(seriesId, seasonNum, episodeNum) {
    try {
        const parts = seriesId.split(':');
        const mediaId = parts[2];

        // Directly construct the episode ID since Purstream uses a structured API
        // We just need to verify the episode exists by fetching the season
        const url = `${API_BASE}/media/${mediaId}/season/${seasonNum}`;
        const { data } = await axios.get(url, { headers });

        if (data.type !== 'success' || !data.data?.items?.episodes) {
            console.log('No episodes found for series:', seriesId);
            return null;
        }

        const episodes = data.data.items.episodes;
        const episode = episodes.find(ep => ep.episode === episodeNum);

        if (episode) {
            const epId = `purstream:episode:${mediaId}:${seasonNum}:${episodeNum}`;
            console.log(`Found Purstream episode: ${episode.name} (${epId})`);
            return epId;
        }

        // Try fuzzy matching
        const fuzzyEpisode = episodes.find(ep =>
            Math.abs(ep.episode - episodeNum) <= 1
        );

        if (fuzzyEpisode) {
            const epId = `purstream:episode:${mediaId}:${seasonNum}:${fuzzyEpisode.episode}`;
            console.log(`Found fuzzy Purstream match: ${fuzzyEpisode.name} (${epId})`);
            return epId;
        }

        console.log(`Purstream: Episode S${seasonNum}E${episodeNum} not found in series`);
        return null;

    } catch (e) {
        console.error('Error in Purstream searchAndGetEpisode:', e.message);
        return null;
    }
}

module.exports = {
    getCatalog,
    search,
    getMeta,
    getStream,
    searchAndGetEpisode
};
