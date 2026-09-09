const axios = require('axios');

async function testWaybackSuite() {
    console.log('[TEST] Starting Wayback Machine Suite Verification...');
    const baseUrl = 'http://127.0.0.1:3300';
    const testUrl = 'https://yatradham.org/yatradham-destinations/gujarat/dwarka.html';

    try {
        // 1. Test /api/wayback/meta
        console.log('\n--- 1. Testing /api/wayback/meta ---');
        const metaRes = await axios.post(`${baseUrl}/api/wayback/meta`, { url: testUrl });
        console.log('[META] Available:', metaRes.data.available);
        console.log('[META] Earliest Capture:', metaRes.data.earliest?.dateFormatted, `(${metaRes.data.earliest?.age})`);
        console.log('[META] Latest Capture:', metaRes.data.latest?.dateFormatted);
        if (!metaRes.data.available || !metaRes.data.earliest) {
            throw new Error('Meta endpoint did not return expected earliest snapshot data');
        }

        // 2. Test /api/wayback/diff
        console.log('\n--- 2. Testing /api/wayback/diff (Earliest Preset) ---');
        const diffRes = await axios.post(`${baseUrl}/api/wayback/diff`, {
            url: testUrl,
            timePreset: 'earliest'
        });
        console.log('[DIFF] Snapshot Date:', diffRes.data.diff.snapshotDate);
        console.log('[DIFF] Historical Title:', diffRes.data.diff.title.historical);
        console.log('[DIFF] Current Title:', diffRes.data.diff.title.current);
        console.log('[DIFF] Title Changed:', diffRes.data.diff.title.changed);
        console.log('[DIFF] Word Count Diff:', `${diffRes.data.diff.wordCount.historical} -> ${diffRes.data.diff.wordCount.current} (${diffRes.data.diff.wordCount.percentChange}%)`);
        if (!diffRes.data.success || !diffRes.data.diff) {
            throw new Error('Diff endpoint failed to return diff structure');
        }

        // 3. Test /api/wayback/resurrect
        console.log('\n--- 3. Testing /api/wayback/resurrect ---');
        const resurrectRes = await axios.post(`${baseUrl}/api/wayback/resurrect`, { url: testUrl });
        console.log('[RESURRECT] Snapshot Date:', resurrectRes.data.snapshotDate);
        console.log('[RESURRECT] Recovered Title:', resurrectRes.data.data?.overview?.title);
        console.log('[RESURRECT] Recovered Text Length:', resurrectRes.data.extractedTextSnippet?.length);
        if (!resurrectRes.data.success || !resurrectRes.data.extractedTextSnippet) {
            throw new Error('Resurrect endpoint failed to extract body snippet');
        }

        // 4. Test /api/wayback/reclaim
        console.log('\n--- 4. Testing /api/wayback/reclaim (CDX) ---');
        const reclaimRes = await axios.post(`${baseUrl}/api/wayback/reclaim`, {
            domain: 'yatradham.org',
            limit: 10
        });
        console.log('[RECLAIM] Total Discovered:', reclaimRes.data.totalDiscovered);
        console.log('[RECLAIM] Summary:', reclaimRes.data.summary);
        console.log('[RECLAIM] Sample URL check:', reclaimRes.data.items[0]?.url, '-> Status:', reclaimRes.data.items[0]?.liveStatus);
        if (!Array.isArray(reclaimRes.data.items)) {
            throw new Error('Reclaim endpoint did not return items array');
        }

        console.log('\n🎉 [ALL 4 WAYBACK SUITE TESTS PASSED 100% ACCURATELY!]');
        process.exit(0);

    } catch (err) {
        console.error('❌ [WAYBACK TEST FAILED]:', err.message);
        if (err.response) {
            console.error('Response status:', err.response.status, 'data:', err.response.data);
        }
        process.exit(1);
    }
}

testWaybackSuite();
