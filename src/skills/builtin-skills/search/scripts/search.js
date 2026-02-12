/**
 * Search skill — web search, news, images, scraping.
 * Uses duck-duck-scrape for search and cheerio for scraping.
 */

let duckSearch;
try { duckSearch = require('duck-duck-scrape'); } catch {}

let cheerio;
try { cheerio = require('cheerio'); } catch {}

function isRateLimitError(err) {
  const msg = (err.message || '').toLowerCase();
  return msg.includes('anomaly') || msg.includes('too quickly') || msg.includes('rate');
}

async function withRetry(fn, { maxRetries = 3, baseDelay = 2000 } = {}) {
  let lastErr;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (attempt < maxRetries && isRateLimitError(err)) {
        const delay = baseDelay * Math.pow(2, attempt);
        await new Promise((r) => setTimeout(r, delay));
      } else if (!isRateLimitError(err)) {
        throw err;
      }
    }
  }
  throw lastErr;
}

async function search_web(args) {
  if (!duckSearch) return 'Error: duck-duck-scrape not installed.';
  const query = args.query;
  if (!query) return 'Error: query is required.';
  const maxResults = args.max_results || 5;

  try {
    const results = await withRetry(() => duckSearch.search(query, { safeSearch: duckSearch.SafeSearchType.MODERATE }));
    const items = (results.results || []).slice(0, maxResults);
    if (!items.length) return 'No results found.';
    return items.map((r, i) => `${i + 1}. ${r.title}\n   ${r.url}\n   ${r.description || ''}`).join('\n\n');
  } catch (err) {
    if (isRateLimitError(err)) return 'Search temporarily unavailable (rate limited). Do NOT retry search — use alternative approaches or respond with what you already have.';
    return `Search error: ${err.message}`;
  }
}

async function search_news(args) {
  if (!duckSearch) return 'Error: duck-duck-scrape not installed.';
  const query = args.query;
  if (!query) return 'Error: query is required.';
  const maxResults = args.max_results || 5;

  try {
    const results = await withRetry(() => duckSearch.searchNews(query));
    const items = (results.results || []).slice(0, maxResults);
    if (!items.length) return 'No news results found.';
    return items.map((r, i) => `${i + 1}. ${r.title}\n   ${r.url}\n   ${r.excerpt || ''}\n   ${r.date || ''}`).join('\n\n');
  } catch (err) {
    if (isRateLimitError(err)) return 'News search temporarily unavailable (rate limited). Do NOT retry search — use alternative approaches or respond with what you already have.';
    return `News search error: ${err.message}`;
  }
}

async function search_images(args) {
  if (!duckSearch) return 'Error: duck-duck-scrape not installed.';
  const query = args.query;
  if (!query) return 'Error: query is required.';
  const maxResults = args.max_results || 5;

  try {
    const results = await withRetry(() => duckSearch.searchImages(query, { safeSearch: duckSearch.SafeSearchType.MODERATE }));
    const items = (results.results || []).slice(0, maxResults);
    if (!items.length) return 'No image results found.';
    return items.map((r, i) => `${i + 1}. ${r.title}\n   ${r.image}\n   Source: ${r.url}`).join('\n\n');
  } catch (err) {
    if (isRateLimitError(err)) return 'Image search temporarily unavailable (rate limited). Do NOT retry search — use alternative approaches or respond with what you already have.';
    return `Image search error: ${err.message}`;
  }
}

async function search_scrape(args) {
  const url = args.url;
  if (!url) return 'Error: url is required.';

  try {
    const resp = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; BotBot/1.0)' },
      signal: AbortSignal.timeout(30000),
    });
    const html = await resp.text();

    if (cheerio) {
      const $ = cheerio.load(html);
      // Remove scripts, styles, nav, footer
      $('script, style, nav, footer, header, aside, .nav, .footer, .sidebar').remove();
      const text = $('body').text().replace(/\s+/g, ' ').trim();
      return text.slice(0, 50000) || '(empty page)';
    }
    // Fallback: strip tags
    return html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 50000);
  } catch (err) {
    return `Scrape error: ${err.message}`;
  }
}

async function search_extract(args) {
  const url = args.url;
  const selector = args.selector;
  if (!url || !selector) return 'Error: url and selector are required.';
  if (!cheerio) return 'Error: cheerio not installed.';

  try {
    const resp = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; BotBot/1.0)' },
      signal: AbortSignal.timeout(30000),
    });
    const html = await resp.text();
    const $ = cheerio.load(html);
    const elements = $(selector);
    if (!elements.length) return `No elements found for selector: ${selector}`;

    const results = [];
    elements.each((i, el) => {
      if (i >= 50) return false;
      results.push($(el).text().trim());
    });
    return results.join('\n---\n') || '(empty)';
  } catch (err) {
    return `Extract error: ${err.message}`;
  }
}

async function search_links(args) {
  const url = args.url;
  if (!url) return 'Error: url is required.';
  if (!cheerio) return 'Error: cheerio not installed.';

  try {
    const resp = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; BotBot/1.0)' },
      signal: AbortSignal.timeout(30000),
    });
    const html = await resp.text();
    const $ = cheerio.load(html);
    const links = [];
    $('a[href]').each((i, el) => {
      if (i >= 100) return false;
      const href = $(el).attr('href');
      const text = $(el).text().trim().slice(0, 100);
      if (href) links.push(`${text || '(no text)'} → ${href}`);
    });
    return links.join('\n') || 'No links found.';
  } catch (err) {
    return `Links error: ${err.message}`;
  }
}

module.exports = { search_web, search_news, search_images, search_scrape, search_extract, search_links };

// CLI entry point
if (require.main === module) {
  const toolName = process.argv[2];
  const args = process.argv[3] ? JSON.parse(process.argv[3]) : {};
  const handlers = { search_web, search_news, search_images, search_scrape, search_extract, search_links };
  const handler = handlers[toolName];
  if (!handler) { console.error(`Unknown tool: ${toolName}`); process.exit(1); }
  handler(args).then((r) => console.log(r)).catch((e) => { console.error(e); process.exit(1); });
}
