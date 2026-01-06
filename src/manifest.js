module.exports = {
    id: 'org.xalaflix.addon',
    version: '1.0.0',
    name: 'XalaFlix',
    description: 'Watch Movies & TV Shows from XalaFlix',
    resources: ['catalog', 'meta', 'stream'],
    types: ['movie', 'series'],
    catalogs: [
        {
            type: 'movie',
            id: 'xalaflix_movies',
            name: 'XalaFlix Movies',
            extra: [{ name: 'search', isRequired: false }, { name: 'skip', isRequired: false }]
        },
        {
            type: 'series',
            id: 'xalaflix_series',
            name: 'XalaFlix Series',
            extra: [{ name: 'search', isRequired: false }, { name: 'skip', isRequired: false }]
        }
    ],
    idPrefixes: ['xalaflix', 'tt']
};
