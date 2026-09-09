const axios = require('axios');
const http = require('http');

async function testE2E() {
    console.log('[E2E TEST] Starting End-to-End verification against local server...');
    const baseUrl = 'http://127.0.0.1:3300';

    try {
        // 1. Test POST /api/audit-start
        console.log('[E2E TEST] 1. Initiating bulk audit job...');
        const startRes = await axios.post(`${baseUrl}/api/audit-start`, {
            urls: [
                'https://yatradham.org/yatradham-destinations/gujarat/dwarka.html',
                'https://example.com'
            ],
            concurrency: 2
        });

        const { jobId, total } = startRes.data;
        console.log(`[E2E TEST] Job created successfully: ${jobId} (total: ${total} URLs)`);

        // 2. Test SSE /api/audit-stream/:jobId
        console.log(`[E2E TEST] 2. Connecting to SSE stream: ${baseUrl}/api/audit-stream/${jobId}`);
        await new Promise((resolve, reject) => {
            const req = http.get(`${baseUrl}/api/audit-stream/${jobId}`, (res) => {
                let buffer = '';
                res.on('data', (chunk) => {
                    buffer += chunk.toString();
                    const lines = buffer.split('\n');
                    buffer = lines.pop(); // keep partial

                    for (const line of lines) {
                        if (line.startsWith('data: ')) {
                            const rawJson = line.replace(/^data: /, '').trim();
                            if (!rawJson) continue;
                            try {
                                const event = JSON.parse(rawJson);
                                console.log(`[E2E SSE] Event: ${event.type} -> ${event.url || event.jobId || (event.completedCount ? `${event.completedCount}/${event.total}` : '')}`);
                                if (event.type === 'result') {
                                    console.log(`[E2E SSE] Extracted URL: ${event.result.url} | Status: ${event.result.statusCode} | Title: "${event.result.data?.overview?.title || 'N/A'}"`);
                                }
                                if (event.type === 'done') {
                                    console.log(`[E2E SSE] Job completed! Total results: ${event.results.length}`);
                                    resolve();
                                }
                            } catch (e) {
                                console.error('[E2E SSE] JSON parse error:', e.message);
                            }
                        }
                    }
                });

                res.on('error', reject);
            });

            req.on('error', reject);
        });

        // 3. Test Debug Log endpoint
        console.log('[E2E TEST] 3. Verifying Debug Log retrieval...');
        const logRes = await axios.get(`${baseUrl}/api/debug-log`);
        console.log(`[E2E TEST] Retrieved ${logRes.data.logs.length} debug log lines.`);
        if (logRes.data.logs.length > 0) {
            console.log(`[E2E TEST] Latest log entry: ${logRes.data.logs[logRes.data.logs.length - 1]}`);
        }

        console.log('\n🎉 [ALL E2E TESTS PASSED SUCCESSFULLY!]');
        process.exit(0);

    } catch (err) {
        console.error('❌ [E2E TEST FAILED]:', err.message);
        process.exit(1);
    }
}

testE2E();
