# Bulk Detailed SEO Extension & Wayback Machine Intelligence Suite

An enterprise full-stack bulk auditor that replicates 100% of the **Detailed SEO Extension** functionality across **10 to 10,000+ URLs simultaneously**, combined with an **Archive.org / Wayback Machine Intelligence Engine** for historical SEO diffing, 404 dead-page content resurrection, and CDX lost URL reclamation.

---

## ⚡ Key Highlights & 1:1 Extension Parity

| Tab / Capability | What the App Delivers |
| :--- | :--- |
| **Overview** | Title (length & status), Meta Description (length & status), URL Indexability check, Canonical tag & Self-referencing verification, Robots tag, X-Robots-Tag, Meta Keywords, Clean Word Count, and **🏛️ Archive.org First Indexed Age Badge**. |
| **Headings** | H1, H2, H3, H4, H5, H6 counts, complete visual hierarchy outline tree with indentation, and 1-Click "Copy Outline". |
| **Links** | Total Links, Unique Links, Internal vs External breakdown, target URLs, anchor text mapping, and follow/nofollow badges. |
| **Images** | Total Images, Images with Alt, Missing Alt, and exact previews of all images lacking alt tags. |
| **Schema & Hreflang** | JSON-LD schema detection (`BreadcrumbList`, `Organization`, etc.), Hreflang language matrix, HTTP status, and 2-way verification indicator. |
| **Social** | Complete OpenGraph (`og:*`) & Twitter Card preview simulation with title, description, image, and domain. |
| **🤖 Robots.txt & AI Crawlers** | *(New)* Enterprise `robots.txt` parser with AI Bot readiness matrix (`OAI-SearchBot`, `GPTBot`, `Google-Extended`, `PerplexityBot`), 35+ multi-sitemap extraction with vertical category filtering (Holidays, Flights, Hotels, Activities), and live crawl disallow verification. |
| **⏳ Time Machine (Diff)** | *(New)* Compare live DOM directly against Archive.org snapshots (*Earliest/First Seen, 1 Year Ago, 3 Years Ago, or Latest*). Shows exact visual diffs for Title, H1, Meta Description, Word Count trend (+/- % change), and Headings evolution. |
| **🧟 404 Resurrector** | *(New)* 1-Click recovery of dead/404 pages. Fetches the last working snapshot from Wayback, extracts the lost Title, H1, Meta Description, and visible copy snippet with an automatic suggested 301 redirect target. |
| **🛰️ CDX Reclamation Hunter** | *(New)* Queries Wayback CDX API for all historical URLs ever crawled for your domain, tests them live against your server, isolates **Dead 404 Pages** with historical link equity, and exports a 1-click **301 Redirect Mapping CSV**. |
| **🛠️ Live Debugger** | Persistent rolling log file (`debug.log`), real-time in-app terminal drawer, TTFB/latency tracking, error codes, and 1-click JSON diagnostic report download. |

---

## 🚀 Quick Start

### 1. Launch with One Click
Double-click `start.bat` in this folder:
```text
C:\Users\ydtva\bulk-detailed-seo\start.bat
```
This automatically starts the local server and opens your browser at [http://localhost:3300](http://localhost:3300).

### 2. Manual Command Line Start
```bash
cd C:\Users\ydtva\bulk-detailed-seo
npm install
node server.js
```

---

## 📋 Features & How to Use

1. **Bulk Detailed Audit**:
   - Paste URLs, fetch an entire XML sitemap (e.g. `https://yatradham.org/sitemap.xml`), or upload CSV/TXT files.
   - Adjust worker concurrency (1 to 20 threads).
   - Click **"Start Bulk Audit"** to view real-time progress via Server-Sent Events.
   - Click **"Inspect"** on any row to open the Detailed Drawer with all 7 tabs including **Time Machine**.

2. **Wayback Time Machine (Diff)**:
   - In the modal drawer, click **"Time Machine (Diff)"**.
   - Select a time preset (*Earliest Capture, 1 Year Ago, 3 Years Ago, Latest Archive*).
   - View live vs historical Title, H1, Description, and Word Count changes.

3. **404 Dead Page Resurrector**:
   - For any URL returning an error in the audit table or CDX list, click the purple **"🧟 Resurrect"** button.
   - View recovered copy, headings, and copy the suggested 301 redirect target.

4. **Wayback Lost URL Hunter (CDX)**:
   - Switch to the **"Wayback Lost URL Hunter (CDX)"** tab on the main screen.
   - Enter your domain (e.g. `yatradham.org`) and select the max capture limit (50 to 500).
   - Click **"Hunt Lost 404 URLs"**.
   - Filter by **Dead 404s Only** and click **"Export 301 Redirect Map (.CSV)"**.
