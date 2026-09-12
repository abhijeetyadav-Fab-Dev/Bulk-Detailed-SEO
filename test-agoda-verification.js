const axios = require('axios');

const AGODA_URL = 'https://www.agoda.com/en-in/search?campaignid=23147171666&searchdatetype=default&lt=0&numberofchildren=0&gsite=localuniversal&partnercurrency=INR&masterroomid=1306805227&pricetotal=6268.00&pricetax=1510.25&pricefee=0.00&usercountry=IN&currency=INR&userdevice=desktop&verif=false&audience_list=8954557899&mcid=332&booking_source=cpc&adtype=1&mpt=WWtMZUQ3YTJqd0doWlZQL3V0VkhoenFWT3Jua28zZU94cnFvY1pVYUhVUlJHL1JlTGxZeXZmYnJEa3c2ckd1UTRGVHNYTjNTZVJIckNRdkg&original_rr=IN_LQ&gaclicksrc=tpa&clicktype=hotel&gad_source=0&gad_campaignid=23147171666&gbraid=0AAAAAC_zgIyuWppxZEk0rU_34pzPo1V-p&gclid=Cj0KCQjw8JPVBhD-ARIsAO691sGpuabHlHlRB5LCAQLWAlm8YzM_klhHFhKxQ9w9pI1m5WNhNmQOb_waAlOhEALw_wcB&los=1&adults=2&rooms=1&checkin=2026-09-12&checkout=2026-09-13&selectedproperty=83768682&city=7394&cid=1833981&pslc=1&ds=G0QMtK2S6R9CqrH5';

async function testAgodaAudit() {
    console.log('🧪 Running Live Verification on Agoda Search URL...\n');
    try {
        const res = await axios.post('http://localhost:3300/api/audit', {
            url: AGODA_URL
        }, { timeout: 20000 });

        console.log('Response status:', res.status);
        console.log('Success:', res.data.success);
        if (!res.data.success) {
            console.error('Audit failed:', res.data.error);
            process.exit(1);
        }

        const data = res.data.data;
        const ov = data.overview;
        const rend = data.rendering;
        const sc = data.schema;

        console.log('\n--- OVERVIEW METRICS ---');
        console.log(`Title (${ov.titleLength} chars): "${ov.title}"`);
        console.log(`Description (${ov.descriptionLength} chars): "${ov.description}"`);
        console.log('Indexable:', ov.indexable);
        console.log('Indexable Reason:', ov.indexableReason);
        console.log('Robots Tag in HTML:', ov.robotsMeta ? `"${ov.robotsMeta}"` : '(None in HTML)');
        console.log('Robots Meta Display:', ov.robotsMetaDisplay);
        console.log('Robots.txt Status:', ov.robotsTxt.status);
        console.log('Robots.txt Matched Rule:', ov.robotsTxt.matchedRule);
        console.log('Word Count:', ov.wordCount);
        console.log('Keywords:', ov.keywords);

        console.log('\n--- SPA & HYDRATION INTELLIGENCE ---');
        console.log('Rendering Type:', rend?.type);
        console.log('Framework:', rend?.framework);
        console.log('Is SPA:', rend?.isSpa);
        console.log('Is Faceted Search:', rend?.isFacetedSearch);
        console.log('Extracted Breadcrumbs:', rend?.extractedContext?.breadcrumbs);
        console.log('Extracted City ID:', rend?.extractedContext?.cityId);
        console.log('Detected Schemas:', sc?.detected?.map(s => s.type));

        // Assertions matching Detailed SEO Chrome Extension 1:1
        console.log('\n--- VERIFICATION CHECKS (1:1 DETAILED SEO PARITY) ---');
        const checks = [
            { name: 'URL is flagged Non-Indexable', pass: ov.indexable === false },
            { name: 'Blocked by robots.txt Googlebot rule (/*/search$)', pass: ov.robotsTxt.status === 'Blocked' && ov.robotsTxt.matchedRule.includes('/*/search$') },
            { name: 'Indexable reason mentions robots.txt', pass: ov.indexableReason.includes('robots.txt') },
            { name: 'Title matches Chrome Extension (49 chars: "Agoda | Hotels in Lucknow | Best Price Guarantee!")', pass: ov.title === 'Agoda | Hotels in Lucknow | Best Price Guarantee!' && ov.titleLength === 49 },
            { name: 'Description matches Chrome Extension (116 chars: "Get the LOWEST prices on hotels in Lucknow, India...")', pass: ov.description.includes('Lucknow, India') && ov.descriptionLength === 116 },
            { name: 'Keywords match Chrome Extension ("10 Top Hotels in Lucknow...")', pass: ov.keywords === '10 Top Hotels in Lucknow | Places to Stay w/ 24/7 Friendly Customer Service' },
            { name: 'Robots meta matches Chrome Extension ("noindex, nofollow")', pass: ov.robotsMeta.includes('noindex') && ov.robotsMeta.includes('nofollow') },
            { name: 'Identified as Client-Side Rendered (SPA)', pass: rend?.isSpa === true },
            { name: 'Identified as Faceted Search URL', pass: rend?.isFacetedSearch === true },
            { name: 'BreadcrumbList schema extracted from SPA', pass: Array.isArray(sc?.detected) && sc.detected.some(s => s.type === 'BreadcrumbList') },
            { name: 'Dynamic word count reflects ~1200 words', pass: ov.wordCount === 1200 }
        ];

        let failed = 0;
        checks.forEach(c => {
            if (c.pass) {
                console.log(`  ✅ PASS: ${c.name}`);
            } else {
                console.error(`  ❌ FAIL: ${c.name}`);
                failed++;
            }
        });

        if (failed > 0) {
            console.error(`\n❌ ${failed} verification checks failed!`);
            process.exit(1);
        } else {
            console.log(`\n🎉 ALL ${checks.length} VERIFICATION CHECKS PASSED WITH 100% 1:1 PARITY!`);
        }

    } catch (e) {
        console.error('Test execution error:', e.message, e.response?.data || '');
        process.exit(1);
    }
}

testAgodaAudit();
