(() => {
  const base = (window.CMC_API_BASE_URL || '').replace(/\/$/, '');
  const slug = new URLSearchParams(location.search).get('slug');
  const root = document.querySelector('#article-content');
  if (!slug) { root.innerHTML = '<h1>Article not found</h1><a href="index.html">Back to the blog</a>'; return; }
  fetch(`${base}/api/blog/articles/${encodeURIComponent(slug)}`).then((r) => { if (!r.ok) throw new Error(); return r.json(); }).then((a) => {
    document.title = `${a.seo_title || a.title} | Trends Media Consult`;
    setMeta('description', a.meta_description || a.excerpt); setMeta('og:title', a.seo_title || a.title, 'property'); setMeta('og:description', a.meta_description || a.excerpt, 'property');
    setMeta('og:type', 'article', 'property'); if (a.social_image || a.cover_image) setMeta('og:image', a.social_image || a.cover_image, 'property');
    setMeta('twitter:card', 'summary_large_image');
    let canonical = document.querySelector('link[rel="canonical"]'); if (!canonical) { canonical = document.createElement('link'); canonical.rel = 'canonical'; document.head.append(canonical); }
    canonical.href = a.canonical_url || location.href;
    setMeta('twitter:title', a.seo_title || a.title); setMeta('twitter:description', a.meta_description || a.excerpt);
    root.innerHTML = `<a class="article-back" href="index.html">← All articles</a><header class="article-header"><p class="eyebrow">${esc(a.author || 'Trends Media Consult')}</p><h1>${esc(a.title)}</h1><time datetime="${new Date(a.published_at).toISOString()}">${new Date(a.published_at).toLocaleDateString('en', {year:'numeric',month:'long',day:'numeric'})}</time>${a.updated_at && a.updated_at !== a.published_at ? `<p class="article-updated">Updated ${new Date(a.updated_at).toLocaleDateString('en', {year:'numeric',month:'long',day:'numeric'})}</p>` : ''}</header>${a.cover_image ? `<img class="article-featured" src="${esc(a.cover_image)}" alt="${esc(a.cover_alt || a.title)}">` : ''}<div class="article-body">${a.body}</div><script type="application/ld+json">${JSON.stringify({'@context':'https://schema.org','@type':'BlogPosting',headline:a.title,description:a.meta_description||a.excerpt,datePublished:new Date(a.published_at).toISOString(),dateModified:new Date(a.updated_at).toISOString(),image:a.cover_image||undefined,author:a.author?{'@type':'Person',name:a.author}:{'@type':'Organization',name:'Trends Media Consult'},mainEntityOfPage:location.href}).replace(/</g, '\\u003c')}</script><nav class="article-share" aria-label="Share article"><span>Share this article</span> <a target="_blank" rel="noopener" href="https://www.linkedin.com/sharing/share-offsite/?url=${encodeURIComponent(location.href)}">LinkedIn ↗</a> <a target="_blank" rel="noopener" href="https://wa.me/?text=${encodeURIComponent(a.title+' '+location.href)}">WhatsApp ↗</a></nav><a class="article-back" href="index.html">← Back to the blog</a>`;
  }).catch(() => { root.innerHTML = '<h1>Article unavailable</h1><p>This article may have been unpublished or removed.</p><a href="index.html">Back to the blog</a>'; });
  function setMeta(key, value, attribute = 'name') { let m = document.querySelector(`meta[${attribute}="${key}"]`); if (!m) { m = document.createElement('meta'); m.setAttribute(attribute,key); document.head.append(m); } m.content = value || ''; }
  function esc(value) { return String(value || '').replace(/[&<>"']/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
})();
