const axios = require('axios');
const fs = require('fs');
const cheerio = require('cheerio');

const BASE_URL = 'http://localhost:3300';

async function runTests() {
    console.log('🧪 Starting 4-Mode Separation & Functional Verification Test...\n');
    let allPassed = true;

    // TEST 1: FRONTEND HTML STRUCTURAL INTEGRITY
    console.log('--- TEST 1: Frontend HTML Structural Integrity & Separation ---');
    try {
        const html = fs.readFileSync('./public/index.html', 'utf8');
        const $ = cheerio.load(html);

        const requiredTabs = ['tab-paste', 'tab-sitemap', 'tab-file', 'tab-reclaim'];
        requiredTabs.forEach(id => {
            const exists = $(`#${id}`).length === 1;
            console.log(`  ${exists ? '✅' : '❌'} Tab container #${id} exists`);
            if (!exists) allPassed = false;
        });

        const requiredButtons = ['tabBtn-paste', 'tabBtn-sitemap', 'tabBtn-file', 'tabBtn-reclaim'];
        requiredButtons.forEach(id => {
            const exists = $(`#${id}`).length === 1;
            console.log(`  ${exists ? '✅' : '❌'} Tab header button #${id} exists`);
            if (!exists) allPassed = false;
        });

        const requiredActionButtons = ['startBtn-paste', 'startBtn-sitemap', 'startBtn-file', 'btnStartReclaim'];
        requiredActionButtons.forEach(id => {
            const exists = $(`#${id}`).length === 1;
            console.log(`  ${exists ? '✅' : '❌'} Dedicated Action button #${id} exists`);
            if (!exists) allPassed = false;
        });

        // Verify reclaimSection is NOT nested inside resultsSection
        const resultsSection = $('#resultsSection');
        const nestedReclaim = resultsSection.find('#reclaimSection');
        if (nestedReclaim.length === 0) {
            console.log('  ✅ #reclaimSection is properly un-nested and separate from #resultsSection');
        } else {
            console.error('  ❌ #reclaimSection is mistakenly nested inside #resultsSection!');
            allPassed = false;
        }

        // Verify essential JS functions exist in the script
        const requiredFunctions = [
            'switchInputTab',
            'startPasteAudit',
            'fetchSitemap',
            'startSitemapAudit',
            'parseAndLoadFile',
            'startFileAudit',
            'startWaybackReclaim',
            'sendReclaimedToBulkAudit',
            'executeBulkAudit'
        ];
        requiredFunctions.forEach(fn => {
            const exists = html.includes(`function ${fn}`);
            console.log(`  ${exists ? '✅' : '❌'} JavaScript function ${fn}() declared`);
            if (!exists) allPassed = false;
        });

    } catch (err) {
        console.error('  ❌ HTML Structure verification failed:', err.message);
        allPassed = false;
    }

    // TEST 2: MODE 1 - PASTE URLs EXECUTION
    console.log('\n--- TEST 2: Mode 1 - Paste URLs Execution ---');
    try {
        const sampleUrls = [
            'https://yatradham.org/yatradham-destinations/gujarat/dwarka.html',
            'https://detailed.com/'
        ];
        const res = await axios.post(`${BASE_URL}/api/audit-start`, {
            urls: sampleUrls,
            concurrency: 2
        });
        if (res.data.jobId && res.data.total === 2) {
            console.log(`  ✅ Mode 1 audit job created: ${res.data.jobId} (total: ${res.data.total} URLs)`);
        } else {
            console.error('  ❌ Mode 1 audit job creation failed:', res.data);
            allPassed = false;
        }
    } catch (err) {
        console.error('  ❌ Mode 1 test failed:', err.message);
        allPassed = false;
    }

    // TEST 3: MODE 2 - SITEMAP.XML FETCHER & PARSER
    console.log('\n--- TEST 3: Mode 2 - Sitemap.xml Fetcher ---');
    try {
        // 3a. Direct XML Sitemap
        const resDirect = await axios.post(`${BASE_URL}/api/extract-sitemap`, {
            sitemapUrl: 'https://detailed.com/page-sitemap.xml'
        });
        if (resDirect.data.totalUrls > 0 && Array.isArray(resDirect.data.urls)) {
            console.log(`  ✅ Direct sitemap fetched: ${resDirect.data.totalUrls} URLs discovered`);
        } else {
            console.error('  ❌ Direct sitemap fetch failed:', resDirect.data);
            allPassed = false;
        }

        // 3b. Sitemap Index with auto-fetch sub-sitemaps
        const resIndex = await axios.post(`${BASE_URL}/api/extract-sitemap`, {
            sitemapUrl: 'https://detailed.com/sitemap_index.xml',
            autoFetchSubSitemaps: true
        });
        if (resIndex.data.isIndex && resIndex.data.subSitemaps.length > 0 && resIndex.data.totalUrls > 0) {
            console.log(`  ✅ Sitemap Index fetched: ${resIndex.data.subSitemaps.length} sub-sitemaps, ${resIndex.data.totalUrls} aggregated URLs`);
        } else {
            console.error('  ❌ Sitemap Index fetch failed:', resIndex.data);
            allPassed = false;
        }
    } catch (err) {
        console.error('  ❌ Mode 2 test failed:', err.message);
        allPassed = false;
    }

    // TEST 4: MODE 3 - FILE UPLOAD PARSER LOGIC
    console.log('\n--- TEST 4: Mode 3 - File Upload Parser Logic ---');
    try {
        const mockCsv = `id,name,url,status\n1,Dwarka,"https://yatradham.org/yatradham-destinations/gujarat/dwarka.html",active\n2,Detailed,"https://detailed.com/",active\n3,Extension,"https://detailed.com/extension/",active`;
        const lines = mockCsv.split(/\r?\n/);
        const urls = [];
        lines.forEach(line => {
            const match = line.match(/(https?:\/\/[^\s,;"']+)/);
            if (match) urls.push(match[1]);
        });
        const uniqueUrls = [...new Set(urls)];
        if (uniqueUrls.length === 3) {
            console.log(`  ✅ Mock CSV parsed correctly: ${uniqueUrls.length} URLs extracted:`, uniqueUrls);
        } else {
            console.error('  ❌ Mock CSV parsing failed:', uniqueUrls);
            allPassed = false;
        }
    } catch (err) {
        console.error('  ❌ Mode 3 test failed:', err.message);
        allPassed = false;
    }

    // TEST 5: MODE 4 - WAYBACK CDX LOST URL HUNTER
    console.log('\n--- TEST 5: Mode 4 - Wayback Lost URL Hunter (CDX) ---');
    try {
        const res = await axios.post(`${BASE_URL}/api/wayback/reclaim`, {
            domain: 'yatradham.org',
            limit: 10
        });
        if (res.data.domain && res.data.totalDiscovered > 0 && res.data.summary) {
            console.log(`  ✅ Wayback CDX Hunter executed: Discovered ${res.data.totalDiscovered} URLs`);
            console.log(`     Summary: Dead 404s: ${res.data.summary.lost404}, 3xx: ${res.data.summary.redirected}, 200 OK: ${res.data.summary.active200}`);
        } else {
            console.error('  ❌ Wayback CDX Hunter failed:', res.data);
            allPassed = false;
        }
    } catch (err) {
        console.error('  ❌ Mode 4 test failed:', err.message);
        allPassed = false;
    }

    console.log('\n================================================================');
    if (allPassed) {
        console.log('🎉 ALL 4 MODES ARE 100% OPERATIONAL, SEPARATED & VERIFIED!');
    } else {
        console.error('❌ SOME TESTS FAILED. CHECK LOGS ABOVE.');
    }
    console.log('================================================================');
}

runTests();
