export function escapeHtml(value: unknown): string {
  if (value === null || value === undefined) return "";
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

/** Tagged template that escapes every interpolation. Use html.raw for trusted fragments. */
export function html(strings: TemplateStringsArray, ...values: unknown[]): string {
  return strings.reduce((out, chunk, index) => {
    if (index === 0) return chunk;
    const value = values[index - 1];
    const rendered = Array.isArray(value)
      ? value.map((item) => (item instanceof Raw ? item.value : escapeHtml(item))).join("")
      : value instanceof Raw
        ? value.value
        : escapeHtml(value);
    return out + rendered + chunk;
  }, "");
}

class Raw {
  readonly value: string;

  constructor(value: string) {
    this.value = value;
  }
}

/** Marks an already-escaped fragment as safe to embed. */
export function raw(value: string): Raw {
  return new Raw(value);
}

const STYLES = `
:root {
  color-scheme: light dark;
  --bg: #f6f7f9; --panel: #ffffff; --border: #d9dde3; --text: #14181d;
  --muted: #5d6773; --accent: #2f6feb; --accent-text: #ffffff;
  --danger: #c23434; --ok: #1e7a44; --warn: #9a6a00;
}
@media (prefers-color-scheme: dark) {
  :root {
    --bg: #14181d; --panel: #1c2229; --border: #303a45; --text: #e8ecf1;
    --muted: #97a3b1; --accent: #4c8dff; --accent-text: #08111f;
    --danger: #ff7a7a; --ok: #5fd18d; --warn: #e0b050;
  }
}
* { box-sizing: border-box; }
body {
  margin: 0; padding: 0 1rem 4rem;
  font: 15px/1.5 system-ui, -apple-system, "Segoe UI", sans-serif;
  background: var(--bg); color: var(--text);
}
.wrap { max-width: 68rem; margin: 0 auto; }
header.top {
  display: flex; align-items: baseline; gap: 1rem;
  padding: 1.25rem 0; border-bottom: 1px solid var(--border); margin-bottom: 1.5rem;
}
header.top h1 { font-size: 1.15rem; margin: 0; letter-spacing: -0.01em; }
header.top a { color: var(--muted); text-decoration: none; }
header.top a:hover { color: var(--text); }
h2 { font-size: 1rem; margin: 0 0 .75rem; letter-spacing: -0.01em; }
h3 { font-size: .875rem; margin: 1.25rem 0 .5rem; color: var(--muted); font-weight: 600; }
section.panel {
  background: var(--panel); border: 1px solid var(--border);
  border-radius: 10px; padding: 1.25rem; margin-bottom: 1.25rem;
}
table { width: 100%; border-collapse: collapse; }
th, td { text-align: left; padding: .5rem .5rem; border-bottom: 1px solid var(--border); vertical-align: middle; }
th { font-size: .75rem; text-transform: uppercase; letter-spacing: .04em; color: var(--muted); font-weight: 600; }
tr:last-child td { border-bottom: none; }
td.right, th.right { text-align: right; white-space: nowrap; }
input[type=text], input[type=url], input[type=password], select, textarea {
  width: 100%; padding: .45rem .6rem; border: 1px solid var(--border);
  border-radius: 6px; background: var(--bg); color: var(--text); font: inherit;
}
textarea { min-height: 9rem; font-family: ui-monospace, Menlo, Consolas, monospace; font-size: .8rem; }
label { display: block; font-size: .8rem; color: var(--muted); margin-bottom: .9rem; }
label > span { display: block; margin-bottom: .25rem; }
button, .btn {
  font: inherit; padding: .45rem .8rem; border-radius: 6px; cursor: pointer;
  border: 1px solid var(--border); background: var(--panel); color: var(--text);
  text-decoration: none; display: inline-block;
}
button:hover, .btn:hover { border-color: var(--accent); }
button.primary { background: var(--accent); border-color: var(--accent); color: var(--accent-text); }
button.danger, .btn.danger { color: var(--danger); }
button.link { border: none; background: none; padding: .2rem .35rem; color: var(--muted); }
button.link:hover { color: var(--text); }
.row { display: flex; gap: .6rem; flex-wrap: wrap; align-items: flex-end; }
.row > * { flex: 1 1 12rem; }
.row > .narrow { flex: 0 0 9rem; }
.row > .action { flex: 0 0 auto; }
.grid2 { display: grid; grid-template-columns: repeat(auto-fit, minmax(16rem, 1fr)); gap: 0 1rem; }
.muted { color: var(--muted); }
.small { font-size: .8rem; }
code, .mono { font-family: ui-monospace, Menlo, Consolas, monospace; font-size: .8rem; }
.url {
  display: block; width: 100%; padding: .5rem .6rem; border: 1px solid var(--border);
  border-radius: 6px; background: var(--bg); word-break: break-all;
}
.badge {
  display: inline-block; padding: .05rem .4rem; border-radius: 999px;
  font-size: .7rem; border: 1px solid var(--border); color: var(--muted);
}
.badge.ok { color: var(--ok); border-color: currentColor; }
.badge.dead { color: var(--danger); border-color: currentColor; }
.badge.warn { color: var(--warn); border-color: currentColor; }
.flash { padding: .7rem .9rem; border-radius: 8px; margin-bottom: 1rem; border: 1px solid; }
.flash.ok { color: var(--ok); border-color: currentColor; }
.flash.err { color: var(--danger); border-color: currentColor; }
.install { display: flex; gap: 1.25rem; flex-wrap: wrap; align-items: flex-start; }
.install .qr { flex: 0 0 auto; line-height: 0; background: #fff; padding: .5rem; border-radius: 8px; }
.install .details { flex: 1 1 22rem; min-width: 0; }
.logo-thumb { width: 28px; height: 28px; object-fit: contain; border-radius: 4px; background: var(--bg); }
.inline { display: inline; }
ul.plain { list-style: none; padding: 0; margin: .3rem 0 0; }
ul.plain li { padding: .15rem 0; }
`;

export interface LayoutOptions {
  title: string;
  body: string;
  message?: string | null;
  error?: string | null;
  breadcrumb?: string | null;
}

export function layout(options: LayoutOptions): string {
  const flash = [
    options.error ? html`<div class="flash err">${options.error}</div>` : "",
    options.message ? html`<div class="flash ok">${options.message}</div>` : "",
  ].join("");

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>${escapeHtml(options.title)}</title>
<style>${STYLES}</style>
</head>
<body>
<div class="wrap">
<header class="top">
  <h1><a href="/" style="color:inherit">NuvioM3U</a></h1>
  ${options.breadcrumb ? html`<span class="muted small">${options.breadcrumb}</span>` : ""}
</header>
${flash}
${options.body}
</div>
</body>
</html>`;
}
