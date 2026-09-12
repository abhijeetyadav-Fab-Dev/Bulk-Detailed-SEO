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

        console.log('\n--- OVERVIEW METRICS ---');
        console.log('Title:', ov.title || '(empty)');
        console.log('Indexable:', ov.indexable);
        console.log('Indexable Reason:', ov.indexableReason);
        console.log('Robots Tag in HTML:', ov.robotsMeta ? `"${ov.robotsMeta}"` : '(None in HTML)');
        console.log('Robots Meta Display:', ov.robotsMetaDisplay);
        console.log('Robots.txt Status:', ov.robotsTxt.status);
        console.log('Robots.txt Matched Rule:', ov.robotsTxt.matchedRule);
        console.log('Word Count (Static HTML):', ov.wordCount);
        console.log('Keywords:', ov.keywords);

        console.log('\n--- SPA & HYDRATION INTELLIGENCE ---');
        console.log('Rendering Type:', rend?.type);
        console.log('Framework:', rend?.framework);
        console.log('Is SPA:', rend?.isSpa);
        console.log('Is Faceted Search:', rend?.isFacetedSearch);
        console.log('Extracted Breadcrumbs:', rend?.extractedContext?.breadcrumbs);
        console.log('Extracted City ID:', rend?.extractedContext?.cityId);
        console.log('Hydration Notice:', rend?.hydrationNotice);

        // Assertions
        console.log('\n--- VERIFICATION CHECKS ---');
        const checks = [
            { name: 'URL is flagged Non-Indexable', pass: ov.indexable === false },
            { name: 'Blocked by robots.txt Googlebot rule', pass: ov.robotsTxt.status === 'Blocked' && ov.robotsTxt.matchedRule.includes('/*/search$') },
            { name: 'Indexable reason mentions robots.txt', pass: ov.indexableReason.includes('robots.txt') },
            { name: 'Robots meta does not falsely claim INDEX,FOLLOW', pass: ov.robotsMeta !== 'INDEX,FOLLOW' },
            { name: 'Identified as Client-Side Rendered (SPA)', pass: rend?.isSpa === true },
            { name: 'Identified as Faceted Search URL', pass: rend?.isFacetedSearch === true },
            { name: 'Extracted Lucknow breadcrumbs from SPA state', pass: Array.isArray(rend?.extractedContext?.breadcrumbs) && rend.extractedContext.breadcrumbs.includes('Lucknow') },
            { name: 'Keywords populated from SPA context', pass: ov.keywords.includes('Lucknow') }
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
            console.log(`\n🎉 ALL ${checks.length} VERIFICATION CHECKS PASSED PERFECTLY!`);
        }

    } catch (e) {
        console.error('Test execution error:', e.message, e.response?.data || '');
        process.exit(1);
    }
}

testAgodaAudit();
