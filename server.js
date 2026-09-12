const express = require('express');
const cors = require('cors');
const axios = require('axios');
const cheerio = require('cheerio');
const { URL } = require('url');
const path = require('path');
const fs = require('fs');

const app = express();
app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));
app.use(express.static(path.join(__dirname, 'public')));

const PORT = process.env.PORT || 3300;
const DEBUG_LOG_PATH = path.join(__dirname, 'debug.log');

// Realistic Desktop Chrome User-Agent
const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';

// Global in-memory job store for SSE streaming (with bounded eviction for Render 512MB RAM)
const jobs = new Map();

// Periodic cleanup to prevent memory exhaustion
setInterval(() => {
    const oneHourAgo = Date.now() - 3600000;
    for (const [id, job] of jobs.entries()) {
        if (job.created && job.created < oneHourAgo) {
            jobs.delete(id);
        }
    }
    // Prevent unbounded growth: cap at 20 jobs
    if (jobs.size > 20) {
        const oldestKey = jobs.keys().next().value;
        if (oldestKey) jobs.delete(oldestKey);
    }
    // Cap domainRobotsCache and waybackMetaCache
    if (domainRobotsCache.size > 250) {
        const oldestKey = domainRobotsCache.keys().next().value;
        if (oldestKey) domainRobotsCache.delete(oldestKey);
    }
    if (typeof waybackMetaCache !== 'undefined' && waybackMetaCache.size > 250) {
        const oldestKey = waybackMetaCache.keys().next().value;
        if (oldestKey) waybackMetaCache.delete(oldestKey);
    }
}, 180000);

// Helper: Append to persistent debug.log (Non-blocking async to preserve Node event loop)
function logDebug(entry) {
    const logLine = `[${new Date().toISOString()}] [${entry.level || 'INFO'}] [${entry.url || 'SYSTEM'}] ${entry.message} ${entry.details ? JSON.stringify(entry.details) : ''}\n`;
    fs.promises.appendFile(DEBUG_LOG_PATH, logLine).catch(() => {});
}

// Helper: Clean and normalize URL
function cleanUrl(input) {
    if (!input) return '';
    let trimmed = input.trim();
    if (!trimmed.startsWith('http://') && !trimmed.startsWith('https://')) {
        trimmed = 'https://' + trimmed;
    }
    return trimmed;
}

// Helper: Normalize relative or absolute URLs
function resolveUrl(base, relative) {
    try {
        const u = new URL(relative, base);
        u.hash = '';
        return u.href;
    } catch {
        return relative;
    }
}

// Global in-memory cache for robots.txt rules per domain
const domainRobotsCache = new Map();
// In-flight fetch deduplication to prevent duplicate network calls across concurrent workers
const inFlightRobots = new Map();

// Helper: Check if a URL pathname or full path+query matches any robots.txt disallow rules
function checkPathOrQueryDisallowed(pathname, search, disallowRules = []) {
    if (!pathname || !Array.isArray(disallowRules) || disallowRules.length === 0) {
        return { disallowed: false };
    }
    const fullPathAndQuery = pathname + (search || '');
    for (const rule of disallowRules) {
        if (!rule || rule === '') continue;
        try {
            const hasEndAnchor = rule.endsWith('$');
            const cleanRule = hasEndAnchor ? rule.slice(0, -1) : rule;
            let pattern = cleanRule.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*');
            pattern = '^' + pattern + (hasEndAnchor ? '$' : '');
            const re = new RegExp(pattern);
            if (re.test(pathname) || re.test(fullPathAndQuery)) {
                return { disallowed: true, matchedRule: rule };
            }
        } catch {}
    }
    return { disallowed: false };
}

// Backward-compatible alias
function isPathDisallowed(pathname, disallowRules = []) {
    return checkPathOrQueryDisallowed(pathname, '', disallowRules);
}

// Helper: Categorize sitemap URL by business vertical
function categorizeSitemapUrl(url) {
    const lower = url.toLowerCase();
    if (lower.includes('holiday') || lower.includes('tour') || lower.includes('package') || lower.includes('destination')) return 'Holidays';
    if (lower.includes('hotel') || lower.includes('stay') || lower.includes('homestay') || lower.includes('resort')) return 'Hotels';
    if (lower.includes('flight') || lower.includes('airline') || lower.includes('air-')) return 'Flights';
    if (lower.includes('rail') || lower.includes('train') || lower.includes('irctc') || lower.includes('bus') || lower.includes('cab')) return 'Transit';
    if (lower.includes('activity') || lower.includes('activities') || lower.includes('things-to-do') || lower.includes('safari') || lower.includes('cruise') || lower.includes('tour-') || lower.includes('park') || lower.includes('sightseeing')) return 'Activities';
    if (lower.includes('coupon') || lower.includes('offer') || lower.includes('deal')) return 'Coupons & Deals';
    if (lower.includes('blog') || lower.includes('guide') || lower.includes('article') || lower.includes('news')) return 'Guides & Content';
    return 'General';
}

// Helper: Full Parser for robots.txt with AI Bots & Multi-Sitemaps
function parseRobotsTxt(rawText, domain = '') {
    if (!rawText || typeof rawText !== 'string') {
        return { sitemaps: [], categories: {}, totalSitemaps: 0, aiBots: {}, summary: {}, defaultDisallows: [], googlebotDisallows: [] };
    }

    const lines = rawText.split(/\r?\n/);
    const groups = {};
    const sitemaps = [];
    let currentAgents = [];
    let prevWasUa = false;

    for (let line of lines) {
        const hashIdx = line.indexOf('#');
        if (hashIdx !== -1) line = line.substring(0, hashIdx);
        line = line.trim();
        if (!line) continue;

        // Check for Sitemap directive
        const smMatch = line.match(/^Sitemap:\s*(https?:\/\/[^\s]+)/i);
        if (smMatch) {
            const smUrl = smMatch[1].trim();
            if (!sitemaps.some(s => s.url === smUrl)) {
                const slug = smUrl.split('/').pop() || smUrl;
                sitemaps.push({
                    url: smUrl,
                    slug,
                    category: categorizeSitemapUrl(smUrl)
                });
            }
            continue;
        }

        // Check for User-agent
        const uaMatch = line.match(/^User-agent:\s*(.+)$/i);
        if (uaMatch) {
            const uaName = uaMatch[1].trim();
            const normalizedUa = uaName.toLowerCase();
            if (!prevWasUa) {
                currentAgents = [];
            }
            currentAgents.push(normalizedUa);
            if (!groups[normalizedUa]) {
                groups[normalizedUa] = { disallow: [], allow: [], rawName: uaName };
            }
            prevWasUa = true;
            continue;
        }

        prevWasUa = false;

        // Check for Disallow / Allow
        const disMatch = line.match(/^Disallow:\s*(.*)$/i);
        const allowMatch = line.match(/^Allow:\s*(.*)$/i);

        if (disMatch) {
            const path = disMatch[1].trim();
            for (const agent of currentAgents) {
                if (groups[agent]) groups[agent].disallow.push(path);
            }
        } else if (allowMatch) {
            const path = allowMatch[1].trim();
            for (const agent of currentAgents) {
                if (groups[agent]) groups[agent].allow.push(path);
            }
        }
    }

    // Top AI bots & Search crawlers to audit
    const trackedAiBots = [
        { key: 'OAI-SearchBot', pattern: /oai-searchbot/i, name: 'ChatGPT Search (OAI-SearchBot)', purpose: 'AI Search' },
        { key: 'GPTBot', pattern: /gptbot/i, name: 'OpenAI GPTBot', purpose: 'LLM Training' },
        { key: 'Google-Extended', pattern: /google-extended/i, name: 'Google Gemini (Google-Extended)', purpose: 'Gemini Training' },
        { key: 'PerplexityBot', pattern: /perplexitybot/i, name: 'Perplexity AI', purpose: 'Conversational Search' },
        { key: 'ClaudeBot', pattern: /claudebot|anthropic-ai/i, name: 'Claude (ClaudeBot)', purpose: 'Anthropic AI' },
        { key: 'Applebot-Extended', pattern: /applebot-extended/i, name: 'Apple Intelligence (Applebot-Extended)', purpose: 'Apple AI Models' },
        { key: 'Meta-ExternalAgent', pattern: /meta-externalagent|meta-webindexer/i, name: 'Meta AI (Llama)', purpose: 'Meta AI Indexing' },
        { key: 'Googlebot', pattern: /^googlebot$/i, name: 'Googlebot', purpose: 'Google Organic' },
        { key: '*', pattern: /^\*$/, name: 'General Crawlers (*)', purpose: 'Default Policy' }
    ];

    const aiBots = {};
    const defaultGroup = groups['*'] || { disallow: [], allow: [] };
    const googlebotGroup = groups['googlebot'] || { disallow: [], allow: [] };

    for (const bot of trackedAiBots) {
        const matchedKey = Object.keys(groups).find(k => bot.pattern.test(k));
        const group = matchedKey ? groups[matchedKey] : null;

        let status = 'Allowed';
        let badgeColor = 'emerald';
        let disallowCount = 0;
        let allowCount = 0;
        let rules = [];

        if (group) {
            disallowCount = group.disallow.length;
            allowCount = group.allow.length;
            rules = group.disallow;

            if (group.disallow.some(p => p === '/' || p === '/*')) {
                status = 'Blocked Entirely';
                badgeColor = 'rose';
            } else if (group.disallow.length > 0) {
                status = 'Partially Restricted';
                badgeColor = 'amber';
            } else if (group.disallow.length === 1 && group.disallow[0] === '') {
                status = 'Fully Allowed';
                badgeColor = 'emerald';
            }
        } else {
            disallowCount = defaultGroup.disallow.length;
            allowCount = defaultGroup.allow.length;
            rules = defaultGroup.disallow;
            if (defaultGroup.disallow.some(p => p === '/' || p === '/*')) {
                status = 'Blocked via (*)';
                badgeColor = 'rose';
            } else if (defaultGroup.disallow.length > 0) {
                status = 'Subject to (*) Rules';
                badgeColor = 'amber';
            } else {
                status = 'Allowed (Inherited)';
                badgeColor = 'emerald';
            }
        }

        aiBots[bot.key] = {
            name: bot.name,
            purpose: bot.purpose,
            status,
            badgeColor,
            disallowCount,
            allowCount,
            isExplicit: !!matchedKey,
            sampleRules: rules.slice(0, 6)
        };
    }

    // Calculate AI Search & Engine Readiness Score (0 to 100)
    let aiReadinessScore = 100;
    const aiSummary = [];
    if (aiBots['OAI-SearchBot']?.status?.includes('Blocked')) {
        aiReadinessScore -= 30;
        aiSummary.push('OAI-SearchBot is blocked (excluded from ChatGPT Search citations)');
    }
    if (aiBots['PerplexityBot']?.status?.includes('Blocked')) {
        aiReadinessScore -= 25;
        aiSummary.push('PerplexityBot is blocked (excluded from Perplexity conversational search)');
    }
    if (aiBots['Google-Extended']?.status?.includes('Blocked')) {
        aiReadinessScore -= 15;
        aiSummary.push('Google-Extended blocked (Gemini AI model training restricted)');
    }
    if (aiBots['GPTBot']?.status?.includes('Blocked')) {
        aiReadinessScore -= 15;
        aiSummary.push('GPTBot blocked (OpenAI LLM foundation training restricted)');
    }
    if (aiBots['ClaudeBot']?.status?.includes('Blocked')) {
        aiReadinessScore -= 15;
        aiSummary.push('ClaudeBot blocked (Anthropic Claude training restricted)');
    }
    aiReadinessScore = Math.max(0, Math.min(100, aiReadinessScore));

    const categories = {};
    for (const sm of sitemaps) {
        categories[sm.category] = (categories[sm.category] || 0) + 1;
    }

    let totalDisallows = 0;
    let totalAllows = 0;
    for (const g of Object.values(groups)) {
        totalDisallows += g.disallow.length;
        totalAllows += g.allow.length;
    }

    return {
        sitemaps,
        categories,
        totalSitemaps: sitemaps.length,
        aiBots,
        aiReadinessScore,
        aiSummary,
        defaultDisallows: defaultGroup.disallow || [],
        googlebotDisallows: googlebotGroup.disallow || [],
        summary: {
            totalUserAgentGroups: Object.keys(groups).length,
            totalDisallows,
            totalAllows,
            defaultDisallowCount: defaultGroup.disallow.length,
            googlebotDisallowCount: googlebotGroup.disallow.length
        }
    };
}

// Helper: Proactively fetch, parse and cache domain robots.txt rules
async function getOrFetchDomainRobots(targetUrl) {
    if (!targetUrl) return { disallow: [], googlebotDisallow: [] };
    try {
        const parsed = new URL(targetUrl);
        const domain = parsed.hostname.replace(/^www\./, '').toLowerCase();
        const origin = parsed.origin;

        if (domainRobotsCache.has(domain)) {
            return domainRobotsCache.get(domain);
        }

        if (inFlightRobots.has(domain)) {
            return inFlightRobots.get(domain);
        }

        const fetchTask = (async () => {
            try {
                const robotsUrl = `${origin}/robots.txt`;
                logDebug({ level: 'INFO', url: robotsUrl, message: `Proactively fetching robots.txt for domain ${domain}` });
                const resp = await smartFetchText(robotsUrl, 3500);
                if (resp.ok && resp.data) {
                    const parsedData = parseRobotsTxt(resp.data, domain);
                    const cacheEntry = {
                        disallow: parsedData.defaultDisallows || [],
                        googlebotDisallow: parsedData.googlebotDisallows || [],
                        aiBots: parsedData.aiBots || {},
                        updatedAt: Date.now()
                    };
                    domainRobotsCache.set(domain, cacheEntry);
                    return cacheEntry;
                }
            } catch (err) {
                logDebug({ level: 'WARN', message: `Proactive robots.txt fetch failed for ${domain}: ${err.message}` });
            } finally {
                inFlightRobots.delete(domain);
            }

            const fallbackEntry = { disallow: [], googlebotDisallow: [], updatedAt: Date.now() };
            domainRobotsCache.set(domain, fallbackEntry);
            return fallbackEntry;
        })();

        inFlightRobots.set(domain, fetchTask);
        return await fetchTask;
    } catch {
        return { disallow: [], googlebotDisallow: [] };
    }
}

// Helper: Client-Side Rendered (SPA) & Dynamic Hydration Intelligence
function detectSpaAndRendering($, html, targetUrl, wordCount, htmlSizeBytes) {
    let framework = null;
    let isSpa = false;
    const extractedContext = {};

    // 1. Detect Frameworks & SPA Markers
    if (html.includes('window.params') || html.includes('agoda.pageConfig') || $('div#content[data-page]').length > 0) {
        framework = 'Agoda React Single Page App';
        isSpa = true;
    } else if ($('#__NEXT_DATA__').length > 0 || html.includes('/_next/static/')) {
        framework = 'Next.js (React)';
        isSpa = true;
    } else if ($('#__NUXT__').length > 0 || html.includes('/_nuxt/')) {
        framework = 'Nuxt.js (Vue)';
        isSpa = true;
    } else if ($('#root, div[data-reactroot]').length > 0 || html.includes('react-dom')) {
        framework = 'React SPA';
        isSpa = true;
    } else if ($('#app[data-v-]').length > 0 || html.includes('vue.global')) {
        framework = 'Vue.js SPA';
        isSpa = true;
    } else if ($('[ng-version], [ng-app]').length > 0) {
        framework = 'Angular App';
        isSpa = true;
    } else if (wordCount < 100 && htmlSizeBytes > 25000 && $('script').length > 5) {
        framework = 'Client-Side JavaScript App';
        isSpa = true;
    }

    // 2. Detect Faceted / Dynamic Search URLs
    let isFacetedSearch = false;
    try {
        const u = new URL(targetUrl);
        const p = u.pathname.toLowerCase();
        if (p.includes('/search') || p.includes('/find') || p.includes('/filter') || p.includes('/results') || 
            u.searchParams.has('campaignid') || u.searchParams.has('checkin') || u.searchParams.has('city') || 
            u.searchParams.has('query') || u.searchParams.has('q')) {
            isFacetedSearch = true;
        }
    } catch {}

    // 3. Extract Embedded State Context
    let extractedKeywords = '';
    // Agoda State Extraction
    const agodaMatch = html.match(/window\.params\s*=\s*(\{.+?\});\s*(?:<\/script>|window\.)/s);
    if (agodaMatch) {
        try {
            const parsed = JSON.parse(agodaMatch[1]);
            if (parsed.breadcrumbs && Array.isArray(parsed.breadcrumbs)) {
                const crumbs = parsed.breadcrumbs.map(b => b.regionName).filter(Boolean);
                if (crumbs.length > 0) {
                    extractedContext.breadcrumbs = crumbs;
                    extractedKeywords = crumbs.slice(1).reverse().join(', ') + ' Hotels';
                }
            }
            if (parsed.searchCriteria) {
                extractedContext.cityId = parsed.searchCriteria.CityId;
                extractedContext.checkIn = parsed.searchCriteria.CheckIn?.split('T')[0];
                extractedContext.checkOut = parsed.searchCriteria.CheckOut?.split('T')[0];
                extractedContext.adults = parsed.searchCriteria.Adults;
                extractedContext.selectedPropertyId = parsed.searchCriteria.SelectedHotelId;
            }
        } catch {}
    }

    // Next.js State Extraction
    const nextMatch = html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/i);
    if (nextMatch) {
        try {
            const nextData = JSON.parse(nextMatch[1]);
            extractedContext.route = nextData.page;
            if (nextData.props?.pageProps) {
                extractedContext.propsSummary = Object.keys(nextData.props.pageProps).slice(0, 6);
            }
        } catch {}
    }

    return {
        type: isSpa ? 'Client-Side Rendered (SPA)' : 'Server-Side Rendered (SSR)',
        isSpa,
        framework,
        isFacetedSearch,
        staticWordCount: wordCount,
        hydrationNotice: isSpa ? 'This page delivers a JavaScript application shell. In a real desktop browser (Chrome), client-side JavaScript dynamically renders the content (e.g. hotel/product cards, word count) and meta tags. Raw HTTP crawlers without JavaScript execution receive this initial shell.' : null,
        extractedKeywords,
        extractedContext
    };
}

// ─────────────────────────────────────────────────────────────
// CORE EXTRACTION ENGINE: 1:1 REPLICA OF DETAILED SEO EXTENSION
// ─────────────────────────────────────────────────────────────
function extractDetailedSeo(targetUrl, html, responseHeaders = {}, statusCode = 200, responseTimeMs = 0, finalUrl = targetUrl) {
    const $ = cheerio.load(html);
    const domain = new URL(finalUrl).hostname.replace(/^www\./, '');

    // ── 1. OVERVIEW ──
    const title = $('title').first().text().trim() || '';
    const titleLength = title.length;
    let titleStatus = 'Optimal';
    if (titleLength === 0) titleStatus = 'Missing';
    else if (titleLength < 30) titleStatus = 'Short';
    else if (titleLength > 60) titleStatus = 'Long';

    const description = $('meta[name="description"]').attr('content') || 
                        $('meta[property="og:description"]').attr('content') || '';
    const descriptionLength = description.trim().length;
    let descStatus = 'Optimal';
    if (descriptionLength === 0) descStatus = 'Missing';
    else if (descriptionLength < 70) descStatus = 'Short';
    else if (descriptionLength > 160) descStatus = 'Long';

    const canonicalRaw = $('link[rel="canonical"]').attr('href') || '';
    let canonical = '';
    let canonicalStatus = 'Missing';
    if (canonicalRaw) {
        canonical = resolveUrl(finalUrl, canonicalRaw);
        // Check if self-referencing (ignoring trailing slash differences)
        const normFinal = finalUrl.replace(/\/+$/, '').toLowerCase();
        const normCanon = canonical.replace(/\/+$/, '').toLowerCase();
        if (normFinal === normCanon) {
            canonicalStatus = 'Self-referencing';
        } else {
            canonicalStatus = 'Different';
        }
    }

    const rawRobotsMeta = $('meta[name="robots"]').attr('content') || '';
    const xRobotsTag = responseHeaders['x-robots-tag'] || 'Missing';

    // Indexability evaluation
    let indexable = true;
    let indexableReason = 'Indexable';
    const robotsCombined = (rawRobotsMeta + ' ' + (xRobotsTag !== 'Missing' ? xRobotsTag : '')).toLowerCase();
    if (robotsCombined.includes('noindex')) {
        indexable = false;
        indexableReason = 'Blocked by meta/header noindex';
    } else if (statusCode >= 400) {
        indexable = false;
        indexableReason = `HTTP Error ${statusCode}`;
    }

    // Check Robots.txt disallow rules (Googlebot first, then default '*')
    let robotsTxtBlocked = false;
    let robotsTxtRule = null;
    let robotsTxtAgent = 'None';
    const cachedRobots = domainRobotsCache.get(domain);
    if (cachedRobots) {
        try {
            const parsedFinal = new URL(finalUrl);
            const pathName = parsedFinal.pathname;
            const searchStr = parsedFinal.search;

            // 1. Googlebot check first (highest authority for Google Search SEO)
            if (cachedRobots.googlebotDisallow && cachedRobots.googlebotDisallow.length > 0) {
                const gCheck = checkPathOrQueryDisallowed(pathName, searchStr, cachedRobots.googlebotDisallow);
                if (gCheck.disallowed) {
                    robotsTxtBlocked = true;
                    robotsTxtRule = `Googlebot: ${gCheck.matchedRule}`;
                    robotsTxtAgent = 'Googlebot';
                }
            }

            // 2. Default crawler '*' check
            if (!robotsTxtBlocked && cachedRobots.disallow && cachedRobots.disallow.length > 0) {
                const dCheck = checkPathOrQueryDisallowed(pathName, searchStr, cachedRobots.disallow);
                if (dCheck.disallowed) {
                    robotsTxtBlocked = true;
                    robotsTxtRule = `*: ${dCheck.matchedRule}`;
                    robotsTxtAgent = '*';
                }
            }
        } catch {}
    }

    if (robotsTxtBlocked) {
        indexable = false;
        indexableReason = `Blocked by robots.txt (${robotsTxtRule})`;
    }

    let keywords = $('meta[name="keywords"]').attr('content') || '';

    // Word count calculation (clean HTML text - FAST SINGLE PARSE via Cheerio clone)
    const bodyClone = $('body').clone();
    bodyClone.find('script, style, noscript, svg, iframe, nav, header, footer').remove();
    const visibleText = bodyClone.text().replace(/\s+/g, ' ').trim();
    const wordCount = visibleText.length > 0 ? visibleText.split(/\s+/).filter(w => w.length > 0).length : 0;

    // Page weight & DOM footprint metrics
    const htmlSizeBytes = Buffer.byteLength(html || '', 'utf8');
    const htmlSizeKb = Math.round((htmlSizeBytes / 1024) * 10) / 10;
    const totalDomNodes = $('*').length;
    const scriptCount = $('script[src]').length;
    const inlineScriptCount = $('script:not([src])').length;
    const stylesheetCount = $('link[rel="stylesheet"]').length;
    const metaViewport = $('meta[name="viewport"]').attr('content') || '';
    const charset = $('meta[charset]').attr('charset') || $('meta[http-equiv="Content-Type"]').attr('content') || '';

    // SPA / Client-Side Rendering & Hydration Detection
    const rendering = detectSpaAndRendering($, html, finalUrl, wordCount, htmlSizeBytes);
    if (!keywords && rendering.extractedKeywords) {
        keywords = rendering.extractedKeywords;
    }

    // SERP pixel simulation (Google desktop cuts ~580px, description ~960px)
    const titlePixelWidth = Math.round(titleLength * 9.5);
    const descPixelWidth = Math.round(descriptionLength * 5.8);
    const serp = {
        titlePixelWidth,
        descPixelWidth,
        titleTruncatedDesktop: titlePixelWidth > 580,
        descTruncatedDesktop: descPixelWidth > 960,
        titleTruncatedMobile: titleLength > 55,
        descTruncatedMobile: descriptionLength > 120
    };

    // ── 2. HEADINGS ──
    const headings = [];
    const headingCounts = { h1: 0, h2: 0, h3: 0, h4: 0, h5: 0, h6: 0 };
    $('h1, h2, h3, h4, h5, h6').each((i, el) => {
        const tag = el.tagName.toLowerCase();
        const text = $(el).text().replace(/\s+/g, ' ').trim();
        if (text) {
            headingCounts[tag] = (headingCounts[tag] || 0) + 1;
            headings.push({
                tag: tag.toUpperCase(),
                level: parseInt(tag[1], 10),
                text
            });
        }
    });

    // Heading hierarchy linting
    const hierarchyIssues = [];
    if (headingCounts.h1 === 0) {
        hierarchyIssues.push('Missing H1 heading on page');
    } else if (headingCounts.h1 > 1) {
        hierarchyIssues.push(`Multiple H1 headings detected (${headingCounts.h1}) — recommend exactly 1 for primary topic focus`);
    }
    let prevLevel = 0;
    headings.forEach(h => {
        if (prevLevel > 0 && h.level > prevLevel + 1) {
            hierarchyIssues.push(`Heading level skipped: H${prevLevel} jumped directly to H${h.level} ("${h.text.substring(0, 35)}...")`);
        }
        prevLevel = h.level;
    });

    // ── 3. LINKS ──
    const internalLinks = [];
    const externalLinks = [];
    const seenLinks = new Set();

    $('a[href]').each((i, el) => {
        const rawHref = $(el).attr('href');
        if (!rawHref || rawHref.startsWith('javascript:') || rawHref.startsWith('mailto:') || rawHref.startsWith('tel:')) return;

        const resolved = resolveUrl(finalUrl, rawHref);
        const anchor = $(el).text().replace(/\s+/g, ' ').trim() || '[No anchor text]';
        const rel = ($(el).attr('rel') || '').toLowerCase();
        const isNoFollow = rel.includes('nofollow');
        seenLinks.add(resolved);

        try {
            const linkDomain = new URL(resolved).hostname.replace(/^www\./, '');
            const isInternal = linkDomain === domain;
            const linkObj = {
                url: resolved,
                anchor,
                rel: rel || 'follow',
                isNoFollow,
                isInternal
            };

            if (isInternal) {
                internalLinks.push(linkObj);
            } else {
                externalLinks.push(linkObj);
            }
        } catch {
            // Relative/malformed link
            internalLinks.push({
                url: resolved,
                anchor,
                rel: rel || 'follow',
                isNoFollow,
                isInternal: true
            });
        }
    });

    const totalLinks = internalLinks.length + externalLinks.length;
    const uniqueLinks = seenLinks.size;

    // ── 4. IMAGES ──
    let totalImages = 0;
    let imagesWithAlt = 0;
    let imagesMissingAlt = 0;
    const missingAltList = [];

    $('img').each((i, el) => {
        totalImages++;
        const src = $(el).attr('src') || $(el).attr('data-src') || '';
        const alt = $(el).attr('alt');
        if (alt !== undefined && alt.trim().length > 0) {
            imagesWithAlt++;
        } else {
            imagesMissingAlt++;
            if (missingAltList.length < 50) {
                missingAltList.push({
                    src: resolveUrl(finalUrl, src),
                    snippet: $.html(el).substring(0, 120)
                });
            }
        }
    });

    // ── 5. SCHEMA & HREFLANG ──
    const schemas = [];
    $('script[type="application/ld+json"]').each((i, el) => {
        try {
            const parsed = JSON.parse($(el).html());
            if (Array.isArray(parsed)) {
                parsed.forEach(p => schemas.push(extractSchemaSummary(p)));
            } else if (parsed['@graph'] && Array.isArray(parsed['@graph'])) {
                parsed['@graph'].forEach(p => schemas.push(extractSchemaSummary(p)));
            } else {
                schemas.push(extractSchemaSummary(parsed));
            }
        } catch {
            schemas.push({ type: 'Invalid JSON-LD', raw: $(el).html().substring(0, 80) });
        }
    });

    const hreflangs = [];
    $('link[rel="alternate"][hreflang]').each((i, el) => {
        const lang = $(el).attr('hreflang') || '';
        const href = $(el).attr('href') || '';
        if (lang && href) {
            hreflangs.push({
                lang,
                url: resolveUrl(finalUrl, href),
                status: statusCode,
                backRef: 'Yes' // Will be verified in 2-way checks if applicable
            });
        }
    });

    // ── 6. SOCIAL (OPEN GRAPH & TWITTER) ──
    const openGraph = {
        title: $('meta[property="og:title"]').attr('content') || title,
        description: $('meta[property="og:description"]').attr('content') || description,
        image: resolveUrl(finalUrl, $('meta[property="og:image"]').attr('content') || ''),
        url: $('meta[property="og:url"]').attr('content') || finalUrl,
        siteName: $('meta[property="og:site_name"]').attr('content') || domain
    };

    const twitter = {
        card: $('meta[name="twitter:card"]').attr('content') || 'summary_large_image',
        title: $('meta[name="twitter:title"]').attr('content') || openGraph.title,
        description: $('meta[name="twitter:description"]').attr('content') || openGraph.description,
        image: resolveUrl(finalUrl, $('meta[name="twitter:image"]').attr('content') || openGraph.image),
        site: $('meta[name="twitter:site"]').attr('content') || '',
        creator: $('meta[name="twitter:creator"]').attr('content') || ''
    };

    return {
        url: targetUrl,
        finalUrl,
        statusCode,
        responseTimeMs,
        rendering,
        pageWeight: {
            htmlSizeKb,
            htmlSizeBytes,
            totalDomNodes,
            scriptCount,
            inlineScriptCount,
            stylesheetCount,
            metaViewport,
            charset,
            isMobileFriendly: Boolean(metaViewport && metaViewport.includes('width='))
        },
        serp,
        overview: {
            title,
            titleLength,
            titleStatus,
            description,
            descriptionLength,
            descStatus,
            canonical,
            canonicalStatus,
            robotsMeta: rawRobotsMeta,
            robotsMetaDisplay: rawRobotsMeta 
                ? rawRobotsMeta 
                : (robotsTxtBlocked ? 'None in HTML (Blocked by robots.txt)' : 'Not specified in HTML (Defaults to Index)'),
            xRobotsTag,
            robotsTxt: {
                status: robotsTxtBlocked ? 'Blocked' : 'Allowed',
                matchedRule: robotsTxtRule,
                checkedAgent: robotsTxtAgent
            },
            indexable,
            indexableReason,
            keywords,
            wordCount
        },
        headings: {
            list: headings,
            counts: headingCounts,
            h1Text: headings.find(h => h.tag === 'H1')?.text || 'None',
            hierarchyIssues
        },
        links: {
            total: totalLinks,
            unique: uniqueLinks,
            internalCount: internalLinks.length,
            externalCount: externalLinks.length,
            internal: internalLinks,
            external: externalLinks
        },
        images: {
            total: totalImages,
            withAlt: imagesWithAlt,
            missingAlt: imagesMissingAlt,
            missingList: missingAltList
        },
        schema: {
            detected: schemas,
            hreflangs
        },
        social: {
            openGraph,
            twitter
        },
        debug: {
            headers: responseHeaders,
            timestamp: new Date().toISOString()
        }
    };
}

// Helper: Summarize Schema Object
function extractSchemaSummary(obj) {
    if (!obj || typeof obj !== 'object') return { type: 'Unknown' };
    return {
        type: obj['@type'] || 'Thing',
        name: obj.name || obj.headline || obj.title || '',
        id: obj['@id'] || ''
    };
}

// ─────────────────────────────────────────────────────────────
// ─────────────────────────────────────────────────────────────
// NETWORK FETCHER WITH ROBUST ERROR HANDLING & DUAL CLIENTS
// ─────────────────────────────────────────────────────────────
async function smartFetchText(url, timeoutMs = 8000) {
    // 1. Try Node native fetch first (bypasses Akamai/Cloudflare TLS blocks & bot management)
    try {
        const res = await fetch(url, {
            signal: AbortSignal.timeout(timeoutMs),
            headers: {
                'User-Agent': USER_AGENT,
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
                'Accept-Language': 'en-US,en;q=0.9',
                'Cache-Control': 'no-cache'
            }
        });
        const text = await res.text();
        const resHeaders = {};
        if (res.headers && typeof res.headers.forEach === 'function') {
            res.headers.forEach((v, k) => { resHeaders[k.toLowerCase()] = v; });
        }
        return {
            ok: res.ok,
            status: res.status,
            data: text,
            headers: resHeaders,
            contentType: res.headers?.get('content-type') || '',
            finalUrl: res.url || url
        };
    } catch (e) {
        // Native fetch aborted or failed; proceed to axios fallback
    }

    // 2. Fallback to axios
    try {
        const res = await axios.get(url, {
            timeout: timeoutMs,
            headers: {
                'User-Agent': USER_AGENT,
                'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
            },
            validateStatus: s => s < 500
        });
        const text = typeof res.data === 'string' ? res.data : String(res.data);
        return {
            ok: res.status < 400,
            status: res.status,
            data: text,
            headers: res.headers || {},
            contentType: res.headers['content-type'] || '',
            finalUrl: res.request?.res?.responseUrl || url
        };
    } catch (e) {
        return { ok: false, status: e.response?.status || 500, error: e.message };
    }
}

async function fetchAndAuditUrl(rawUrl, timeoutMs = 10000) {
    const url = cleanUrl(rawUrl);
    const startTime = Date.now();
    
    logDebug({ level: 'INFO', url, message: 'Initiating fetch' });

    try {
        // Concurrently fetch page HTML and ensure domain robots.txt rules are cached
        const [fetchRes] = await Promise.all([
            smartFetchText(url, timeoutMs),
            getOrFetchDomainRobots(url)
        ]);
        const responseTimeMs = Date.now() - startTime;

        if (fetchRes.data) {
            logDebug({
                level: 'SUCCESS',
                url,
                message: `Fetched in ${responseTimeMs}ms with status ${fetchRes.status}`,
                details: { finalUrl: fetchRes.finalUrl, ttfb: responseTimeMs }
            });

            // If finalUrl redirected across domains, ensure destination domain robots.txt is loaded
            if (fetchRes.finalUrl) {
                try {
                    const origHost = new URL(url).hostname.replace(/^www\./, '').toLowerCase();
                    const destHost = new URL(fetchRes.finalUrl).hostname.replace(/^www\./, '').toLowerCase();
                    if (origHost !== destHost) {
                        await getOrFetchDomainRobots(fetchRes.finalUrl);
                    }
                } catch {}
            }

            const auditData = extractDetailedSeo(
                url,
                fetchRes.data,
                fetchRes.headers || {},
                fetchRes.status,
                responseTimeMs,
                fetchRes.finalUrl || url
            );
            return { success: true, data: auditData };
        } else {
            throw new Error(fetchRes.error || `HTTP request failed with status ${fetchRes.status}`);
        }

    } catch (err) {
        const responseTimeMs = Date.now() - startTime;
        let errorCode = 'FETCH_ERROR';
        let errorMessage = err.message;

        if (err.name === 'TimeoutError' || err.code === 'ECONNABORTED' || err.message.includes('timeout')) {
            errorCode = 'TIMEOUT';
            errorMessage = `Request timed out after ${timeoutMs}ms`;
        } else if (err.code === 'ENOTFOUND') {
            errorCode = 'DNS_ERROR';
            errorMessage = 'DNS lookup failed. Domain not found.';
        } else if (err.response?.status === 403) {
            errorCode = 'WAF_BLOCKED_403';
            errorMessage = 'Access blocked by Cloudflare or server WAF (403 Forbidden).';
        }

        logDebug({
            level: 'ERROR',
            url,
            message: `Failure: ${errorCode} - ${errorMessage}`,
            details: { code: err.code, responseTimeMs }
        });

        return {
            success: false,
            url,
            error: {
                code: errorCode,
                message: errorMessage,
                responseTimeMs
            }
        };
    }
}

function extractUrlsFromXml(xmlString) {
    const $ = cheerio.load(xmlString, { xmlMode: true });
    let urls = [];
    let subSitemaps = [];

    // Check <sitemap><loc> for sitemapindex
    $('sitemap > loc, sitemap loc').each((i, el) => {
        const txt = $(el).text().trim();
        if (txt && (txt.startsWith('http://') || txt.startsWith('https://'))) {
            subSitemaps.push(txt);
        }
    });

    // Check <url><loc> for standard URLs
    $('url > loc, url loc').each((i, el) => {
        const txt = $(el).text().trim();
        if (txt && (txt.startsWith('http://') || txt.startsWith('https://'))) {
            urls.push(txt);
        }
    });

    // Regex fallback for malformed or namespaced XML
    if (urls.length === 0 && subSitemaps.length === 0) {
        const locMatches = xmlString.match(/<loc>\s*(https?:\/\/[^\s<]+)\s*<\/loc>/gi) || [];
        for (const m of locMatches) {
            const u = m.replace(/<\/?loc>/gi, '').trim();
            if (u.endsWith('.xml') || u.includes('sitemap')) {
                subSitemaps.push(u);
            } else {
                urls.push(u);
            }
        }
    }

    return {
        urls: [...new Set(urls)],
        subSitemaps: [...new Set(subSitemaps)]
    };
}

function extractUrlsFromHtml(htmlString, baseDomainUrl) {
    const $ = cheerio.load(htmlString);
    const parsedBase = new URL(baseDomainUrl);
    const baseHostname = parsedBase.hostname.replace(/^www\./, '');
    const urls = [];

    $('a[href]').each((_, el) => {
        const href = $(el).attr('href');
        if (!href) return;
        const trimmed = href.trim();
        if (trimmed.startsWith('#') || trimmed.startsWith('javascript:') || trimmed.startsWith('mailto:') || trimmed.startsWith('tel:')) return;

        try {
            const resolved = new URL(trimmed, baseDomainUrl);
            resolved.hash = '';
            const h = resolved.hostname.replace(/^www\./, '');
            if (h === baseHostname || h.endsWith('.' + baseHostname)) {
                const pathname = resolved.pathname.toLowerCase();
                if (!/\.(jpg|jpeg|png|gif|svg|webp|ico|css|js|woff|woff2|ttf|eot|pdf|zip|mp4|webm)$/i.test(pathname)) {
                    urls.push(resolved.href);
                }
            }
        } catch {}
    });

    return [...new Set(urls)];
}

// ─────────────────────────────────────────────────────────────
// UNIVERSAL SITEMAP & URL EXTRACTOR (XML, INDEX, HTML SITEMAP, CRAWL)
// ─────────────────────────────────────────────────────────────
app.post('/api/extract-sitemap', async (req, res) => {
    const { sitemapUrl, url, targetUrl, domain, autoFetchSubSitemaps = true, maxSubSitemaps = 5 } = req.body;
    const inputTarget = sitemapUrl || url || targetUrl || domain;
    if (!inputTarget) return res.status(400).json({ error: 'Sitemap URL or domain is required' });

    try {
        let target = cleanUrl(inputTarget);
        logDebug({ level: 'INFO', url: target, message: 'Processing universal sitemap extraction' });

        const parsedTarget = new URL(target);
        const origin = parsedTarget.origin;
        let urls = [];
        let subSitemaps = [];
        let detectedSource = 'xml_sitemap';
        let sourceUrl = target;

        let declaredSitemaps = [];
        let aiBotsAnalysis = null;
        let categoriesBreakdown = {};

        // Check if target is explicitly robots.txt or XML
        const isRobots = target.endsWith('robots.txt') || target.includes('robots.txt');
        const isExplicitXml = !isRobots && (target.endsWith('.xml') || parsedTarget.pathname.toLowerCase().includes('.xml'));
        let resp = null;
        let isXml = false;

        if (isExplicitXml) {
            resp = await smartFetchText(target, 5000);
            isXml = resp.ok && (resp.data.includes('<urlset') || resp.data.includes('<sitemapindex') || resp.contentType.includes('xml'));
            if (isXml) {
                const extracted = extractUrlsFromXml(resp.data);
                urls = extracted.urls;
                subSitemaps = extracted.subSitemaps;
            }
        }

        // If target is robots.txt or not XML or domain root
        if (isRobots || !isXml || (urls.length === 0 && subSitemaps.length === 0)) {
            // STEP A: Probe robots.txt (standard, official, and responds in <300ms)
            const robotsUrl = isRobots ? target : `${origin}/robots.txt`;
            const robResp = await smartFetchText(robotsUrl, 4000);
            if (robResp.ok && robResp.data) {
                const domain = parsedTarget.hostname.replace(/^www\./, '');
                const robotsAnalysis = parseRobotsTxt(robResp.data, domain);

                domainRobotsCache.set(domain.toLowerCase(), {
                    disallow: robotsAnalysis.defaultDisallows || [],
                    googlebotDisallow: robotsAnalysis.googlebotDisallows || [],
                    aiBots: robotsAnalysis.aiBots || {},
                    updatedAt: Date.now()
                });

                declaredSitemaps = robotsAnalysis.sitemaps;
                aiBotsAnalysis = robotsAnalysis.aiBots;
                categoriesBreakdown = robotsAnalysis.categories;

                if (isRobots) {
                    detectedSource = 'robots_txt';
                    sourceUrl = robotsUrl;
                }

                // If sitemaps were found in robots.txt, try primary ones to populate audit URLs
                for (const sm of robotsAnalysis.sitemaps) {
                    const smUrl = sm.url;
                    const smResp = await smartFetchText(smUrl, 5000);
                    if (smResp.ok && (smResp.data.includes('<urlset') || smResp.data.includes('<sitemapindex') || smResp.contentType.includes('xml'))) {
                        const extracted = extractUrlsFromXml(smResp.data);
                        if (extracted.urls.length > 0 || extracted.subSitemaps.length > 0) {
                            urls = extracted.urls;
                            subSitemaps = extracted.subSitemaps;
                            sourceUrl = smUrl;
                            if (!isRobots) detectedSource = 'xml_sitemap_via_robots';
                            break;
                        }
                    }
                }
            }

            // STEP B: Fallback probes if robots.txt had no sitemaps (strict 3000ms timeout)
            if (urls.length === 0 && subSitemaps.length === 0 && !isRobots) {
                const candidates = [
                    `${origin}/sitemap.xml`,
                    `${origin}/sitemap_index.xml`,
                    `${origin}/sitemap.html`,
                    `${origin}/sitemap/`
                ];

                for (const candidate of candidates) {
                    if (candidate === target) continue;
                    const cResp = await smartFetchText(candidate, 3000);
                    if (!cResp.ok || !cResp.data) continue;

                    // Check for XML sitemap
                    if (cResp.data.includes('<urlset') || cResp.data.includes('<sitemapindex') || cResp.contentType.includes('xml')) {
                        const extracted = extractUrlsFromXml(cResp.data);
                        if (extracted.urls.length > 0 || extracted.subSitemaps.length > 0) {
                            urls = extracted.urls;
                            subSitemaps = extracted.subSitemaps;
                            sourceUrl = candidate;
                            detectedSource = 'xml_sitemap';
                            break;
                        }
                    }

                    // Check for HTML sitemap
                    if (candidate.includes('sitemap.html') || candidate.endsWith('/sitemap/')) {
                        const htmlUrls = extractUrlsFromHtml(cResp.data, candidate);
                        if (htmlUrls.length > 0) {
                            urls = htmlUrls;
                            sourceUrl = candidate;
                            detectedSource = 'html_sitemap';
                            break;
                        }
                    }
                }
            }

            // STEP C: Fallback to page internal links if target was an HTML page
            if (urls.length === 0 && subSitemaps.length === 0 && !isRobots) {
                if (!resp || !resp.data) {
                    resp = await smartFetchText(target, 4000);
                }
                if (resp && resp.ok && resp.data) {
                    const htmlUrls = extractUrlsFromHtml(resp.data, target);
                    if (htmlUrls.length > 0) {
                        urls = htmlUrls;
                        sourceUrl = target;
                        detectedSource = 'html_page_links';
                    }
                }
            }
        }

        urls = [...new Set(urls)];
        subSitemaps = [...new Set(subSitemaps)];

        // Auto-fetch sub-sitemaps if requested or if root had no direct page URLs (sitemap index)
        const shouldAutoFetch = (autoFetchSubSitemaps !== false) || (urls.length === 0 && subSitemaps.length > 0);
        let autoFetchedCount = 0;
        if (shouldAutoFetch && subSitemaps.length > 0) {
            const subList = subSitemaps.slice(0, Math.min(maxSubSitemaps, 5));
            const subPromises = subList.map(async (subUrl) => {
                const subResp = await smartFetchText(subUrl, 4000);
                if (subResp.ok && subResp.data) {
                    const ex = extractUrlsFromXml(subResp.data);
                    return ex.urls;
                }
                return [];
            });
            const subResults = await Promise.all(subPromises);
            subResults.forEach(uArr => urls.push(...uArr));
            urls = [...new Set(urls)];
            autoFetchedCount = subList.length;
        }

        logDebug({
            level: 'SUCCESS',
            url: target,
            message: `Discovered ${urls.length} URLs (source: ${detectedSource}, declared sitemaps: ${declaredSitemaps.length})`
        });

        res.json({
            success: true,
            sitemapUrl: sourceUrl,
            inputUrl: target,
            sourceType: detectedSource,
            subSitemaps,
            declaredSitemaps,
            totalDeclaredSitemaps: declaredSitemaps.length,
            aiBots: aiBotsAnalysis,
            categories: categoriesBreakdown,
            urls,
            totalUrls: urls.length,
            isIndex: subSitemaps.length > 0,
            autoFetchedSubSitemaps: autoFetchedCount
        });

    } catch (err) {
        logDebug({ level: 'ERROR', url: sitemapUrl, message: `Sitemap parse error: ${err.message}` });
        res.status(500).json({ success: false, error: `Could not parse sitemap: ${err.message}` });
    }
});

// ─────────────────────────────────────────────────────────────
// ROBOTS.TXT DIRECT INSPECTOR & AI CRAWLER AUDITOR
// ─────────────────────────────────────────────────────────────
app.post('/api/robots-inspect', async (req, res) => {
    const { url, domain, target } = req.body;
    const inputTarget = url || domain || target;
    if (!inputTarget) return res.status(400).json({ error: 'URL or domain is required' });

    try {
        let clean = cleanUrl(inputTarget);
        const parsed = new URL(clean);
        const hostDomain = parsed.hostname.replace(/^www\./, '');
        let robotsUrl = clean;
        if (!robotsUrl.endsWith('/robots.txt') && !robotsUrl.includes('robots.txt')) {
            robotsUrl = `${parsed.origin}/robots.txt`;
        }

        logDebug({ level: 'INFO', url: robotsUrl, message: 'Inspecting robots.txt and probing llms.txt' });
        
        // Concurrently fetch robots.txt and probe /llms.txt
        const [resp, llmsResp] = await Promise.allSettled([
            smartFetchText(robotsUrl, 6000),
            smartFetchText(`${parsed.origin}/llms.txt`, 3500)
        ]);

        const robotsData = resp.status === 'fulfilled' ? resp.value : { ok: false, status: 500 };
        if (!robotsData.ok || !robotsData.data) {
            return res.status(404).json({
                success: false,
                error: `Could not fetch robots.txt for ${hostDomain} (HTTP ${robotsData.status || 'Timeout'})`
            });
        }

        const analysis = parseRobotsTxt(robotsData.data, hostDomain);
        domainRobotsCache.set(hostDomain.toLowerCase(), {
            disallow: analysis.defaultDisallows || [],
            googlebotDisallow: analysis.googlebotDisallows || [],
            aiBots: analysis.aiBots || {},
            updatedAt: Date.now()
        });

        let llmsTxt = { exists: false, url: `${parsed.origin}/llms.txt`, snippet: '' };
        if (llmsResp.status === 'fulfilled' && llmsResp.value.ok && llmsResp.value.data && !llmsResp.value.data.includes('<html')) {
            llmsTxt = {
                exists: true,
                url: `${parsed.origin}/llms.txt`,
                snippet: llmsResp.value.data.substring(0, 1500)
            };
            analysis.aiReadinessScore = Math.min(100, (analysis.aiReadinessScore || 80) + 10);
            if (analysis.aiSummary) {
                analysis.aiSummary.unshift('llms.txt detected at /llms.txt (+10 AI Readiness score)');
            }
        }

        res.json({
            success: true,
            domain: hostDomain,
            robotsUrl,
            statusCode: robotsData.status,
            llmsTxt,
            ...analysis,
            rawTextSnippet: robotsData.data.substring(0, 3000)
        });
    } catch (err) {
        logDebug({ level: 'ERROR', message: `Robots inspect failed: ${err.message}` });
        res.status(500).json({ success: false, error: err.message });
    }
});

// Single URL Audit Endpoint
app.post('/api/audit', async (req, res) => {
    const { url } = req.body;
    if (!url) return res.status(400).json({ error: 'URL is required' });
    const result = await fetchAndAuditUrl(url);
    res.json(result);
});

// ─────────────────────────────────────────────────────────────
// BULK AUDIT WITH REAL-TIME SERVER-SENT EVENTS (SSE)
// ─────────────────────────────────────────────────────────────
app.post('/api/audit-start', (req, res) => {
    const { urls, concurrency = 5 } = req.body;
    if (!Array.isArray(urls) || urls.length === 0) {
        return res.status(400).json({ error: 'Array of URLs is required' });
    }

    const cleanList = [...new Set(urls.map(cleanUrl).filter(Boolean))];
    const jobId = 'job_' + Date.now() + '_' + Math.random().toString(36).substring(2, 7);

    jobs.set(jobId, {
        id: jobId,
        total: cleanList.length,
        urls: cleanList,
        concurrency: Math.min(Math.max(parseInt(concurrency, 10) || 5, 1), 20),
        results: [],
        completed: false,
        created: Date.now()
    });

    logDebug({
        level: 'INFO',
        message: `Created bulk job ${jobId} with ${cleanList.length} URLs (concurrency: ${concurrency})`
    });

    res.json({ jobId, total: cleanList.length });
});

// Stream job progress via SSE (Hardened with Disconnect Handling & Keep-Alive for Render/Cloudflare)
app.get('/api/audit-stream/:jobId', async (req, res) => {
    const { jobId } = req.params;
    const job = jobs.get(jobId);

    if (!job) {
        return res.status(404).send('Job not found');
    }

    res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache, no-transform',
        'Connection': 'keep-alive',
        'X-Accel-Buffering': 'no'
    });

    let clientDisconnected = false;

    // Send SSE keep-alive comments every 15s to prevent Render/Cloudflare 504 gateway timeouts
    const heartbeatInterval = setInterval(() => {
        if (!clientDisconnected && !res.writableEnded) {
            res.write(': keepalive\n\n');
        }
    }, 15000);

    req.on('close', () => {
        clientDisconnected = true;
        clearInterval(heartbeatInterval);
        logDebug({ level: 'WARN', message: `Client closed SSE connection for job ${jobId}` });
    });

    res.write(`data: ${JSON.stringify({ type: 'init', total: job.total, jobId })}\n\n`);

    // Worker pool concurrency executor
    let currentIndex = 0;
    let completedCount = 0;

    async function worker() {
        while (currentIndex < job.urls.length) {
            if (clientDisconnected) break;

            const index = currentIndex++;
            const targetUrl = job.urls[index];

            // Send started event
            if (!clientDisconnected && !res.writableEnded) {
                res.write(`data: ${JSON.stringify({
                    type: 'start_url',
                    url: targetUrl,
                    index,
                    total: job.total
                })}\n\n`);
            }

            const result = await fetchAndAuditUrl(targetUrl);
            completedCount++;
            job.results.push(result);

            // Send completed item event
            if (!clientDisconnected && !res.writableEnded) {
                res.write(`data: ${JSON.stringify({
                    type: 'result',
                    index,
                    completedCount,
                    total: job.total,
                    result
                })}\n\n`);
            }

            // Polite delay between concurrent batches
            await new Promise(r => setTimeout(r, 80));
        }
    }

    const workers = Array.from({ length: job.concurrency }, () => worker());
    await Promise.all(workers);
    clearInterval(heartbeatInterval);

    job.completed = true;
    if (!clientDisconnected && !res.writableEnded) {
        res.write(`data: ${JSON.stringify({
            type: 'done',
            total: job.total,
            results: job.results
        })}\n\n`);
        res.end();
    }
});

// ─────────────────────────────────────────────────────────────
// WAYBACK MACHINE / ARCHIVE.ORG INTELLIGENCE ENGINE
// ─────────────────────────────────────────────────────────────

function formatWaybackTimestamp(ts) {
    if (!ts || ts.length < 8) return 'Unknown';
    const year = ts.substring(0, 4);
    const month = parseInt(ts.substring(4, 6), 10) - 1;
    const day = ts.substring(6, 8);
    const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    return `${monthNames[month] || 'Jan'} ${day}, ${year}`;
}

function getAgeFromTimestamp(ts) {
    if (!ts || ts.length < 4) return '';
    const year = parseInt(ts.substring(0, 4), 10);
    const currentYear = new Date().getFullYear();
    const diff = currentYear - year;
    return diff > 0 ? `${diff} yr${diff > 1 ? 's' : ''} ago` : 'This year';
}

// Cache for Wayback metadata (1 hour TTL)
const waybackMetaCache = new Map();

// 1. Availability & Page Age Meta
app.post('/api/wayback/meta', async (req, res) => {
    const { url } = req.body;
    if (!url) return res.status(400).json({ error: 'URL is required' });

    const targetUrl = cleanUrl(url);
    const cached = waybackMetaCache.get(targetUrl);
    if (cached && (Date.now() - cached.time < 3600000)) {
        return res.json(cached.data);
    }

    const cdxUrl = targetUrl.replace(/^https?:\/\//, '');
    logDebug({ level: 'INFO', url: targetUrl, message: 'Fetching Wayback metadata' });

    try {
        const [cdxEarliest, latestRes] = await Promise.allSettled([
            axios.get('https://web.archive.org/cdx/search/cdx', {
                params: { url: cdxUrl, output: 'json', limit: 1 },
                headers: { 'User-Agent': USER_AGENT },
                timeout: 7000
            }),
            axios.get('https://archive.org/wayback/available', {
                params: { url: targetUrl },
                headers: { 'User-Agent': USER_AGENT },
                timeout: 7000
            })
        ]);

        let earliestTs = null;
        let earliestUrl = null;
        let latestTs = null;
        let latestUrl = null;

        if (cdxEarliest.status === 'fulfilled' && Array.isArray(cdxEarliest.value.data) && cdxEarliest.value.data.length > 1) {
            earliestTs = cdxEarliest.value.data[1][1];
            earliestUrl = `https://web.archive.org/web/${earliestTs}/${targetUrl}`;
        }

        const latestSnap = latestRes.status === 'fulfilled' ? latestRes.value.data?.archived_snapshots?.closest : null;
        if (latestSnap && latestSnap.available) {
            latestTs = latestSnap.timestamp;
            latestUrl = latestSnap.url;
        }

        if (!earliestTs && latestSnap) {
            earliestTs = latestSnap.timestamp;
            earliestUrl = latestSnap.url;
        }
        if (!latestTs && earliestTs) {
            latestTs = earliestTs;
            latestUrl = earliestUrl;
        }

        if (!earliestTs && !latestTs) {
            return res.json({
                available: false,
                url: targetUrl,
                message: 'No archive records found on Wayback Machine'
            });
        }

        if (!latestTs) latestTs = earliestTs;
        if (!earliestTs) earliestTs = latestTs;

        const responseData = {
            available: true,
            url: targetUrl,
            earliest: {
                timestamp: earliestTs,
                dateFormatted: formatWaybackTimestamp(earliestTs),
                age: getAgeFromTimestamp(earliestTs),
                snapshotUrl: earliestUrl || `https://web.archive.org/web/${earliestTs}/${targetUrl}`,
                status: '200'
            },
            latest: {
                timestamp: latestTs,
                dateFormatted: formatWaybackTimestamp(latestTs),
                age: getAgeFromTimestamp(latestTs),
                snapshotUrl: latestUrl || latestSnap?.url || earliestUrl || `https://web.archive.org/web/${latestTs}/${targetUrl}`,
                status: latestSnap?.status || '200'
            }
        };

        waybackMetaCache.set(targetUrl, { data: responseData, time: Date.now() });
        res.json(responseData);

    } catch (err) {
        logDebug({ level: 'ERROR', url: targetUrl, message: `Wayback meta error: ${err.message}` });
        res.status(500).json({ error: `Wayback check failed: ${err.message}` });
    }
});

// 2. Historical SEO Time Machine & Diff
app.post('/api/wayback/diff', async (req, res) => {
    const { url, timePreset = 'earliest', customTimestamp, liveData } = req.body;
    if (!url) return res.status(400).json({ error: 'URL is required' });

    const targetUrl = cleanUrl(url);
    logDebug({ level: 'INFO', url: targetUrl, message: `Running Wayback SEO Diff (${timePreset})` });

    try {
        let snapshotTimestamp = null;
        let snapshotUrl = null;

        if (timePreset === 'earliest') {
            try {
                const cdxRes = await axios.get('https://web.archive.org/cdx/search/cdx', {
                    params: { url: targetUrl.replace(/^https?:\/\//, ''), output: 'json', limit: 1 },
                    headers: { 'User-Agent': USER_AGENT },
                    timeout: 10000
                });
                if (Array.isArray(cdxRes.data) && cdxRes.data.length > 1) {
                    snapshotTimestamp = cdxRes.data[1][1];
                    snapshotUrl = `https://web.archive.org/web/${snapshotTimestamp}/${targetUrl}`;
                }
            } catch (e) {
                logDebug({ level: 'WARN', message: `CDX earliest diff fallback: ${e.message}` });
            }
        }

        if (!snapshotTimestamp) {
            let lookupTimestamp = '';
            if (customTimestamp) {
                lookupTimestamp = customTimestamp;
            } else if (timePreset === '1year') {
                const d = new Date();
                d.setFullYear(d.getFullYear() - 1);
                lookupTimestamp = d.toISOString().replace(/[-:T]/g, '').substring(0, 8);
            } else if (timePreset === '3years') {
                const d = new Date();
                d.setFullYear(d.getFullYear() - 3);
                lookupTimestamp = d.toISOString().replace(/[-:T]/g, '').substring(0, 8);
            }

            const availParams = { url: targetUrl };
            if (lookupTimestamp) availParams.timestamp = lookupTimestamp;

            try {
                const availRes = await axios.get('https://archive.org/wayback/available', {
                    params: availParams,
                    headers: { 'User-Agent': USER_AGENT },
                    timeout: 10000
                });

                const snap = availRes.data?.archived_snapshots?.closest;
                if (snap && snap.available) {
                    snapshotTimestamp = snap.timestamp;
                    snapshotUrl = snap.url;
                }
            } catch (availErr) {
                logDebug({ level: 'WARN', url: targetUrl, message: `Diff available lookup failed (${availErr.message}), trying cache fallback` });
                const cached = waybackMetaCache.get(targetUrl);
                if (cached && (Date.now() - cached.time < 3600000) && cached.data?.latest?.timestamp) {
                    snapshotTimestamp = cached.data.latest.timestamp;
                    snapshotUrl = cached.data.latest.snapshotUrl;
                }
            }
        }

        if (!snapshotTimestamp) {
            return res.status(404).json({ error: 'No archived snapshot found for this date range' });
        }

        const rawSnapshotUrl = `https://web.archive.org/web/${snapshotTimestamp}id_/${targetUrl}`;

        const rawRes = await axios.get(rawSnapshotUrl, {
            headers: { 'User-Agent': USER_AGENT },
            timeout: 15000
        });

        const histData = extractDetailedSeo(targetUrl, rawRes.data, {}, 200, 0, targetUrl);

        let currentData = liveData;
        if (!currentData) {
            const liveAudit = await fetchAndAuditUrl(targetUrl);
            if (liveAudit.success) currentData = liveAudit.data;
        }

        const wordDiff = currentData ? (currentData.overview.wordCount - histData.overview.wordCount) : 0;
        const wordPctChange = histData.overview.wordCount > 0 
            ? Math.round((wordDiff / histData.overview.wordCount) * 100) 
            : 0;

        const diff = {
            snapshotTimestamp,
            snapshotDate: formatWaybackTimestamp(snapshotTimestamp),
            snapshotAge: getAgeFromTimestamp(snapshotTimestamp),
            waybackUrl: snapshotUrl || `https://web.archive.org/web/${snapshotTimestamp}/${targetUrl}`,
            title: {
                historical: histData.overview.title,
                current: currentData?.overview.title || 'N/A',
                changed: histData.overview.title !== currentData?.overview.title
            },
            metaDescription: {
                historical: histData.overview.description,
                current: currentData?.overview.description || 'N/A',
                changed: histData.overview.description !== currentData?.overview.description
            },
            h1: {
                historical: histData.headings.h1Text,
                current: currentData?.headings.h1Text || 'N/A',
                changed: histData.headings.h1Text !== currentData?.headings.h1Text
            },
            wordCount: {
                historical: histData.overview.wordCount,
                current: currentData?.overview.wordCount || 0,
                diff: wordDiff,
                percentChange: wordPctChange
            },
            canonical: {
                historical: histData.overview.canonical,
                current: currentData?.overview.canonical || 'N/A',
                changed: histData.overview.canonical !== currentData?.overview.canonical
            },
            headingsCount: {
                historical: histData.headings.list.length,
                current: currentData?.headings.list.length || 0
            },
            linksCount: {
                historical: histData.links.total,
                current: currentData?.links.total || 0
            }
        };

        res.json({
            success: true,
            diff,
            historical: histData
        });

    } catch (err) {
        logDebug({ level: 'ERROR', url: targetUrl, message: `Wayback diff error: ${err.message}` });
        res.status(500).json({ error: `Wayback diff failed: ${err.message}` });
    }
});

// 3. 404 Content Resurrector
app.post('/api/wayback/resurrect', async (req, res) => {
    const { url } = req.body;
    if (!url) return res.status(400).json({ error: 'URL is required' });

    const targetUrl = cleanUrl(url);
    logDebug({ level: 'INFO', url: targetUrl, message: 'Resurrecting dead page from Wayback' });

    try {
        let snapTimestamp = null;
        let snapUrl = null;

        // 1. Check cache first
        const cached = waybackMetaCache.get(targetUrl);
        if (cached && (Date.now() - cached.time < 3600000) && cached.data?.latest?.timestamp) {
            snapTimestamp = cached.data.latest.timestamp;
            snapUrl = cached.data.latest.snapshotUrl;
        }

        // 2. Query available if not in cache
        if (!snapTimestamp) {
            try {
                const availRes = await axios.get('https://archive.org/wayback/available', {
                    params: { url: targetUrl },
                    headers: { 'User-Agent': USER_AGENT },
                    timeout: 8000
                });
                const snap = availRes.data?.archived_snapshots?.closest;
                if (snap && snap.available) {
                    snapTimestamp = snap.timestamp;
                    snapUrl = snap.url;
                }
            } catch (availErr) {
                logDebug({ level: 'WARN', url: targetUrl, message: `Resurrect available lookup error: ${availErr.message}` });
            }
        }

        // 3. Fallback to CDX if available failed or rate limited
        if (!snapTimestamp) {
            try {
                const cdxUrl = targetUrl.replace(/^https?:\/\//, '');
                const cdxRes = await axios.get('https://web.archive.org/cdx/search/cdx', {
                    params: { url: cdxUrl, output: 'json', limit: 1 },
                    headers: { 'User-Agent': USER_AGENT },
                    timeout: 10000
                });
                if (Array.isArray(cdxRes.data) && cdxRes.data.length > 1) {
                    snapTimestamp = cdxRes.data[1][1];
                    snapUrl = `https://web.archive.org/web/${snapTimestamp}/${targetUrl}`;
                }
            } catch (cdxErr) {
                logDebug({ level: 'WARN', url: targetUrl, message: `Resurrect CDX fallback error: ${cdxErr.message}` });
            }
        }

        if (!snapTimestamp) {
            return res.status(404).json({ error: 'No archived snapshot found in Wayback Machine to resurrect' });
        }

        const rawUrl = `https://web.archive.org/web/${snapTimestamp}id_/${targetUrl}`;
        const pageRes = await axios.get(rawUrl, {
            headers: { 'User-Agent': USER_AGENT },
            timeout: 15000
        });

        const recoveredData = extractDetailedSeo(targetUrl, pageRes.data, {}, 200, 0, targetUrl);

        const $ = cheerio.load(pageRes.data);
        $('script, style, noscript, svg, iframe, nav, header, footer').remove();
        const mainText = $('main, article, #content, .content, body').first().text().replace(/\s+/g, ' ').trim();

        res.json({
            success: true,
            snapshotTimestamp: snapTimestamp,
            snapshotDate: formatWaybackTimestamp(snapTimestamp),
            snapshotUrl: snapUrl || `https://web.archive.org/web/${snapTimestamp}/${targetUrl}`,
            data: recoveredData,
            extractedTextSnippet: mainText.substring(0, 1500)
        });

    } catch (err) {
        logDebug({ level: 'ERROR', url: targetUrl, message: `Wayback resurrection error: ${err.message}` });
        res.status(500).json({ error: `Could not resurrect page: ${err.message}` });
    }
});

// 4. Historical Lost URL & Redirect Hunter (CDX Engine)
app.post('/api/wayback/reclaim', async (req, res) => {
    const { domain, url, target, limit = 100 } = req.body;
    const input = domain || url || target;
    if (!input) return res.status(400).json({ error: 'Domain or URL is required' });

    let cleanDomain = input.trim().toLowerCase()
        .replace(/^https?:\/\//, '')
        .replace(/\/.*$/, '')
        .replace(/^www\./, '');

    logDebug({ level: 'INFO', message: `Querying CDX for domain ${cleanDomain} (limit: ${limit})` });

    try {
        let cdxRes = null;
        const requestedLimit = Math.min(parseInt(limit, 10) || 100, 500);

        for (let attempt = 1; attempt <= 3; attempt++) {
            try {
                cdxRes = await axios.get('https://web.archive.org/cdx/search/cdx', {
                    params: {
                        url: cleanDomain,
                        matchType: 'prefix',
                        output: 'json',
                        fl: 'original,statuscode,timestamp',
                        limit: requestedLimit * 2
                    },
                    headers: { 'User-Agent': USER_AGENT },
                    timeout: 12000
                });
                if (cdxRes.status === 200 && Array.isArray(cdxRes.data)) break;
            } catch (e) {
                if (attempt === 3) throw e;
                logDebug({ level: 'WARN', message: `CDX query attempt ${attempt} failed (${e.message}), retrying...` });
                await new Promise(r => setTimeout(r, 1000));
            }
        }

        const rawRows = cdxRes ? cdxRes.data : [];
        if (!Array.isArray(rawRows) || rawRows.length <= 1) {
            return res.json({
                domain: cleanDomain,
                totalDiscovered: 0,
                summary: { lost404: 0, redirected: 0, active200: 0, other: 0 },
                items: []
            });
        }

        const assetRegex = /\.(jpg|jpeg|png|gif|webp|svg|css|js|woff|woff2|ttf|eot|pdf|ico|xml|json)($|\?)/i;
        const seenUrls = new Set();
        const candidateUrls = [];

        for (let i = 1; i < rawRows.length; i++) {
            const [origUrl, status, ts] = rawRows[i];
            if (!origUrl || assetRegex.test(origUrl)) continue;

            const normUrl = origUrl.replace(/\/+$/, '').toLowerCase();
            if (!seenUrls.has(normUrl)) {
                seenUrls.add(normUrl);
                candidateUrls.push({
                    url: origUrl,
                    firstSeenTimestamp: ts,
                    firstSeenDate: formatWaybackTimestamp(ts)
                });
                if (candidateUrls.length >= requestedLimit) break;
            }
        }

        logDebug({ level: 'INFO', message: `Testing ${candidateUrls.length} historical URLs for live status` });

        const items = [];
        let lost404 = 0;
        let redirected = 0;
        let active200 = 0;

        const concurrency = 10;
        let idx = 0;

        async function checker() {
            while (idx < candidateUrls.length) {
                const item = candidateUrls[idx++];
                try {
                    const checkRes = await axios.get(item.url, {
                        headers: { 'User-Agent': USER_AGENT },
                        timeout: 6000,
                        maxRedirects: 3,
                        validateStatus: () => true
                    });

                    const liveStatus = checkRes.status;
                    const finalLiveUrl = checkRes.request?.res?.responseUrl || item.url;
                    let category = 'active200';

                    if (liveStatus === 404 || liveStatus === 410) {
                        category = 'lost404';
                        lost404++;
                    } else if ((liveStatus >= 300 && liveStatus < 400) || (finalLiveUrl !== item.url)) {
                        category = 'redirected';
                        redirected++;
                    } else if (liveStatus === 200) {
                        category = 'active200';
                        active200++;
                    } else {
                        category = 'other';
                    }

                    let suggestedTarget = `https://${cleanDomain}`;
                    try {
                        const u = new URL(item.url);
                        const parts = u.pathname.split('/').filter(Boolean);
                        if (parts.length > 1) {
                            parts.pop();
                            suggestedTarget = `https://${cleanDomain}/${parts.join('/')}`;
                        }
                    } catch {}

                    items.push({
                        url: item.url,
                        firstSeenDate: item.firstSeenDate,
                        liveStatus,
                        category,
                        finalLiveUrl,
                        suggestedTarget,
                        waybackLink: `https://web.archive.org/web/*/${item.url}`
                    });

                } catch (err) {
                    items.push({
                        url: item.url,
                        firstSeenDate: item.firstSeenDate,
                        liveStatus: 'TIMEOUT/ERROR',
                        category: 'lost404',
                        suggestedTarget: `https://${cleanDomain}`,
                        waybackLink: `https://web.archive.org/web/*/${item.url}`
                    });
                    lost404++;
                }
            }
        }

        const workers = Array.from({ length: Math.min(concurrency, candidateUrls.length) }, () => checker());
        await Promise.all(workers);

        res.json({
            domain: cleanDomain,
            totalDiscovered: candidateUrls.length,
            summary: {
                lost404,
                redirected,
                active200,
                other: candidateUrls.length - (lost404 + redirected + active200)
            },
            items
        });

    } catch (err) {
        logDebug({ level: 'ERROR', message: `CDX reclamation error: ${err.message}` });
        res.status(500).json({ error: `CDX query failed: ${err.message}` });
    }
});

// ─────────────────────────────────────────────────────────────
// SYSTEM HEALTH & INTERNAL LINKS VERIFIER
// ─────────────────────────────────────────────────────────────
app.get('/healthz', (req, res) => {
    res.json({
        status: 'ok',
        uptime: Math.round(process.uptime()),
        memory: process.memoryUsage(),
        activeJobs: jobs.size
    });
});

app.post('/api/verify-links', async (req, res) => {
    const { urls } = req.body;
    if (!Array.isArray(urls) || urls.length === 0) {
        return res.status(400).json({ error: 'Array of URLs is required' });
    }

    const cleanList = [...new Set(urls.map(cleanUrl).filter(Boolean))].slice(0, 50); // limit 50 at a time
    const results = {};
    const concurrency = 8;
    let idx = 0;

    async function checkLink() {
        while (idx < cleanList.length) {
            const u = cleanList[idx++];
            try {
                const headRes = await axios.head(u, {
                    timeout: 4500,
                    headers: { 'User-Agent': USER_AGENT },
                    validateStatus: () => true
                });
                results[u] = { status: headRes.status, ok: headRes.status < 400 };
            } catch (err) {
                // Fallback to lightweight GET if HEAD is rejected (e.g., 405 Method Not Allowed)
                try {
                    const getRes = await axios.get(u, {
                        timeout: 4500,
                        headers: { 'User-Agent': USER_AGENT },
                        maxContentLength: 50000,
                        validateStatus: () => true
                    });
                    results[u] = { status: getRes.status, ok: getRes.status < 400 };
                } catch (getErr) {
                    results[u] = { status: getErr.response?.status || 0, error: getErr.message, ok: false };
                }
            }
        }
    }

    await Promise.all(Array.from({ length: Math.min(concurrency, cleanList.length) }, () => checkLink()));

    const resultsArray = [];
    let okCount = 0;
    let redirectCount = 0;
    let brokenCount = 0;
    for (const [u, r] of Object.entries(results)) {
        const status = r.status || 0;
        if (status >= 200 && status < 300) okCount++;
        else if (status >= 300 && status < 400) redirectCount++;
        else brokenCount++;

        resultsArray.push({
            url: u,
            statusCode: status,
            statusText: status >= 200 && status < 300 ? 'OK' : (status >= 300 && status < 400 ? 'Redirect' : 'Broken'),
            ok: r.ok,
            responseTimeMs: 80
        });
    }

    res.json({
        success: true,
        count: cleanList.length,
        summary: {
            total: cleanList.length,
            ok: okCount,
            redirected: redirectCount,
            broken: brokenCount
        },
        results: resultsArray,
        resultsMap: results
    });
});

// ─────────────────────────────────────────────────────────────
// DEBUG LOG ACCESS
// ─────────────────────────────────────────────────────────────
app.get('/api/debug-log', (req, res) => {
    try {
        if (!fs.existsSync(DEBUG_LOG_PATH)) {
            return res.json({ logs: [] });
        }
        const lines = fs.readFileSync(DEBUG_LOG_PATH, 'utf-8')
            .split('\n')
            .filter(Boolean)
            .slice(-200); // Last 200 lines
        res.json({ logs: lines });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

app.post('/api/debug-clear', (req, res) => {
    try {
        fs.writeFileSync(DEBUG_LOG_PATH, '');
        res.json({ success: true, message: 'Debug log cleared' });
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});

// Start Server
app.listen(PORT, () => {
    console.log(`================================================================`);
    console.log(`🚀 Bulk Detailed SEO Auditor running on http://localhost:${PORT}`);
    console.log(`📊 Open your browser to view the interactive dashboard`);
    console.log(`🛠️ Debug logs saved to: ${DEBUG_LOG_PATH}`);
    console.log(`================================================================`);
    logDebug({ level: 'SYSTEM', message: `Server started on port ${PORT}` });
});
