export type HtmlPalette = {
  page: string
  surface: string
  primary: string
  heading: string
  body: string
  link: string
  border: string
  headerText: string
  footer: string
  headingFont: string
  bodyFont: string
  h1Size: number
  h2Size: number
  h3Size: number
  bodySize: number
  tableHeader: string
  tableHeaderText: string
  underlineLinks: boolean
  callouts: Record<string, { accent: string; background: string; text: string }>
}

// CSS is a separate ZIP entry; all interpolated values are validated before
// reaching this function. No remote font or script dependency is required.
export function htmlPublisherStyles(colors: HtmlPalette): string {
  return `:root{--page:${colors.page};--surface:${colors.surface};--primary:${colors.primary};--heading:${colors.heading};--body:${colors.body};--link:${colors.link};--border:${colors.border};--header-text:${colors.headerText};--footer:${colors.footer};--table-header:${colors.tableHeader};--table-header-text:${colors.tableHeaderText};--heading-font:"${colors.headingFont}",sans-serif;--body-font:"${colors.bodyFont}",sans-serif}
*{box-sizing:border-box}
body{margin:0;background:var(--page);color:var(--body);font:${colors.bodySize}px/1.6 var(--body-font)}
a{color:var(--link);text-decoration:${colors.underlineLinks ? 'underline' : 'none'}}a:focus-visible,button:focus-visible,input:focus-visible,summary:focus-visible{outline:3px solid var(--primary);outline-offset:2px}
.site-header{background:var(--primary);color:var(--header-text);padding:16px max(24px,calc((100% - var(--content-width,1200px))/2));display:flex;align-items:center;gap:16px}
.site-header.sticky{position:sticky;top:0;z-index:10}.site-header a{color:inherit;text-decoration:none}.site-header .logo{max-width:150px;max-height:42px;object-fit:contain}.site-header .logo-label{font-weight:700}.site-title{font:600 18px var(--heading-font)}
.site-footer{background:var(--footer);color:var(--header-text);padding:24px;text-align:center;margin-top:32px}
.container{max-width:var(--content-width,1200px);margin:auto;padding:24px}.body-layout{display:flex;gap:28px;align-items:flex-start}.content{min-width:0;flex:1}.sidebar{width:var(--nav-width,260px);flex-shrink:0}.sidebar a,.on-this-page a{display:block;padding:5px 8px;text-decoration:none}.sidebar a[aria-current="page"]{font-weight:700;background:var(--surface)}.on-this-page{width:var(--otp-width,220px);flex-shrink:0}
h1,h2,h3,h4{color:var(--heading);font-family:var(--heading-font);line-height:1.25}h1{font-size:${colors.h1Size}px}h2{font-size:${colors.h2Size}px;margin-top:1.8em}h3{font-size:${colors.h3Size}px}
.content img{display:block;max-width:100%;height:auto}.content figure{margin:24px 0}.content figcaption{font-size:.9rem;opacity:.8;margin-top:8px}
.content pre{overflow-x:auto;white-space:pre-wrap;background:var(--surface);padding:16px;border:1px solid var(--border)}.content blockquote{border-left:4px solid var(--primary);padding-left:16px;margin-left:0}
.content table{border-collapse:collapse;width:100%;display:block;overflow-x:auto}.content th,.content td{border:1px solid var(--border);padding:10px;text-align:left}.content th{background:var(--table-header);color:var(--table-header-text)}
.callout{background:var(--surface);border-left:4px solid var(--primary);padding:14px;margin:18px 0}
${Object.entries(colors.callouts).map(([kind, tokens]) =>
  `.callout.${kind}{background:${tokens.background};border-left-color:${tokens.accent};color:${tokens.text}}`).join('\n')}
.procedure-step{margin:8px 0}
.hero{background:var(--primary);color:var(--header-text);padding:40px max(24px,calc((100% - var(--content-width,1200px))/2))}.hero h1{color:inherit;margin:0}.hero p{margin-bottom:0}
.cards{display:grid;grid-template-columns:repeat(var(--columns,3),minmax(0,1fr));gap:16px}.card{border:1px solid var(--border);border-radius:10px;padding:18px;min-width:0;background:var(--surface)}.card a{text-decoration:none;display:block}.card .icon{font-size:1.4rem}.card h3{margin:8px 0}.card p{margin:4px 0}.card.unavailable{opacity:.7}.card small{display:block;color:var(--body)}
.topic-list{padding-left:20px}.topic-list li{margin:8px 0}.breadcrumb{padding:10px 24px;border-bottom:1px solid var(--border)}.prev-next{display:flex;justify-content:space-between;gap:20px;margin:28px 0}.note{background:var(--surface);border-left:4px solid var(--primary);padding:12px}
.search{position:relative;margin-left:auto;max-width:300px;width:100%}.search input{width:100%;padding:8px;border:1px solid var(--border);border-radius:6px}.search-results{position:absolute;top:100%;left:0;right:0;background:var(--surface);color:var(--body);z-index:12;box-shadow:0 8px 20px #0002;max-height:250px;overflow:auto}.search-results a{display:block;padding:7px 10px;color:var(--link)}.search-results:empty{display:none}
@media(max-width:800px){.body-layout{display:block}.sidebar,.on-this-page{width:auto}.sidebar{border-bottom:1px solid var(--border)}.cards{grid-template-columns:repeat(2,minmax(0,1fr))}}
@media(max-width:520px){.site-header{flex-wrap:wrap}.search{max-width:none}.cards{grid-template-columns:1fr}}
`
}