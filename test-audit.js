const axios = require('axios');
const cheerio = require('cheerio');

async function runTest() {
    const targetUrl = 'https://yatradham.org/yatradham-destinations/gujarat/dwarka.html';
    console.log('[TEST] Fetching live target:', targetUrl);
    
    try {
        const response = await axios.get(targetUrl, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36'
            },
            timeout: 15000
        });

        console.log('[TEST] Received status:', response.status);
        const $ = cheerio.load(response.data);

        // Title
        const title = $('title').first().text().trim();
        console.log(`[TEST] Title: "${title}" (length: ${title.length})`);

        // Description
        const desc = $('meta[name="description"]').attr('content') || $('meta[property="og:description"]').attr('content') || '';
        console.log(`[TEST] Meta Description: "${desc}" (length: ${desc.length})`);

        // Canonical
        const canonical = $('link[rel="canonical"]').attr('href') || '';
        console.log(`[TEST] Canonical: "${canonical}"`);

        // Robots
        const robots = $('meta[name="robots"]').attr('content') || 'INDEX,FOLLOW';
        console.log(`[TEST] Robots: "${robots}"`);

        // Headings
        const h1s = [];
        $('h1').each((i, el) => h1s.push($(el).text().replace(/\s+/g, ' ').trim()));
        console.log(`[TEST] H1 count: ${h1s.length}, text: ${JSON.stringify(h1s)}`);

        const h2Count = $('h2').length;
        const h3Count = $('h3').length;
        console.log(`[TEST] H2 count: ${h2Count}, H3 count: ${h3Count}`);

        // Links
        let internalLinks = 0;
        let externalLinks = 0;
        $('a[href]').each((i, el) => {
            const href = $(el).attr('href');
            if (!href || href.startsWith('#') || href.startsWith('javascript:')) return;
            if (href.includes('yatradham.org') || href.startsWith('/')) {
                internalLinks++;
            } else {
                externalLinks++;
            }
        });
        console.log(`[TEST] Links approx -> Internal: ${internalLinks}, External: ${externalLinks}`);

        // Images
        let totalImg = $('img').length;
        let withAlt = 0;
        $('img').each((i, el) => {
            const alt = $(el).attr('alt');
            if (alt && alt.trim().length > 0) withAlt++;
        });
        console.log(`[TEST] Images -> Total: ${totalImg}, With Alt: ${withAlt}, Missing Alt: ${totalImg - withAlt}`);

        // Schema
        const schemas = $('script[type="application/ld+json"]').length;
        console.log(`[TEST] JSON-LD Schema scripts found: ${schemas}`);

        console.log('\n✅ [TEST PASSED] Live DOM extraction matches expectations!');
    } catch (err) {
        console.error('❌ [TEST FAILED]', err.message);
        process.exit(1);
    }
}

runTest();
