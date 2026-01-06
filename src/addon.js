const axios = require('axios');
const { addonBuilder } = require('stremio-addon-sdk');
const { getCatalog, getMeta, getStream, search } = require('./lib/xalaflix');

const manifest = require('./manifest');
const builder = new addonBuilder(manifest);

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
    let xalaflixId = id;

    if (id.startsWith('tt')) {
        console.log(`Resolving IMDB ID: ${id}`);
        try {
            // 1. Get Meta from Cinemeta to find the Title
            const metaUrl = `https://v3-cinemeta.strem.io/meta/${type}/${id}.json`;
            const { data } = await axios.get(metaUrl);
            const meta = data.meta;

            if (!meta || !meta.name) {
                console.log('Could not find meta for:', id);
                return { streams: [] };
            }

            const title = meta.name;
            const year = meta.releaseInfo ? meta.releaseInfo.substring(0, 4) : '';
            console.log(`Searching Xalaflix for: ${title}`);

            // 2. Search Xalaflix
            const searchResults = await search(title);

            // 3. Find best match
            const match = searchResults.find(item => {
                // Remove special chars for comparison
                const cleanA = item.name.toLowerCase().replace(/[^a-z0-9]/g, '');
                const cleanB = title.toLowerCase().replace(/[^a-z0-9]/g, '');
                return cleanA.includes(cleanB) || cleanB.includes(cleanA);
            });

            if (match) {
                console.log(`Found match: ${match.name} (${match.id})`);
                xalaflixId = match.id;
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
