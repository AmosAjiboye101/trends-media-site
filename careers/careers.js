(() => {
  const api = 'https://trends-media-api.trendsmediaconsult.workers.dev';
  const list = document.querySelector('#job-list');
  const view = document.querySelector('#job-view');
  const params = new URLSearchParams(location.search);

  fetch(`${api}/api/careers/jobs`).then((r) => { if (!r.ok) throw new Error(); return r.json(); }).then((jobs) => {
    list.innerHTML = jobs.length ? jobs.map((job) => `<article class="career-card"><p class="eyebrow">${esc(job.department || 'Career opportunity')}</p><h3>${esc(job.title)}</h3><div class="career-meta">${[job.employment_type, job.work_arrangement, job.location].filter(Boolean).map((x) => `<span>${esc(x)}</span>`).join('')}</div><p>${esc(job.summary)}</p>${job.deadline ? `<p><strong>Apply by:</strong> ${esc(formatDate(job.deadline))}</p>` : ''}<a href="?job=${encodeURIComponent(job.slug)}#job-view">View Details &amp; Apply ↗</a></article>`).join('') : '<p class="career-empty">There are no open positions at the moment. Please check back later for future opportunities.</p>';
    const slug = params.get('job');
    if (slug) showJob(slug);
  }).catch(() => { list.innerHTML = '<p class="career-empty">Open positions could not be loaded right now. Please try again later.</p>'; });

  async function showJob(slug) {
    try {
      const response = await fetch(`${api}/api/careers/jobs/${encodeURIComponent(slug)}`);
      if (!response.ok) throw new Error();
      const job = await response.json();
      document.title = `${job.title} | Careers at Trends Media Consult`;
      const description = document.querySelector('meta[name="description"]');
      if (description && job.summary) description.content = job.summary.slice(0, 300);
      view.innerHTML = `<article class="career-detail"><a class="career-back" href="/careers/#open-positions">← All open positions</a><p class="eyebrow">${esc(job.department || 'Career opportunity')}</p><h1>${esc(job.title)}</h1><div class="career-meta">${[job.employment_type, job.work_arrangement, job.location].filter(Boolean).map((x) => `<span>${esc(x)}</span>`).join('')}</div>${job.deadline ? `<p><strong>Application deadline:</strong> ${esc(formatDate(job.deadline))}</p>` : ''}<h2>About the role</h2>${paragraphs(job.description)}${sectionList('Responsibilities', job.responsibilities)}${sectionList('Qualifications and experience', job.qualifications)}${sectionList('Preferred skills', job.preferred_skills)}<a class="careers-action" href="#application-form" aria-controls="application-form">Apply Now</a></article><section class="application-panel" id="application-form"><p class="eyebrow"><span class="eyebrow-line"></span>Apply now</p><h2>Application form</h2><p>Applying for: <strong>${esc(job.title)}</strong></p><form class="application-form" id="apply-form" enctype="multipart/form-data" novalidate><input type="hidden" name="job_id" value="${Number(job.id)}"><label>Full name *<input name="full_name" autocomplete="name" maxlength="120" required></label><label>Email address *<input type="email" name="email" autocomplete="email" maxlength="254" required></label><label>Phone number *<input type="tel" name="phone" autocomplete="tel" minlength="7" maxlength="30" pattern="[+0-9() .-]{7,30}" required></label><label>CV / resume (PDF, max 5 MB) *<input type="file" name="cv" accept=".pdf,application/pdf" required></label><label class="full">Cover letter or short statement (optional)<textarea name="cover_letter" maxlength="10000"></textarea></label><label>Relevant experience (optional)<textarea name="experience" maxlength="3000"></textarea></label><label>Portfolio or LinkedIn URL (optional)<input type="url" name="portfolio_url" maxlength="500" placeholder="https://"></label><label class="honeypot" aria-hidden="true">Leave this field empty<input name="website" tabindex="-1" autocomplete="off"></label><p class="privacy-note full">Your information and CV will be used to assess your application and handled in accordance with our applicable privacy policy.</p><div class="full" id="application-message" role="status" aria-live="polite"></div><button class="full" type="submit">Submit application</button></form></section>`;
      document.querySelector('#open-positions').hidden = true;
      const form = document.querySelector('#apply-form');
      form.addEventListener('submit', submitApplication);
    } catch { view.innerHTML = '<p class="career-empty">This position is no longer open or could not be found. <a href="/careers/">Browse current opportunities</a>.</p>'; }
  }

  async function submitApplication(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const file = form.elements.cv.files[0];
    const message = form.querySelector('#application-message');
    if (!form.reportValidity()) return;
    if (!file || file.type !== 'application/pdf' || !file.name.toLowerCase().endsWith('.pdf')) { message.textContent = 'Please choose a PDF CV or resume.'; return; }
    if (file.size > 5 * 1024 * 1024) { message.textContent = 'Your PDF must be 5 MB or smaller.'; return; }
    const button = form.querySelector('button[type="submit"]');
    button.disabled = true; button.textContent = 'Submitting…'; message.textContent = '';
    try {
      const response = await fetch(`${api}/api/careers/applications`, { method: 'POST', body: new FormData(form) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Your application could not be submitted. Please try again.');
      form.innerHTML = '<p class="career-message full">Thank you for applying to Trends Media Consult. Your application has been received successfully. Our team will review your application and contact you if your qualifications match our requirements.</p>';
    } catch (error) { message.textContent = error.message; button.disabled = false; button.textContent = 'Submit application'; }
  }

  function sectionList(title, value) { if (!value) return ''; const items = value.split(/\r?\n/).map((x) => x.trim()).filter(Boolean); return `<h2>${title}</h2><ul>${items.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>`; }
  function paragraphs(value) { return String(value || '').split(/\r?\n\s*\r?\n/).map((x) => x.trim()).filter(Boolean).map((x) => `<p>${esc(x).replace(/\r?\n/g, '<br>')}</p>`).join(''); }
  function formatDate(value) { const d = new Date(`${value}T00:00:00`); return Number.isNaN(d.getTime()) ? value : d.toLocaleDateString('en-NG', {day:'numeric',month:'long',year:'numeric'}); }
  function esc(value) { return String(value || '').replace(/[&<>"']/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
})();
