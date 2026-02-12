# Browser

Automate a Chromium browser for navigation, interaction, screenshots, and JS rendering.

## Tools

### Navigation
- **browser_open** — Navigate to a URL
- **browser_back** — Navigate back
- **browser_forward** — Navigate forward
- **browser_refresh** — Refresh the page
- **browser_url** — Get current URL
- **browser_title** — Get page title

### Content
- **browser_content** — Get text content of the page or element
- **browser_html** — Get HTML of the page or element
- **browser_eval** — Execute JavaScript on the page

### Interaction
- **browser_click** — Click an element by CSS selector
- **browser_type** — Type text into an element
- **browser_select** — Select an option in a dropdown
- **browser_hover** — Hover over an element
- **browser_scroll** — Scroll the page
- **browser_wait** — Wait for an element to appear

### Screenshots & Export
- **browser_screenshot** — Take a screenshot of the page or element
- **browser_pdf** — Save page as PDF

### Tabs
- **browser_tabs** — List open tabs
- **browser_newtab** — Open a new tab
- **browser_closetab** — Close a tab

### Cookies
- **browser_cookies** — Get cookies
- **browser_setcookie** — Set a cookie

### Lifecycle
- **browser_close** — Close the browser

## Usage

- Use `search_web`/`search_scrape` for simple lookups. Only use browser for interactive pages, JS rendering, or screenshots.
- Typical flow: `browser_open` → interact (`browser_click`, `browser_type`) → read (`browser_content`) or capture (`browser_screenshot`) → `browser_close`.
- Use `browser_wait` before clicking dynamically loaded content.
- Use `browser_eval` for complex JS interactions or data extraction.
- Always `browser_close` when done to free resources.
