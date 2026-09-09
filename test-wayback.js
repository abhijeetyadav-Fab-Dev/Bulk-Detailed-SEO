const axios = require('axios');
const cheerio = require('cheerio');

async function testWaybackDiff() {
    const url = 'https://web.archive.org/web/20170429210331id_/https://yatradham.org/yatradham-destinations/gujarat/dwarka.html';
    console.log('[WAYBACK] Fetching 2017 snapshot...');
    const res = await axios.get(url, {
        headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/126.0.0.0' }
    });
    const $ = cheerio.load(res.data);
    console.log('--- 2017 SNAPSHOT ---');
    console.log('Title:', $('title').text().trim());
    console.log('H1:', $('h1').text().trim());
    console.log('Meta Desc:', $('meta[name="description"]').attr('content') || 'None');
    console.log('Word Count approx:', $('body').text().replace(/\s+/g, ' ').trim().split(' ').length);
}

testWaybackDiff().catch(console.error);
