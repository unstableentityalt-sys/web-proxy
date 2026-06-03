const cheerio = require('cheerio');

function resolveUrl(base, relative) {
  try {
    return new URL(relative, base).href;
  } catch {
    return relative;
  }
}

function rewriteHtml(html, baseUrl) {
  const $ = cheerio.load(html);

  const rewrite = (attr) => (_, el) => {
    const val = $(el).attr(attr);
    if (val && !val.startsWith('data:') && !val.startsWith('javascript:') && !val.startsWith('#') && !val.startsWith('mailto:')) {
      const absolute = resolveUrl(baseUrl, val);
      if (absolute.startsWith('http')) {
        $(el).attr(attr, `/api/proxy?url=${encodeURIComponent(absolute)}`);
      }
    }
  };

  $('a[href]').each(rewrite('href'));
  $('img[src]').each(rewrite('src'));
  $('link[href]').each(rewrite('href'));
  $('script[src]').each(rewrite('src'));
  $('form[action]').each(rewrite('action'));
  $('iframe[src]').each(rewrite('src'));
  $('source[src]').each(rewrite('src'));

  $('body').prepend(`
    <div style="position:fixed;top:0;left:0;right:0;z-index:2147483647;background:#1a1a2e;color:#eee;padding:8px 16px;font-family:sans-serif;font-size:13px;display:flex;align-items:center;gap:12px;box-shadow:0 2px 8px rgba(0,0,0,.4)">
      <strong style="white-space:nowrap">Algebra Tools</strong>
      <span style="color:#888;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1;font-size:12px">${baseUrl}</span>
      <a href="/" style="color:#7eb8f7;text-decoration:none;white-space:nowrap;font-size:13px">← Home</a>
    </div>
    <div style="height:40px"></div>
  `);

  return $.html();
}

module.exports = async (req, res) => {
  const targetUrl = req.query.url;

  if (!targetUrl) {
    return res.status(400).send('Missing ?url= parameter');
  }

  let parsedUrl;
  try {
    parsedUrl = new URL(targetUrl);
    if (!['http:', 'https:'].includes(parsedUrl.protocol)) {
      return res.status(400).send('Only http/https URLs are supported');
    }
  } catch {
    return res.status(400).send('Invalid URL');
  }

  try {
    const response = await fetch(targetUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0 Safari/537.36',
        'Accept': req.headers['accept'] || 'text/html,*/*',
        'Accept-Language': 'en-US,en;q=0.9',
      },
      redirect: 'follow',
    });

    const contentType = response.headers.get('content-type') || '';

    if (contentType.includes('text/html')) {
      const html = await response.text();
      const rewritten = rewriteHtml(html, response.url);
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      return res.send(rewritten);
    }

    if (contentType.includes('text/css')) {
      let css = await response.text();
      css = css.replace(/url\(['"]?([^'")]+)['"]?\)/g, (match, url) => {
        if (url.startsWith('data:') || url.startsWith('#')) return match;
        const absolute = resolveUrl(targetUrl, url);
        return absolute.startsWith('http')
          ? `url("/api/proxy?url=${encodeURIComponent(absolute)}")`
          : match;
      });
      res.setHeader('Content-Type', contentType);
      return res.send(css);
    }

    // Pass through binary assets
    const buffer = await response.arrayBuffer();
    res.setHeader('Content-Type', contentType);
    res.send(Buffer.from(buffer));
  } catch (err) {
    res.status(502).send(`
      <!DOCTYPE html><html><body style="font-family:sans-serif;padding:40px;color:#333;background:#f9f9f9">
        <h2>Proxy Error</h2>
        <p style="color:#c00">${err.message}</p>
        <a href="/">← Back to home</a>
      </body></html>
    `);
  }
};
