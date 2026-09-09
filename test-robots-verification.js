const axios = require('axios');

const BASE_URL = 'http://localhost:3300';

async function runTests() {
    console.log('🧪 Starting Robots.txt & Enterprise Multi-Sitemap Automated Verification...\n');

    let passed = 0;
    let failed = 0;

    function assert(condition, message) {
        if (condition) {
            console.log(`  ✅ PASS: ${message}`);
            passed++;
        } else {
            console.error(`  ❌ FAIL: ${message}`);
            failed++;
        }
    }

    // TEST 1: POST /api/robots-inspect
    try {
        console.log('[Test 1] Testing /api/robots-inspect on makemytrip.com/robots.txt...');
        const res = await axios.post(`${BASE_URL}/api/robots-inspect`, {
            url: 'https://www.makemytrip.com/robots.txt'
        });

        assert(res.data.success === true, 'Response success is true');
        assert(res.data.totalSitemaps >= 30, `Found 30+ declared sitemaps (Actual: ${res.data.totalSitemaps})`);
        assert(res.data.categories && Object.keys(res.data.categories).length > 0, `Categories categorized properly: ${Object.keys(res.data.categories).join(', ')}`);
        assert(res.data.aiBots && res.data.aiBots['GPTBot'], 'AI Bot analysis includes GPTBot');
        assert(res.data.aiBots && res.data.aiBots['Google-Extended'], 'AI Bot analysis includes Google-Extended');
        assert(res.data.aiBots && res.data.aiBots['PerplexityBot'], 'AI Bot analysis includes PerplexityBot');
        assert(res.data.aiBots && res.data.aiBots['OAI-SearchBot'], 'AI Bot analysis includes OAI-SearchBot');
        console.log('  📊 MakeMyTrip AI Bots Summary:', {
            GPTBot: res.data.aiBots['GPTBot']?.status,
            GoogleExtended: res.data.aiBots['Google-Extended']?.status,
            PerplexityBot: res.data.aiBots['PerplexityBot']?.status,
            OAISearchBot: res.data.aiBots['OAI-SearchBot']?.status
        });
    } catch (err) {
        assert(false, `Test 1 threw error: ${err.message}`);
    }

    // TEST 2: POST /api/extract-sitemap with robots.txt input
    try {
        console.log('\n[Test 2] Testing /api/extract-sitemap on makemytrip.com/robots.txt...');
        const res = await axios.post(`${BASE_URL}/api/extract-sitemap`, {
            sitemapUrl: 'https://www.makemytrip.com/robots.txt',
            autoFetchSubSitemaps: true
        });

        assert(res.data.success === true, 'Extract sitemap returned success');
        assert(res.data.sourceType === 'robots_txt', `Source type identified as robots_txt (Actual: ${res.data.sourceType})`);
        assert(res.data.declaredSitemaps && res.data.declaredSitemaps.length >= 30, `Declared sitemaps returned in response: ${res.data.declaredSitemaps?.length}`);
        assert(res.data.urls && res.data.urls.length > 0, `Automatically populated URLs from primary sitemap (Actual: ${res.data.urls?.length} URLs)`);
    } catch (err) {
        assert(false, `Test 2 threw error: ${err.message}`);
    }

    // TEST 3: Extract a specific declared vertical sitemap (e.g. sitemap-flights.xml)
    try {
        console.log('\n[Test 3] Testing 1-click loading of declared sitemap-flights.xml...');
        const res = await axios.post(`${BASE_URL}/api/extract-sitemap`, {
            sitemapUrl: 'https://www.makemytrip.com/flights/sitemap-flights.xml',
            autoFetchSubSitemaps: false
        });

        assert(res.data.success === true, 'Sitemap flights fetched successfully');
        assert(res.data.urls && res.data.urls.length > 0, `Found URLs in sitemap-flights.xml (Count: ${res.data.urls.length})`);
    } catch (err) {
        assert(false, `Test 3 threw error: ${err.message}`);
    }

    console.log(`\n========================================`);
    console.log(`Verification Complete: ${passed} Passed, ${failed} Failed`);
    console.log(`========================================\n`);

    if (failed > 0) process.exit(1);
}

runTests();
