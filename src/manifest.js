module.exports = {
    id: 'org.purstream.addon',
    version: '2.0.0',
    name: 'Purstream',
    description: 'Watch Movies & TV Shows from Purstream',
    resources: ['catalog', 'meta', 'stream'],
    types: ['movie', 'series'],
    catalogs: [
        {
            type: 'movie',
            id: 'purstream_movies',
            name: 'Purstream Movies',
            extra: [{ name: 'search', isRequired: false }, { name: 'skip', isRequired: false }]
        },
        {
            type: 'series',
            id: 'purstream_series',
            name: 'Purstream Series',
            extra: [{ name: 'search', isRequired: false }, { name: 'skip', isRequired: false }]
        }
    ],
    idPrefixes: ['purstream', 'tt']
};
