const express = require('express');
const fetch = require('node-fetch');
const cors = require('cors');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;
const APP_PASSWORD = process.env.APP_PASSWORD || 'changeme';

app.use(cors());
app.use(express.json());

// ── PASSWORD CHECK ENDPOINT ───────────────────────────────────────────────────
app.post('/auth', (req, res) => {
  const { password } = req.body;
  if (password === APP_PASSWORD) {
    res.json({ ok: true });
  } else {
    res.status(401).json({ ok: false });
  }
});

// ── SERVE LOGIN PAGE FOR ROOT ─────────────────────────────────────────────────
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'login.html'));
});

// ── SERVE APP (protected by password token in URL) ────────────────────────────
app.get('/app', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.use(express.static(path.join(__dirname, 'public')));

// ── SCRAPE ENDPOINT ──────────────────────────────────────────────────────────
app.get('/scrape', async (req, res) => {
  const { domain } = req.query;
  if (!domain) return res.status(400).json({ error: 'domain required' });

  const clean = domain.toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '');
  const url = `https://${clean}`;

  let html = '';
  let ok = false;

  try {
    const response = await fetch(url, {
      timeout: 15000,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.5',
        'Accept-Encoding': 'gzip, deflate, br',
        'Connection': 'keep-alive',
        'Upgrade-Insecure-Requests': '1'
      }
    });
    html = await response.text();
    ok = html.length > 500;
  } catch (e) {
    return res.json({ domain: clean, ok: false, error: e.message, ...emptySignals(clean) });
  }

  const result = analyzeHTML(clean, html, ok);
  res.json(result);
});

// ── ANALYZE HTML ─────────────────────────────────────────────────────────────
function analyzeHTML(domain, html, ok) {
  const lo = html.toLowerCase();

  const titleM = html.match(/<title[^>]*>([^<]+)<\/title>/i);
  const title = titleM ? titleM[1].trim() : '';

  const descM = html.match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']{10,}?)["']/i)
    || html.match(/<meta[^>]+content=["']([^"']{10,}?)["'][^>]+name=["']description["']/i);
  const desc = descM ? descM[1].trim() : '';

  const h1s = (html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/gi) || [])
    .map(h => h.replace(/<[^>]+>/g, '').trim()).filter(Boolean);

  const schemaTypes = (html.match(/"@type"\s*:\s*"([^"]+)"/g) || [])
    .map(m => { const t = m.match(/"([^"]+)"$/); return t ? t[1] : ''; })
    .filter(Boolean);

  const imgs = html.match(/<img[^>]+>/gi) || [];
  const imgsAlt = imgs.filter(i => /alt=["'][^"']{2,}["']/.test(i)).length;
  const imgAltPct = imgs.length > 0 ? Math.round(imgsAlt / imgs.length * 100) : 100;

  const plainText = html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  const wc = plainText.split(' ').filter(w => w.length > 2).length;

  const s = {
    hasTitle: title.length > 0,
    titleLen: title.length,
    titleOk: title.length >= 30 && title.length <= 65,
    hasDesc: desc.length > 0,
    descOk: desc.length >= 100 && desc.length <= 160,
    h1Count: h1s.length,
    h1Ok: h1s.length === 1,
    h1Text: h1s.join(' | ').slice(0, 200),
    hasCanonical: lo.includes('rel="canonical"') || lo.includes("rel='canonical'"),
    hasSchema: lo.includes('application/ld+json') || lo.includes('schema.org'),
    schemaTypes: [...new Set(schemaTypes)].slice(0, 6),
    imgAltPct,
    imgCount: imgs.length,
    hasViewport: lo.includes('name="viewport"') || lo.includes("name='viewport'"),
    hasLazy: lo.includes('loading="lazy"') || lo.includes("loading='lazy'"),
    hasCDN: /rocketcdn|cloudfront|cloudflare|fastly|cdn\.|bunnycdn/.test(lo),
    cms: lo.includes('/wp-content/') ? 'WordPress'
       : (lo.includes('wixsite') || lo.includes('wix.com/')) ? 'Wix'
       : lo.includes('squarespace') ? 'Squarespace'
       : lo.includes('webflow') ? 'Webflow'
       : lo.includes('shopify') ? 'Shopify'
       : '—',
    hasGA: lo.includes('google-analytics') || lo.includes('gtag(') || /g-[a-z0-9]+/i.test(html),
    hasGTM: lo.includes('googletagmanager') || lo.includes('gtm.js'),
    hasFBPixel: lo.includes('fbq(') || lo.includes('facebook.net/en_US/fbevents'),
    hasCalendly: lo.includes('calendly'),
    hasAcuity: lo.includes('acuityscheduling'),
    hasZocdoc: lo.includes('zocdoc'),
    hasChat: lo.includes('tawk.to') || lo.includes('tidio') || lo.includes('crisp.chat') || lo.includes('drift.com') || lo.includes('intercom'),
    hasHotjar: lo.includes('hotjar'),
    hasOgTitle: lo.includes('og:title'),
    hasOgDesc: lo.includes('og:description'),
    hasOgImage: lo.includes('og:image'),
    hasPhone: /\(?\d{3}\)?[\s.\-]\d{3}[\s.\-]\d{4}/.test(html),
    hasOnlineBooking: lo.includes('book now') || lo.includes('book an appointment') || lo.includes('schedule') || lo.includes('calendly') || lo.includes('acuityscheduling'),
    hasForm: lo.includes('<form'),
    hasAddress: lo.includes('suite') || lo.includes('drive') || lo.includes('blvd') || lo.includes('street') || lo.includes('ave'),
    hasVideo: lo.includes('<video') || lo.includes('youtube.com/embed') || lo.includes('vimeo.com/video'),
    hasFAQ: lo.includes('faq') || lo.includes('frequently asked') || lo.includes('common question'),
    hasBlog: /\/blog|\/news|\/resources|\/articles/.test(lo),
    hasTestimonials: lo.includes('testimonial') || lo.includes('what parents') || lo.includes('review') || lo.includes('rated'),
    hasTeam: /\/team|\/staff|\/therapist|\/about/.test(lo),
    hasTeletherapy: lo.includes('teletherapy') || lo.includes('telehealth') || lo.includes('virtual therapy') || lo.includes('online therapy'),
    hasInsurance: lo.includes('insurance') || lo.includes('medicaid') || lo.includes('aetna') || lo.includes('humana') || lo.includes('tricare'),
    hasAccepting: lo.includes('accepting new') || lo.includes('new patient') || lo.includes('no waiting') || lo.includes('no waitlist') || lo.includes('currently accepting'),
    hasMultilingual: lo.includes('español') || lo.includes('spanish') || lo.includes('bilingual') || lo.includes('trilingual') || lo.includes('portuguese'),
    hasFB: lo.includes('facebook.com/'),
    hasIG: lo.includes('instagram.com/'),
    hasLI: lo.includes('linkedin.com/'),
    hasYT: lo.includes('youtube.com/'),
    hasTT: lo.includes('tiktok.com/'),
    hasASHA: lo.includes('asha') || lo.includes('american speech-language'),
    hasAOTA: lo.includes('aota') || lo.includes('american occupational therapy'),
    hasAwards: lo.includes('award') || lo.includes('best of') || lo.includes('top rated') || lo.includes('voted'),
    wc, title, desc, h1s, schemaTypes: [...new Set(schemaTypes)]
  };

  function sc(checks) {
    const tot = checks.reduce((a, c) => a + c.w, 0);
    const got = checks.filter(c => c.p).reduce((a, c) => a + c.w, 0);
    return tot > 0 ? Math.round(got / tot * 100) : 0;
  }

  const seoChecks = [
    { label: 'Title tag present', p: s.hasTitle, w: 2 },
    { label: `Title length ${s.titleLen} chars (ideal 30-65)`, p: s.titleOk, w: 2 },
    { label: 'Meta description present', p: s.hasDesc, w: 2 },
    { label: `Meta desc ${desc.length} chars (ideal 100-160)`, p: s.descOk, w: 1 },
    { label: `H1 count: ${s.h1Count} (need exactly 1)`, p: s.h1Ok, w: 2 },
    { label: 'Canonical tag', p: s.hasCanonical, w: 1 },
    { label: 'Schema / structured data', p: s.hasSchema, w: 2 },
    { label: `Schema types: ${s.schemaTypes.slice(0,3).join(', ') || 'none'}`, p: s.schemaTypes.length > 0, w: 1 },
    { label: `Image alt text ${imgAltPct}% (need >60%)`, p: imgAltPct > 60, w: 1 },
    { label: 'OG Title tag', p: s.hasOgTitle, w: 1 },
    { label: 'OG Description tag', p: s.hasOgDesc, w: 1 },
    { label: 'OG Image tag', p: s.hasOgImage, w: 1 },
  ];

  const techChecks = [
    { label: 'Mobile viewport', p: s.hasViewport, w: 2 },
    { label: 'Lazy loading images', p: s.hasLazy, w: 1 },
    { label: 'CDN detected', p: s.hasCDN, w: 1 },
    { label: `CMS: ${s.cms}`, p: s.cms !== '—', w: 0 },
    { label: 'Google Analytics', p: s.hasGA, w: 2 },
    { label: 'Google Tag Manager', p: s.hasGTM, w: 1 },
    { label: 'Facebook Pixel', p: s.hasFBPixel, w: 2 },
    { label: 'Chat / live chat widget', p: s.hasChat, w: 1 },
    { label: 'Online booking tool (Calendly/Acuity)', p: s.hasCalendly || s.hasAcuity || s.hasZocdoc, w: 2 },
    { label: 'Heatmap tool (Hotjar)', p: s.hasHotjar, w: 1 },
  ];

  const contentChecks = [
    { label: `Word count ~${wc} (need 500+)`, p: wc > 500, w: 1 },
    { label: 'Video content', p: s.hasVideo, w: 1 },
    { label: 'FAQ section', p: s.hasFAQ, w: 1 },
    { label: 'Blog / Resources section', p: s.hasBlog, w: 1 },
    { label: 'Testimonials / reviews', p: s.hasTestimonials, w: 2 },
    { label: 'Team / therapist page', p: s.hasTeam, w: 1 },
    { label: 'Teletherapy offered', p: s.hasTeletherapy, w: 1 },
    { label: 'Insurance info listed', p: s.hasInsurance, w: 2 },
    { label: 'Multilingual content', p: s.hasMultilingual, w: 1 },
    { label: '"Accepting patients" signal', p: s.hasAccepting, w: 2 },
  ];

  const ctaChecks = [
    { label: 'Phone number visible', p: s.hasPhone, w: 2 },
    { label: 'Online booking / scheduling', p: s.hasOnlineBooking, w: 2 },
    { label: 'Contact form', p: s.hasForm, w: 1 },
    { label: 'Physical address listed', p: s.hasAddress, w: 1 },
  ];

  const trustChecks = [
    { label: 'Facebook page linked', p: s.hasFB, w: 1 },
    { label: 'Instagram linked', p: s.hasIG, w: 1 },
    { label: 'LinkedIn linked', p: s.hasLI, w: 1 },
    { label: 'YouTube channel', p: s.hasYT, w: 1 },
    { label: 'ASHA membership signal', p: s.hasASHA, w: 2 },
    { label: 'AOTA membership signal', p: s.hasAOTA, w: 2 },
    { label: 'Awards / recognition', p: s.hasAwards, w: 1 },
  ];

  const seo = sc(seoChecks), tech = sc(techChecks), content = sc(contentChecks);
  const cta = sc(ctaChecks), trust = sc(trustChecks);
  const overall = Math.round(seo * 0.25 + tech * 0.2 + content * 0.25 + cta * 0.2 + trust * 0.1);

  return {
    domain, title, desc, ok,
    scores: { seo, tech, content, cta, trust, overall },
    categories: {
      SEO: { score: seo, checks: seoChecks.map(c => ({ label: c.label, pass: c.p })), color: '#38bdf8' },
      Tech: { score: tech, checks: techChecks.map(c => ({ label: c.label, pass: c.p })), color: '#a78bfa' },
      Content: { score: content, checks: contentChecks.map(c => ({ label: c.label, pass: c.p })), color: '#34d399' },
      CTAs: { score: cta, checks: ctaChecks.map(c => ({ label: c.label, pass: c.p })), color: '#fbbf24' },
      Trust: { score: trust, checks: trustChecks.map(c => ({ label: c.label, pass: c.p })), color: '#f87171' },
    },
    signals: s,
    raw: `Title: ${title || '(none)'}\nMeta Desc: ${desc || '(none)'}\nH1(s): ${h1s.join(' | ') || '(none)'}\nSchema Types: ${s.schemaTypes.join(', ') || 'none'}\nCMS: ${s.cms}\nGA: ${s.hasGA} | GTM: ${s.hasGTM} | FB Pixel: ${s.hasFBPixel}\nWord Count: ~${wc}\nImg Alt Coverage: ${imgAltPct}% (${imgs.length} images)\nSocial: FB:${s.hasFB} IG:${s.hasIG} YT:${s.hasYT} LI:${s.hasLI}\nTeletherapy: ${s.hasTeletherapy} | Insurance: ${s.hasInsurance} | Multilingual: ${s.hasMultilingual}\nASHA: ${s.hasASHA} | AOTA: ${s.hasAOTA}`
  };
}

function emptySignals(domain) {
  return { title: '', desc: '', scores: { seo:0,tech:0,content:0,cta:0,trust:0,overall:0 }, categories:{}, signals:{}, raw:'Crawl failed.' };
}

app.listen(PORT, () => console.log(`Competitor Intel running on port ${PORT}`));
