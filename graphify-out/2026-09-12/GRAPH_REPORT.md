# Graph Report - bulk-detailed-seo  (2026-09-08)

## Corpus Check
- 9 files · ~18,192 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 76 nodes · 76 edges · 13 communities (7 shown, 6 thin omitted)
- Extraction: 100% EXTRACTED · 0% INFERRED · 0% AMBIGUOUS
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `b00e6088`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- server.js
- dependencies
- package.json
- Bulk Detailed SEO Extension & Wayback Machine Intelligence Suite
- fetchAndAuditUrl
- test-all-modes.js
- extractDetailedSeo
- test-audit.js
- test-e2e.js
- test-robots-verification.js
- test-wayback.js
- test-wayback-suite.js
- categorizeSitemapUrl

## God Nodes (most connected - your core abstractions)
1. `fetchAndAuditUrl()` - 6 edges
2. `extractDetailedSeo()` - 5 edges
3. `Bulk Detailed SEO Extension & Wayback Machine Intelligence Suite` - 4 edges
4. `🚀 Quick Start` - 3 edges
5. `scripts` - 2 edges
6. `axios` - 2 edges
7. `cheerio` - 2 edges
8. `cors` - 2 edges
9. `express` - 2 edges
10. `logDebug()` - 2 edges

## Surprising Connections (you probably didn't know these)
- `fetchAndAuditUrl()` --calls--> `extractDetailedSeo()`  [EXTRACTED]
  server.js → server.js  _Bridges community 6 → community 4_

## Import Cycles
- None detected.

## Communities (13 total, 6 thin omitted)

### Community 0 - "server.js"
Cohesion: 0.11
Nodes (12): app, axios, cheerio, cors, DEBUG_LOG_PATH, domainRobotsCache, express, fs (+4 more)

### Community 1 - "dependencies"
Cohesion: 0.22
Nodes (9): axios, cheerio, cors, express, dependencies, axios, cheerio, cors (+1 more)

### Community 2 - "package.json"
Cohesion: 0.29
Nodes (6): description, main, name, scripts, start, version

### Community 3 - "Bulk Detailed SEO Extension & Wayback Machine Intelligence Suite"
Cohesion: 0.29
Nodes (6): 1. Launch with One Click, 2. Manual Command Line Start, Bulk Detailed SEO Extension & Wayback Machine Intelligence Suite, 📋 Features & How to Use, ⚡ Key Highlights & 1:1 Extension Parity, 🚀 Quick Start

### Community 4 - "fetchAndAuditUrl"
Cohesion: 0.40
Nodes (5): cleanUrl(), fetchAndAuditUrl(), logDebug(), smartFetchText(), worker()

### Community 5 - "test-all-modes.js"
Cohesion: 0.40
Nodes (3): axios, cheerio, fs

### Community 6 - "extractDetailedSeo"
Cohesion: 0.50
Nodes (4): extractDetailedSeo(), extractSchemaSummary(), isPathDisallowed(), resolveUrl()

## Knowledge Gaps
- **36 isolated node(s):** `name`, `version`, `description`, `main`, `start` (+31 more)
  These have ≤1 connection - possible missing edges or undocumented components.
- **6 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `dependencies` connect `dependencies` to `package.json`?**
  _High betweenness centrality (0.029) - this node is a cross-community bridge._
- **What connects `name`, `version`, `description` to the rest of the system?**
  _36 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `server.js` be split into smaller, more focused modules?**
  _Cohesion score 0.1111111111111111 - nodes in this community are weakly interconnected._