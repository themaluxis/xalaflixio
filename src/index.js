const express = require('express');
const { getRouter } = require('stremio-addon-sdk');
const addonInterface = require('./addon');
const axios = require('axios');
const rangeParser = require('range-parser');

const app = express();
const addonRouter = getRouter(addonInterface);

const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
const REFERER = 'https://xalaflix.io/';

// Proxy Endpoint
app.get('/proxy', async (req, res) => {
    const streamUrl = req.query.url;
    if (!streamUrl) return res.status(400).send('No URL provided');

    // Headers to send to the upstream server
    const headers = {
        'User-Agent': USER_AGENT,
        'Referer': REFERER,
        'Origin': 'https://xalaflix.io'
    };

    // Forward Range header if present
    if (req.headers.range) {
        headers['Range'] = req.headers.range;
    }

    try {
        const response = await axios({
            method: 'get',
            url: streamUrl,
            headers: headers,
            responseType: 'stream',
            validateStatus: status => status >= 200 && status < 400
        });

        // Forward response headers
        res.status(response.status);

        // Copy relevant headers
        const headersToForward = [
            'content-type', 'content-length', 'content-range', 'accept-ranges', 'content-encoding'
        ];
        headersToForward.forEach(h => {
            if (response.headers[h]) res.setHeader(h, response.headers[h]);
        });

        // Handle pipe errors
        response.data.on('error', (err) => {
            console.error('Proxy Stream Error:', err.message);
            if (!res.headersSent) res.status(500).end();
        });

        req.on('close', () => {
            // Request cancelled
            if (response.data && typeof response.data.destroy === 'function') {
                response.data.destroy();
            }
        });

        response.data.pipe(res);

    } catch (error) {
        console.error('Proxy Request Error:', error.message);
        if (error.response) {
            console.error('Upstream status:', error.response.status);
            res.status(error.response.status).send(error.message);
        } else {
            res.status(500).send('Internal Server Error');
        }
    }
});

app.use('/', addonRouter);

app.listen(7000, () => {
    console.log('Addon running on http://localhost:7000');
});
