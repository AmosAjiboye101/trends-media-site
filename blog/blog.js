(() => {
  const base = (window.CMC_API_BASE_URL || '').replace(/\/$/, '');
  const list = document.querySelector('#article-list');
  fetch(`${base}/api/blog/articles`).then((response) => { if (!response.ok) throw new Error(); return response.json(); }).then((articles) => {
    if (!articles.length) { list.innerHTML = '<p class="blog-state">New articles are on the way. Please check back soon.</p>'; return; }
    list.innerHTML = articles.map((a) => `<article class="article-card">${a.cover_image ? `<a href="article.html?slug=${encodeURIComponent(a.slug)}"><img class="article-card-image" src="${esc(a.cover_image)}" alt="${esc(a.cover_alt || a.title)}" loading="lazy"></a>` : ''}<div class="article-card-copy"><time datetime="${esc(a.published_at)}">${new Date(a.published_at).toLocaleDateString('en', {year:'numeric',month:'long',day:'numeric'})}</time><h3><a href="article.html?slug=${encodeURIComponent(a.slug)}">${esc(a.title)}</a></h3><p>${esc(a.excerpt)}</p><a class="article-read" href="article.html?slug=${encodeURIComponent(a.slug)}">Read article ↗</a></div></article>`).join('');
  }).catch(() => { list.innerHTML = '<p class="blog-state">Articles could not be loaded right now. Please try again later.</p>'; });
  function esc(value) { return String(value || '').replace(/[&<>"']/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
})();
