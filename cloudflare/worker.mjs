import bcrypt from 'bcryptjs';

const encodeBase64Url = (value) => btoa(String.fromCharCode(...new Uint8Array(value)))
  .replace(/=/g, '')
  .replace(/\+/g, '-')
  .replace(/\//g, '_');

const decodeBase64Url = (value) => {
  const base64 = value.replace(/-/g, '+').replace(/_/g, '/');
  return Uint8Array.from(atob(base64.padEnd(Math.ceil(base64.length / 4) * 4, '=')), (character) => character.charCodeAt(0));
};

const json = (value, status = 200) => new Response(JSON.stringify(value), {
  status,
  headers: { 'Content-Type': 'application/json; charset=utf-8' }
});

const escapeHtml = (value) => String(value ?? '').replace(/[&<>"']/g, (character) => ({
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;'
})[character]);

const getCookie = (request, name) => {
  const cookie = request.headers.get('Cookie') || '';
  const item = cookie.split(';').map((part) => part.trim()).find((part) => part.startsWith(`${name}=`));
  return item ? item.slice(name.length + 1) : '';
};

async function sessionKey(secret) {
  return crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
}

async function createSession(username, secret) {
  const payload = encodeBase64Url(new TextEncoder().encode(JSON.stringify({
    username,
    expiresAt: Date.now() + 8 * 60 * 60 * 1000
  })));
  const signature = await crypto.subtle.sign('HMAC', await sessionKey(secret), new TextEncoder().encode(payload));
  return `${payload}.${encodeBase64Url(signature)}`;
}

async function readSession(request, secret) {
  const token = getCookie(request, 'cmc_admin');
  const [payload, signature, extra] = token.split('.');
  if (!payload || !signature || extra || !secret) return null;
  try {
    const valid = await crypto.subtle.verify(
      'HMAC',
      await sessionKey(secret),
      decodeBase64Url(signature),
      new TextEncoder().encode(payload)
    );
    if (!valid) return null;
    const session = JSON.parse(new TextDecoder().decode(decodeBase64Url(payload)));
    return session.expiresAt > Date.now() ? session : null;
  } catch {
    return null;
  }
}

const setSessionCookie = (token) => `cmc_admin=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=28800`;
const clearSessionCookie = 'cmc_admin=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0';
const isAdmin = async (request, env) => Boolean(await readSession(request, env.SESSION_SECRET));
const getRows = async (database, query, ...values) => (await database.prepare(query).bind(...values).all()).results || [];
const getOne = (database, query, ...values) => database.prepare(query).bind(...values).first();

async function ensureAdmin(env) {
  if (!env.ADMIN_USERNAME || !env.ADMIN_PASSWORD) return;
  const existing = await getOne(env.DB, 'SELECT id FROM users WHERE username = ?', env.ADMIN_USERNAME);
  if (!existing) {
    const passwordHash = bcrypt.hashSync(env.ADMIN_PASSWORD, 10);
    await env.DB.prepare('INSERT INTO users (username, password_hash) VALUES (?, ?)')
      .bind(env.ADMIN_USERNAME, passwordHash)
      .run();
  }
}

async function readBody(request) {
  try {
    return await request.json();
  } catch {
    return {};
  }
}

const ARTICLE_FIELDS = ['title','slug','excerpt','body','cover_image','cover_alt','author','status','published_at','seo_title','meta_description','keywords','canonical_url','social_image'];
function cleanArticle(input) {
  const a = Object.fromEntries(ARTICLE_FIELDS.map((key) => [key, String(input?.[key] ?? '').trim()]));
  a.slug = a.slug.toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 120);
  a.body = a.body.replace(/<(\/?)([a-z0-9]+)([^>]*)>/gi, (_tag, closing, name, attrs) => {
    const tag = name.toLowerCase();
    if (!['p','h2','h3','h4','ul','ol','li','blockquote','strong','em','a','img','br','video','source'].includes(tag)) return '';
    if (closing) return ['img','br','source'].includes(tag) ? '' : `</${tag}>`;
    if (tag === 'a' || tag === 'img' || tag === 'video' || tag === 'source') {
      if (tag === 'video' && !attrs.includes('src=')) return '<video controls>';
      const key = tag === 'a' ? 'href' : 'src';
      const found = attrs.match(new RegExp(`${key}\\s*=\\s*(["'])(.*?)\\1`, 'i'));
      const value = found?.[2] || '';
      const allowed = tag === 'a' ? /^(https?:\/\/|mailto:|\/|#)/i.test(value) : /^(https?:\/\/|\/)/i.test(value);
      if (!allowed) return tag === 'a' ? '<a>' : '';
      const safeValue = value.replace(/[&<>"']/g, (c) => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
      if (tag === 'a') return `<a href="${safeValue}" rel="noopener noreferrer">`;
      if (tag === 'source') return `<source src="${safeValue}">`;
      if (tag === 'video') return `<video src="${safeValue}" controls preload="metadata">`;
      const alt = attrs.match(/alt\s*=\s*(["'])(.*?)\1/i)?.[2] || '';
      return `<img src="${safeValue}" alt="${alt.replace(/[&<>"']/g, (c) => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]))}">`;
    }
    return `<${tag}>`;
  });
  if (a.status !== 'published') a.status = 'draft';
  if (!a.published_at && a.status === 'published') a.published_at = new Date().toISOString();
  return a;
}

const JOB_FIELDS = ['title','slug','department','location','employment_type','work_arrangement','summary','description','responsibilities','qualifications','preferred_skills','deadline','status','published_at'];
const APPLICATION_STATUSES = ['New','Under Review','Shortlisted','Rejected','Hired'];
function lagosTimestamp(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Lagos', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }).formatToParts(date);
  const values = Object.fromEntries(parts.map(({ type, value }) => [type, value]));
  return `${values.year}-${values.month}-${values.day}T${values.hour}:${values.minute}:${values.second}+01:00`;
}
function cleanJob(input) {
  const job = Object.fromEntries(JOB_FIELDS.map((key) => [key, String(input?.[key] ?? '').trim()]));
  job.slug = job.slug.toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 120);
  job.status = ['draft','published','closed'].includes(job.status) ? job.status : 'draft';
  if (job.deadline && !/^\d{4}-\d{2}-\d{2}$/.test(job.deadline)) job.deadline = '';
  const publishedDate = job.published_at ? new Date(job.published_at) : null;
  job.published_at = job.status === 'published'
    ? (publishedDate && !Number.isNaN(publishedDate.getTime()) ? lagosTimestamp(publishedDate) : lagosTimestamp())
    : (publishedDate && !Number.isNaN(publishedDate.getTime()) ? lagosTimestamp(publishedDate) : '');
  return job;
}
async function sendCandidateUpdate(env, application, update) {
  if (!env.RESEND_API_KEY || !env.CAREERS_FROM_EMAIL) return { sent: false, reason: 'Email is not configured yet. Add RESEND_API_KEY and CAREERS_FROM_EMAIL to the Worker.' };
  const safeName = String(application.full_name || 'Applicant');
  const statuses = {
    'New': 'Your application has been received and is being processed.',
    'Under Review': 'Your application is currently under review.',
    'Shortlisted': 'You have been shortlisted for the next stage of our recruitment process.',
    'Rejected': 'After careful consideration, we will not be moving forward with your application at this time.',
    'Hired': 'We are pleased to let you know that we would like to move forward with your application.'
  };
  const blocks = [statuses[update.status] || 'There is an update about your application.'];
  if (update.candidate_update) blocks.push(update.candidate_update);
  if (update.interview_at) blocks.push(`Interview time (Lagos, WAT): ${update.interview_at.replace('T', ' ').replace('+01:00', ' WAT')}`);
  if (update.interview_location) blocks.push(`Interview location: ${update.interview_location}`);
  if (update.interview_link) blocks.push(`Interview link: ${update.interview_link}`);
  const html = `<p>Dear ${escapeHtml(safeName)},</p><p>${escapeHtml(blocks[0])}</p>${blocks.slice(1).map((block) => `<p>${escapeHtml(block)}</p>`).join('')}<p>Position: ${escapeHtml(application.position_title)}</p><p>Regards,<br>Trends Media Consult Recruitment Team</p>`;
  const text = `Dear ${safeName},\n\n${blocks.join('\n\n')}\n\nPosition: ${application.position_title}\n\nRegards,\nTrends Media Consult Recruitment Team`;
  let response;
  try {
    response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: env.CAREERS_FROM_EMAIL, to: [application.email], subject: `Update on your ${application.position_title} application`, html, text })
    });
  } catch {
    return { sent: false, reason: 'The email service could not be reached. Your review details were saved; please try sending again.' };
  }
  if (!response.ok) return { sent: false, reason: 'The email service rejected the message. Check the sender address and email service settings, then try again.' };
  return { sent: true };
}
async function verifyPayment(env, reference) {
  if (!env.PAYSTACK_SECRET_KEY || !reference) return { ok: false, error: 'Payment verification is not configured.' };
  const response = await fetch(`https://api.paystack.co/transaction/verify/${encodeURIComponent(reference)}`, { headers: { Authorization: `Bearer ${env.PAYSTACK_SECRET_KEY}` } });
  const result = await response.json();
  if (!response.ok || !result.status || !result.data) return { ok: false, error: 'Unable to verify the payment.' };
  const expected = await getOne(env.DB, 'SELECT amount, email FROM payments WHERE reference = ?', reference);
  if (!expected) return { ok: false, error: 'Payment reference not found.' };
  const paid = result.data.status === 'success' && result.data.currency === 'NGN' && Number(result.data.amount) === Number(expected.amount) * 100 && result.data.customer?.email?.toLowerCase() === expected.email.toLowerCase();
  const status = paid ? 'paid' : ['failed','abandoned'].includes(result.data.status) ? 'failed' : 'pending';
  await env.DB.prepare("UPDATE payments SET status = ? WHERE reference = ? AND status <> 'paid'").bind(status, reference).run();
  return { ok: paid, status: paid ? 'success' : result.data.status };
}

async function handleApi(request, env, url) {
  const { pathname } = url;
  const method = request.method;

  if (pathname.startsWith('/api/admin/media') && method === 'POST') {
    if (!await isAdmin(request, env)) return json({ error: 'Authentication required.' }, 401);
    if (!env.MEDIA) return json({ error: 'Persistent media storage is not configured. Bind an R2 bucket as MEDIA.' }, 503);
    const form = await request.formData();
    const file = form.get('file');
    const allowed = new Map([['image/jpeg','jpg'],['image/png','png'],['image/webp','webp'],['image/gif','gif'],['video/mp4','mp4'],['video/webm','webm']]);
    if (!file || typeof file.arrayBuffer !== 'function' || !allowed.has(file.type)) return json({ error: 'Upload a JPG, PNG, WebP, GIF, MP4, or WebM file.' }, 400);
    const maxBytes = file.type.startsWith('video/') ? 15 * 1024 * 1024 : 8 * 1024 * 1024;
    if (file.size > maxBytes) return json({ error: file.type.startsWith('video/') ? 'Videos must be 15 MB or smaller.' : 'Images must be 8 MB or smaller.' }, 413);
    const bytes = new Uint8Array(await file.arrayBuffer());
    const starts = (...values) => values.every((value, index) => bytes[index] === value);
    const magicMatches = file.type === 'image/jpeg' ? starts(0xff,0xd8,0xff)
      : file.type === 'image/png' ? starts(0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a)
        : file.type === 'image/webp' ? String.fromCharCode(...bytes.slice(0,4)) === 'RIFF' && String.fromCharCode(...bytes.slice(8,12)) === 'WEBP'
          : file.type === 'image/gif' ? ['GIF87a','GIF89a'].includes(String.fromCharCode(...bytes.slice(0,6)))
            : file.type === 'video/mp4' ? String.fromCharCode(...bytes.slice(4,8)) === 'ftyp'
              : starts(0x1a,0x45,0xdf,0xa3);
    if (!magicMatches) return json({ error: 'The file contents do not match the selected media type.' }, 400);
    const key = `blog/${crypto.randomUUID()}.${allowed.get(file.type)}`;
    await env.MEDIA.put(key, bytes, { httpMetadata: { contentType: file.type, cacheControl: 'public, max-age=31536000, immutable' } });
    return json({ url: `${url.origin}/media/${key}`, type: file.type, name: file.name }, 201);
  }

  if (pathname === '/api/careers/jobs' && method === 'GET') {
    return json(await getRows(env.DB, "SELECT id,title,slug,department,location,employment_type,work_arrangement,summary,description,responsibilities,qualifications,preferred_skills,deadline,published_at FROM career_jobs WHERE status = 'published' AND published_at IS NOT NULL AND datetime(published_at) <= CURRENT_TIMESTAMP AND (deadline IS NULL OR deadline = '' OR date(deadline) >= date('now', '+1 hour')) ORDER BY published_at DESC, id DESC"));
  }
  if (pathname.startsWith('/api/careers/jobs/') && method === 'GET') {
    const slug = decodeURIComponent(pathname.slice('/api/careers/jobs/'.length));
    const job = await getOne(env.DB, "SELECT id,title,slug,department,location,employment_type,work_arrangement,summary,description,responsibilities,qualifications,preferred_skills,deadline,published_at FROM career_jobs WHERE slug = ? AND status = 'published' AND published_at IS NOT NULL AND datetime(published_at) <= CURRENT_TIMESTAMP AND (deadline IS NULL OR deadline = '' OR date(deadline) >= date('now', '+1 hour'))", slug);
    return job ? json(job) : json({ error: 'Position not found.' }, 404);
  }
  if (pathname === '/api/careers/applications' && method === 'POST') {
    const contentLength = Number(request.headers.get('content-length') || 0);
    if (contentLength > 5 * 1024 * 1024 + 100 * 1024) return json({ error: 'The application is too large. CVs must be 5 MB or smaller.' }, 413);
    const origin = request.headers.get('Origin');
    const allowedOrigins = (env.FRONTEND_ORIGIN || 'https://trendsmediaconsult.com,https://www.trendsmediaconsult.com').split(',').map((item) => item.trim());
    if (origin && !allowedOrigins.includes(origin)) return json({ error: 'Application could not be submitted from this website.' }, 403);
    let form;
    try { form = await request.formData(); } catch { return json({ error: 'Please complete the application form and attach a PDF CV.' }, 400); }
    if (String(form.get('website') || '').trim()) return json({ ok: true }, 201);
    const jobId = Number(form.get('job_id'));
    const fullName = String(form.get('full_name') || '').trim().slice(0, 120);
    const email = String(form.get('email') || '').trim().toLowerCase().slice(0, 254);
    const phone = String(form.get('phone') || '').trim().slice(0, 30);
    const coverLetter = String(form.get('cover_letter') || '').trim().slice(0, 10000);
    const experience = String(form.get('experience') || '').trim().slice(0, 3000);
    const portfolioUrl = String(form.get('portfolio_url') || '').trim().slice(0, 500);
    const cv = form.get('cv');
    const phoneDigits = phone.replace(/\D/g, '').length;
    if (!Number.isInteger(jobId) || jobId < 1 || !fullName || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || !/^[+0-9() .-]{7,30}$/.test(phone) || phoneDigits < 7 || phoneDigits > 15) {
      return json({ error: 'Enter your name, a valid email address, and a valid phone number.' }, 400);
    }
    if (!cv || typeof cv.arrayBuffer !== 'function' || cv.type !== 'application/pdf' || !String(cv.name || '').toLowerCase().endsWith('.pdf')) return json({ error: 'Upload your CV or resume as a PDF file.' }, 400);
    if (cv.size < 8 || cv.size > 5 * 1024 * 1024) return json({ error: 'The PDF must be between 8 bytes and 5 MB.' }, 413);
    if (portfolioUrl) {
      try { if (!['http:','https:'].includes(new URL(portfolioUrl).protocol)) throw new Error(); }
      catch { return json({ error: 'Enter a valid portfolio or LinkedIn URL.' }, 400); }
    }
    const job = await getOne(env.DB, "SELECT id,title FROM career_jobs WHERE id = ? AND status = 'published' AND published_at IS NOT NULL AND datetime(published_at) <= CURRENT_TIMESTAMP AND (deadline IS NULL OR deadline = '' OR date(deadline) >= date('now', '+1 hour'))", jobId);
    if (!job) return json({ error: 'This position is no longer open for applications.' }, 410);
    const duplicate = await getOne(env.DB, "SELECT id FROM career_applications WHERE job_id = ? AND lower(email) = ? AND datetime(submitted_at) >= datetime('now', '-10 minutes')", jobId, email);
    if (duplicate) return json({ error: 'An application for this position was already received recently.' }, 409);
    if (!env.MEDIA) return json({ error: 'Application uploads are temporarily unavailable. Please try again later.' }, 503);
    const bytes = new Uint8Array(await cv.arrayBuffer());
    if (bytes[0] !== 0x25 || bytes[1] !== 0x50 || bytes[2] !== 0x44 || bytes[3] !== 0x46 || bytes[4] !== 0x2d) return json({ error: 'The uploaded file is not a valid PDF.' }, 400);
    const cvKey = `private/careers/${crypto.randomUUID()}.pdf`;
    await env.MEDIA.put(cvKey, bytes, { httpMetadata: { contentType: 'application/pdf', cacheControl: 'private, no-store' } });
    try {
      const result = await env.DB.prepare('INSERT INTO career_applications (job_id, position_title, full_name, email, phone, cover_letter, experience, portfolio_url, cv_key) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
        .bind(job.id, job.title, fullName, email, phone, coverLetter, experience, portfolioUrl, cvKey).run();
      return json({ ok: true, id: result.meta.last_row_id }, 201);
    } catch {
      await env.MEDIA.delete(cvKey);
      return json({ error: 'We could not save your application. Please try again.' }, 500);
    }
  }
  if (pathname === '/api/admin/careers/jobs' && method === 'GET') {
    if (!await isAdmin(request, env)) return json({ error: 'Authentication required.' }, 401);
    return json(await getRows(env.DB, 'SELECT * FROM career_jobs ORDER BY created_at DESC, id DESC'));
  }
  if (pathname === '/api/admin/careers/jobs' && method === 'POST') {
    if (!await isAdmin(request, env)) return json({ error: 'Authentication required.' }, 401);
    const job = cleanJob(await readBody(request));
    if (!job.title || !job.slug) return json({ error: 'Job title and slug are required.' }, 400);
    try {
      const result = await env.DB.prepare(`INSERT INTO career_jobs (${JOB_FIELDS.join(',')}) VALUES (${JOB_FIELDS.map(() => '?').join(',')})`).bind(...JOB_FIELDS.map((key) => key === 'deadline' ? job[key] || null : job[key])).run();
      return json(await getOne(env.DB, 'SELECT * FROM career_jobs WHERE id = ?', result.meta.last_row_id), 201);
    } catch { return json({ error: 'Could not save this vacancy. Check whether its slug is already in use.' }, 400); }
  }
  if (pathname.startsWith('/api/admin/careers/jobs/') && method === 'PUT') {
    if (!await isAdmin(request, env)) return json({ error: 'Authentication required.' }, 401);
    const id = Number(pathname.slice('/api/admin/careers/jobs/'.length));
    const job = cleanJob(await readBody(request));
    if (!Number.isInteger(id) || !job.title || !job.slug) return json({ error: 'Job title and slug are required.' }, 400);
    try {
      const result = await env.DB.prepare(`UPDATE career_jobs SET ${JOB_FIELDS.map((key) => `${key} = ?`).join(', ')}, updated_at = CURRENT_TIMESTAMP WHERE id = ?`).bind(...JOB_FIELDS.map((key) => key === 'deadline' ? job[key] || null : job[key]), id).run();
      return result.meta?.changes ? json(await getOne(env.DB, 'SELECT * FROM career_jobs WHERE id = ?', id)) : json({ error: 'Vacancy not found.' }, 404);
    } catch { return json({ error: 'Could not update this vacancy. Check whether its slug is already in use.' }, 400); }
  }
  if (pathname.startsWith('/api/admin/careers/jobs/') && method === 'DELETE') {
    if (!await isAdmin(request, env)) return json({ error: 'Authentication required.' }, 401);
    const id = Number(pathname.slice('/api/admin/careers/jobs/'.length));
    await env.DB.prepare('UPDATE career_applications SET job_id = NULL WHERE job_id = ?').bind(id).run();
    const result = await env.DB.prepare('DELETE FROM career_jobs WHERE id = ?').bind(id).run();
    return result.meta?.changes ? json({ ok: true }) : json({ error: 'Vacancy not found.' }, 404);
  }
  if (pathname === '/api/admin/careers/applications' && method === 'GET') {
    if (!await isAdmin(request, env)) return json({ error: 'Authentication required.' }, 401);
    const clauses = [];
    const values = [];
    const status = url.searchParams.get('status') || '';
    const jobId = url.searchParams.get('job_id') || '';
    const search = (url.searchParams.get('search') || '').trim().slice(0, 100);
    if (APPLICATION_STATUSES.includes(status)) { clauses.push('status = ?'); values.push(status); }
    if (/^\d+$/.test(jobId)) { clauses.push('job_id = ?'); values.push(Number(jobId)); }
    if (search) { clauses.push('(lower(full_name) LIKE ? OR lower(email) LIKE ?)'); values.push(`%${search.toLowerCase()}%`, `%${search.toLowerCase()}%`); }
    const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
    return json(await getRows(env.DB, `SELECT id,job_id,position_title,full_name,email,phone,cover_letter,experience,portfolio_url,status,internal_notes,candidate_update,interview_at,interview_location,interview_link,last_email_sent_at,submitted_at FROM career_applications ${where} ORDER BY submitted_at DESC LIMIT 200`, ...values));
  }
  if (pathname.startsWith('/api/admin/careers/applications/') && method === 'GET' && pathname.endsWith('/cv')) {
    if (!await isAdmin(request, env)) return json({ error: 'Authentication required.' }, 401);
    const id = Number(pathname.slice('/api/admin/careers/applications/'.length, -'/cv'.length));
    const application = await getOne(env.DB, 'SELECT id,cv_key FROM career_applications WHERE id = ?', id);
    const object = application && env.MEDIA ? await env.MEDIA.get(application.cv_key) : null;
    return object ? new Response(object.body, { headers: { 'Content-Type': 'application/pdf', 'Content-Disposition': `attachment; filename="application-${application.id}-resume.pdf"`, 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' } }) : new Response('Application document not found.', { status: 404 });
  }
  if (pathname.startsWith('/api/admin/careers/applications/') && method === 'GET') {
    if (!await isAdmin(request, env)) return json({ error: 'Authentication required.' }, 401);
    const id = Number(pathname.slice('/api/admin/careers/applications/'.length));
    const application = await getOne(env.DB, 'SELECT id,job_id,position_title,full_name,email,phone,cover_letter,experience,portfolio_url,status,internal_notes,candidate_update,interview_at,interview_location,interview_link,last_email_sent_at,submitted_at FROM career_applications WHERE id = ?', id);
    return application ? json(application) : json({ error: 'Application not found.' }, 404);
  }
  if (pathname.startsWith('/api/admin/careers/applications/') && method === 'PUT') {
    if (!await isAdmin(request, env)) return json({ error: 'Authentication required.' }, 401);
    const id = Number(pathname.slice('/api/admin/careers/applications/'.length));
    const body = await readBody(request);
    const status = APPLICATION_STATUSES.includes(body.status) ? body.status : null;
    const candidateUpdate = String(body.candidate_update || '').trim().slice(0, 3000);
    const interviewLocation = String(body.interview_location || '').trim().slice(0, 300);
    const interviewLink = String(body.interview_link || '').trim().slice(0, 500);
    let interviewAt = null;
    if (body.interview_at) {
      const parsedInterviewAt = new Date(body.interview_at);
      if (Number.isNaN(parsedInterviewAt.getTime())) return json({ error: 'Enter a valid interview date and time.' }, 400);
      interviewAt = lagosTimestamp(parsedInterviewAt);
    }
    if (interviewLink) {
      try { if (!['http:','https:'].includes(new URL(interviewLink).protocol)) throw new Error(); }
      catch { return json({ error: 'Enter a valid interview meeting link.' }, 400); }
    }
    if (!Number.isInteger(id) || !status) return json({ error: 'Choose a valid application status.' }, 400);
    const application = await getOne(env.DB, 'SELECT id,position_title,full_name,email FROM career_applications WHERE id = ?', id);
    if (!application) return json({ error: 'Application not found.' }, 404);
    await env.DB.prepare('UPDATE career_applications SET status = ?, internal_notes = ?, candidate_update = ?, interview_at = ?, interview_location = ?, interview_link = ? WHERE id = ?')
      .bind(status, String(body.internal_notes || '').trim().slice(0, 5000), candidateUpdate, interviewAt, interviewLocation, interviewLink, id).run();
    if (!body.notify_candidate) return json({ ok: true, email_sent: false });
    const delivery = await sendCandidateUpdate(env, application, { status, candidate_update: candidateUpdate, interview_at: interviewAt, interview_location: interviewLocation, interview_link: interviewLink });
    if (!delivery.sent) return json({ ok: true, email_sent: false, email_error: delivery.reason });
    await env.DB.prepare('UPDATE career_applications SET last_email_sent_at = ? WHERE id = ?').bind(lagosTimestamp(), id).run();
    return json({ ok: true, email_sent: true, last_email_sent_at: lagosTimestamp() });
  }

  if (pathname === '/api/health' && method === 'GET') {
    return json({ ok: true, service: 'cmc-admin', backend: 'cloudflare-d1' });
  }
  if (pathname === '/api/blog/articles' && method === 'GET') {
    return json(await getRows(env.DB, "SELECT * FROM articles WHERE status = 'published' AND published_at IS NOT NULL AND datetime(published_at) <= CURRENT_TIMESTAMP ORDER BY published_at DESC, id DESC"));
  }
  if (pathname.startsWith('/api/blog/articles/') && method === 'GET') {
    const slug = decodeURIComponent(pathname.slice('/api/blog/articles/'.length));
    let article = await getOne(env.DB, "SELECT * FROM articles WHERE slug = ? AND status = 'published' AND published_at IS NOT NULL AND datetime(published_at) <= CURRENT_TIMESTAMP", slug);
    if (article) {
      await env.DB.prepare('UPDATE articles SET views = views + 1 WHERE id = ?').bind(article.id).run();
      article = await getOne(env.DB, 'SELECT * FROM articles WHERE id = ?', article.id);
    }
    return article ? json(article) : json({ error: 'Article not found.' }, 404);
  }
  if (pathname === '/api/admin/articles' && method === 'GET') {
    if (!await isAdmin(request, env)) return json({ error: 'Authentication required.' }, 401);
    return json(await getRows(env.DB, 'SELECT * FROM articles ORDER BY created_at DESC, id DESC'));
  }
  if (pathname === '/api/admin/articles' && method === 'POST') {
    if (!await isAdmin(request, env)) return json({ error: 'Authentication required.' }, 401);
    const a = cleanArticle(await readBody(request));
    if (!a.title || !a.slug) return json({ error: 'Title and slug are required.' }, 400);
    try {
      const result = await env.DB.prepare(`INSERT INTO articles (${ARTICLE_FIELDS.join(',')}) VALUES (${ARTICLE_FIELDS.map(() => '?').join(',')})`).bind(...ARTICLE_FIELDS.map((key) => a[key])).run();
      return json(await getOne(env.DB, 'SELECT * FROM articles WHERE id = ?', result.meta.last_row_id), 201);
    } catch { return json({ error: 'Could not save article. The slug may already be in use.' }, 400); }
  }
  if (pathname.startsWith('/api/admin/articles/') && method === 'PUT') {
    if (!await isAdmin(request, env)) return json({ error: 'Authentication required.' }, 401);
    const id = Number(pathname.slice('/api/admin/articles/'.length));
    const a = cleanArticle(await readBody(request));
    if (!Number.isInteger(id) || !a.title || !a.slug) return json({ error: 'Title and slug are required.' }, 400);
    try {
      const result = await env.DB.prepare(`UPDATE articles SET ${ARTICLE_FIELDS.map((key) => `${key} = ?`).join(', ')}, updated_at = CURRENT_TIMESTAMP WHERE id = ?`).bind(...ARTICLE_FIELDS.map((key) => a[key]), id).run();
      return result.meta?.changes ? json(await getOne(env.DB, 'SELECT * FROM articles WHERE id = ?', id)) : json({ error: 'Article not found.' }, 404);
    } catch { return json({ error: 'Could not update article. The slug may already be in use.' }, 400); }
  }
  if (pathname.startsWith('/api/admin/articles/') && method === 'DELETE') {
    if (!await isAdmin(request, env)) return json({ error: 'Authentication required.' }, 401);
    const id = Number(pathname.slice('/api/admin/articles/'.length));
    const result = await env.DB.prepare('DELETE FROM articles WHERE id = ?').bind(id).run();
    return result.meta?.changes ? new Response(null, { status: 204 }) : json({ error: 'Article not found.' }, 404);
  }
  if (pathname.startsWith('/api/payment/verify/') && method === 'GET') {
    try {
      const result = await verifyPayment(env, decodeURIComponent(pathname.slice('/api/payment/verify/'.length)));
      return json(result, result.ok ? 200 : 402);
    } catch { return json({ ok: false, error: 'Unable to verify payment right now.' }, 502); }
  }
  if (pathname === '/api/paystack/webhook' && method === 'POST') {
    if (!env.PAYSTACK_SECRET_KEY) return json({ error: 'Webhook is not configured.' }, 503);
    const raw = await request.arrayBuffer();
    const signature = request.headers.get('x-paystack-signature') || '';
    const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(env.PAYSTACK_SECRET_KEY), { name: 'HMAC', hash: 'SHA-512' }, false, ['verify']);
    const bytes = Uint8Array.from(signature.match(/.{1,2}/g) || [], (byte) => Number.parseInt(byte, 16));
    if (!signature || !await crypto.subtle.verify('HMAC', key, bytes, raw)) return json({ error: 'Invalid signature.' }, 401);
    const event = JSON.parse(new TextDecoder().decode(raw));
    if (event.event === 'charge.success' && event.data?.reference) await verifyPayment(env, event.data.reference);
    return json({ received: true });
  }
  if (pathname === '/api/prices' && method === 'GET') {
    return json(await getRows(env.DB, 'SELECT * FROM prices ORDER BY id ASC'));
  }
  if (pathname === '/api/enquiries' && method === 'GET') {
    if (!await isAdmin(request, env)) return json({ error: 'Authentication required.' }, 401);
    return json(await getRows(env.DB, 'SELECT * FROM enquiries ORDER BY id DESC'));
  }
  if (pathname === '/api/payments' && method === 'GET') {
    if (!await isAdmin(request, env)) return json({ error: 'Authentication required.' }, 401);
    return json(await getRows(env.DB, 'SELECT * FROM payments ORDER BY id DESC'));
  }
  if (pathname === '/api/traffic' && method === 'GET') {
    if (!await isAdmin(request, env)) return json({ error: 'Authentication required.' }, 401);
    const visits = await getRows(env.DB, 'SELECT * FROM visits ORDER BY id DESC');
    const actions = await getRows(env.DB, 'SELECT * FROM actions ORDER BY id DESC');
    return json({
      totalVisits: visits.length,
      totalActions: actions.length,
      recentVisits: visits.slice(0, 10).map(({ path, created_at }) => ({ path, created_at })),
      recentActions: actions.slice(0, 20)
    });
  }
  if (pathname.startsWith('/api/prices/') && method === 'PUT') {
    if (!await isAdmin(request, env)) return json({ error: 'Authentication required.' }, 401);
    const amount = Number((await readBody(request)).amount);
    if (!Number.isInteger(amount) || amount < 0) return json({ error: 'Amount must be a non-negative whole number.' }, 400);
    const plan = decodeURIComponent(pathname.slice('/api/prices/'.length));
    const result = await env.DB.prepare('UPDATE prices SET amount = ?, updated_at = CURRENT_TIMESTAMP WHERE plan = ?')
      .bind(amount, plan)
      .run();
    if (!result.meta?.changes) return json({ error: 'Price not found.' }, 404);
    return json(await getOne(env.DB, 'SELECT * FROM prices WHERE plan = ?', plan));
  }
  if (pathname === '/api/track-visit' && method === 'POST') {
    const body = await readBody(request);
    await env.DB.prepare('INSERT INTO visits (path, user_agent, ip_address) VALUES (?, ?, ?)')
      .bind(body.path || url.searchParams.get('path') || '/', request.headers.get('user-agent') || '', request.headers.get('CF-Connecting-IP') || 'unknown')
      .run();
    return json({ ok: true });
  }
  if (pathname === '/api/track-action' && method === 'POST') {
    const body = await readBody(request);
    if (!body.action) return json({ error: 'Action is required.' }, 400);
    await env.DB.prepare('INSERT INTO actions (path, action, target, details, user_agent, ip_address) VALUES (?, ?, ?, ?, ?, ?)')
      .bind(body.path || url.searchParams.get('path') || '/', body.action, body.target || '', body.details || '', request.headers.get('user-agent') || '', request.headers.get('CF-Connecting-IP') || 'unknown')
      .run();
    return json({ ok: true });
  }
  if (pathname === '/api/enquiry' && method === 'POST') {
    const body = await readBody(request);
    if (!body.name || !body.email) return json({ error: 'Name and email are required.' }, 400);
    const result = await env.DB.prepare('INSERT INTO enquiries (name, email, phone, business, service, message, source) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .bind(body.name, body.email, body.phone || '', body.business || '', body.service || '', body.message || '', 'website')
      .run();
    return json({ ok: true, id: result.meta?.last_row_id }, 201);
  }
  if (pathname === '/api/payment/initialize' && method === 'POST') {
    const body = await readBody(request);
    const { customer_name: customerName, email, plan } = body;
    if (!customerName || !email || !plan) return json({ error: 'Name, email, and plan are required.' }, 400);
    if (!env.PAYSTACK_SECRET_KEY) return json({ error: 'Online payments are not configured yet.' }, 503);
    const price = await getOne(env.DB, 'SELECT plan, amount FROM prices WHERE plan = ?', plan);
    if (!price) return json({ error: 'The selected plan is not available.' }, 400);

    const frontendUrl = (env.FRONTEND_ORIGIN || 'https://trendsmediaconsult.com').split(',')[0].trim().replace(/\/$/, '');
    const callbackUrl = env.PAYSTACK_CALLBACK_URL || `${frontendUrl}/`;
    const reference = `CMC-${Date.now()}`;
    const response = await fetch('https://api.paystack.co/transaction/initialize', {
      method: 'POST',
      headers: { Authorization: `Bearer ${env.PAYSTACK_SECRET_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email,
        amount: String(Number(price.amount) * 100),
        currency: 'NGN',
        reference,
        callback_url: callbackUrl,
        metadata: JSON.stringify({ customer_name: customerName, plan, amount: Number(price.amount) })
      })
    });
    const payment = await response.json();
    if (!response.ok || !payment.status || !payment.data?.authorization_url) {
      return json({ error: 'Unable to start the Paystack checkout.' }, 502);
    }
    await env.DB.prepare('INSERT INTO payments (customer_name, email, plan, amount, reference, status) VALUES (?, ?, ?, ?, ?, ?)')
      .bind(customerName, email, plan, Number(price.amount), payment.data.reference || reference, 'pending')
      .run();
    return json({ authorization_url: payment.data.authorization_url }, 201);
  }
  return json({ error: 'Not found.' }, 404);
}

async function renderAdmin(request, env, url) {
  const pathname = url.pathname;
  const method = request.method;
  if (pathname === '/admin/login' && method === 'GET') {
    return new Response(`<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>CMC Admin Login</title><body><main><h1>Admin login</h1><form method="post" action="/admin/login"><label>Username <input name="username" required></label><label>Password <input name="password" type="password" required></label><button>Log in</button></form></main></body></html>`, { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
  }
  if (pathname === '/admin/login' && method === 'POST') {
    if (!env.SESSION_SECRET) return new Response('Admin login is not configured.', { status: 503 });
    await ensureAdmin(env);
    const form = new URLSearchParams(await request.text());
    const user = await getOne(env.DB, 'SELECT username, password_hash FROM users WHERE username = ?', form.get('username') || '');
    if (!user || !bcrypt.compareSync(form.get('password') || '', user.password_hash)) {
      return new Response('Invalid credentials', { status: 401 });
    }
    const token = await createSession(user.username, env.SESSION_SECRET);
    return new Response(null, { status: 303, headers: { Location: '/admin', 'Set-Cookie': setSessionCookie(token) } });
  }
  if (pathname === '/admin/logout' && method === 'GET') {
    return new Response(null, { status: 303, headers: { Location: '/admin/login', 'Set-Cookie': clearSessionCookie } });
  }
  if (!await isAdmin(request, env)) {
    return new Response(null, { status: 302, headers: { Location: '/admin/login' } });
  }
  if (pathname === '/admin/careers' && method === 'GET') {
    return new Response(`<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Careers &amp; applications | CMC</title><style>body{font:15px system-ui;background:#f5f2eb;color:#171717;margin:0}main{max-width:1200px;margin:auto;padding:24px}article,form,.panel{background:#fff;border:1px solid #d9d4ca;padding:18px;margin:14px 0}label{display:block;font-size:12px;font-weight:700;margin:10px 0}input,textarea,select{display:block;width:100%;padding:9px;border:1px solid #aaa;margin-top:5px;font:14px system-ui}textarea{min-height:80px}button{padding:10px 14px;margin:4px;background:#171717;color:white;border:0;cursor:pointer}.grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}.row{display:flex;gap:10px;flex-wrap:wrap;align-items:center}.muted{color:#625f58;font-size:13px}#app-detail{white-space:normal} @media(max-width:700px){.grid{grid-template-columns:1fr}main{padding:14px}}</style><main><p><a href="/admin">← Dashboard</a> · <a href="/admin/blog">Blog management</a> · <a href="/admin/logout">Log out</a></p><h1>Careers &amp; job applications</h1><section class="panel"><h2>Create or edit a vacancy</h2><form id="job-form"><input type="hidden" name="id"><input type="hidden" name="published_at"><div class="grid"><label>Job title *<input name="title" required maxlength="160"></label><label>URL slug *<input name="slug" required maxlength="120" pattern="[A-Za-z0-9-]+"></label><label>Department / team<input name="department" maxlength="120"></label><label>Location<input name="location" maxlength="160"></label><label>Employment type<input name="employment_type" placeholder="Full-time, contract, internship…" maxlength="80"></label><label>Work arrangement<input name="work_arrangement" placeholder="On-site, hybrid, remote…" maxlength="80"></label><label>Application deadline<input name="deadline" type="date"></label><label>Publication status<select name="status"><option value="draft">Draft</option><option value="published">Published</option><option value="closed">Closed</option></select></label></div><label>Short summary<textarea name="summary" maxlength="600"></textarea></label><label>Job overview<textarea name="description" maxlength="8000"></textarea></label><label>Responsibilities (one per line)<textarea name="responsibilities" maxlength="8000"></textarea></label><label>Qualifications and experience (one per line)<textarea name="qualifications" maxlength="8000"></textarea></label><label>Preferred skills (one per line)<textarea name="preferred_skills" maxlength="5000"></textarea></label><p class="muted">Publication time is recorded in Lagos, Nigeria time (WAT, UTC+1). Published vacancies appear on the careers page immediately.</p><button type="submit">Save vacancy</button><button type="reset">Clear form</button><span id="job-message" role="status"></span></form><h2>Vacancies</h2><div id="jobs">Loading vacancies…</div></section><section class="panel"><h2>Applications</h2><div class="grid"><label>Search name or email<input id="app-search" type="search"></label><label>Filter by status<select id="app-status"><option value="">All statuses</option><option>New</option><option>Under Review</option><option>Shortlisted</option><option>Rejected</option><option>Hired</option></select></label><label>Filter by position<select id="app-job"><option value="">All positions</option></select></label></div><div id="applications">Loading applications…</div><div id="app-detail"></div></section></main><script>
    const $=(s)=>document.querySelector(s), jf=$('#job-form'), jobMessage=$('#job-message'); let jobs=[];
    const esc=(x)=>String(x??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
    async function loadJobs(){const r=await fetch('/api/admin/careers/jobs',{credentials:'same-origin'});if(r.status===401){$('#jobs').innerHTML='Admin sign-in required. <a href="/admin/login" target="_blank" rel="noopener">Sign in again</a>, then return here.';return}if(!r.ok){$('#jobs').textContent='Could not load vacancies.';return}jobs=await r.json();$('#jobs').innerHTML=jobs.length?jobs.map(j=>'<article><b>'+esc(j.title)+'</b> · '+esc(j.status)+(j.published_at?' · Published '+esc(j.published_at)+' (Lagos time)':'')+'<p class="muted">'+esc(j.location||'Location not set')+' · '+esc(j.employment_type||'Type not set')+(j.deadline?' · Deadline '+esc(j.deadline):'')+'</p><button data-edit-job="'+j.id+'">Edit</button> <button data-delete-job="'+j.id+'">Delete</button></article>').join(''):'<p class="muted">No vacancies created yet.</p>';$('#app-job').innerHTML='<option value="">All positions</option>'+jobs.map(j=>'<option value="'+j.id+'">'+esc(j.title)+'</option>').join('');jobs.forEach(j=>{$('[data-edit-job="'+j.id+'"]').onclick=()=>{Object.keys(jf.elements).forEach(k=>{if(jf.elements[k]&&j[k]!==undefined)jf.elements[k].value=j[k]||''});jf.elements.id.value=j.id;window.scrollTo({top:0,behavior:'smooth'})};$('[data-delete-job="'+j.id+'"]').onclick=async()=>{if(confirm('Delete this vacancy? Applications will be kept for your records.')){const d=await fetch('/api/admin/careers/jobs/'+j.id,{method:'DELETE',credentials:'same-origin'});if(d.ok){loadJobs();loadApplications()}else alert('Could not delete this vacancy.')}}})}
    jf.onsubmit=async e=>{e.preventDefault();jobMessage.textContent='Saving…';const d=Object.fromEntries(new FormData(jf)),id=d.id;delete d.id;const r=await fetch('/api/admin/careers/jobs'+(id?'/'+id:''),{method:id?'PUT':'POST',credentials:'same-origin',headers:{'Content-Type':'application/json'},body:JSON.stringify(d)});const result=await r.json();if(r.status===401){jobMessage.innerHTML='Your admin sign-in has expired. <a href="/admin/login" target="_blank" rel="noopener">Sign in again</a>, then return here and click Save vacancy. Your form is still filled in.';return}if(!r.ok){jobMessage.textContent=result.error||'Could not save vacancy.';return}jobMessage.textContent='Vacancy saved.';jf.reset();jf.elements.id.value='';loadJobs()};
    async function loadApplications(){const q=new URLSearchParams();if($('#app-search').value.trim())q.set('search',$('#app-search').value.trim());if($('#app-status').value)q.set('status',$('#app-status').value);if($('#app-job').value)q.set('job_id',$('#app-job').value);const r=await fetch('/api/admin/careers/applications?'+q);if(!r.ok){$('#applications').textContent='Could not load applications.';return}const rows=await r.json();$('#applications').innerHTML=rows.length?rows.map(a=>'<article><div class="row"><strong>'+esc(a.full_name)+'</strong><span>· '+esc(a.position_title)+' · '+esc(a.status)+'</span></div><p class="muted">'+esc(a.email)+' · '+esc(a.phone)+' · '+esc(a.submitted_at)+'</p><button data-open-app="'+a.id+'">Review application</button></article>').join(''):'<p class="muted">No applications match these filters.</p>';rows.forEach(a=>{$('[data-open-app="'+a.id+'"]').onclick=()=>showApplication(a.id)})}
    async function showApplication(id){const r=await fetch('/api/admin/careers/applications/'+id);if(!r.ok){$('#app-detail').textContent='Could not open this application.';return}const a=await r.json();const interviewLocal=a.interview_at?new Intl.DateTimeFormat('en-CA',{timeZone:'Africa/Lagos',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).format(new Date(a.interview_at)).replace(', ','T') : '';$('#app-detail').innerHTML='<article><h3>Application from '+esc(a.full_name)+'</h3><p><b>Position:</b> '+esc(a.position_title)+'<br><b>Email:</b> <a href="mailto:'+encodeURIComponent(a.email)+'">'+esc(a.email)+'</a><br><b>Phone:</b> '+esc(a.phone)+'<br><b>Submitted:</b> '+esc(a.submitted_at)+'</p><p><b>Cover letter / statement</b><br>'+esc(a.cover_letter||'Not provided').replace(/\\n/g,'<br>')+'</p><p><b>Relevant experience</b><br>'+esc(a.experience||'Not provided').replace(/\\n/g,'<br>')+'</p><p><b>Portfolio</b><br>'+(a.portfolio_url?'<a rel="noopener" target="_blank" href="'+esc(a.portfolio_url)+'">'+esc(a.portfolio_url)+'</a>':'Not provided')+'</p><p><a href="/api/admin/careers/applications/'+a.id+'/cv">Download applicant CV (PDF)</a></p><label>Application status<select id="detail-status">'+['New','Under Review','Shortlisted','Rejected','Hired'].map(s=>'<option'+(s===a.status?' selected':'')+'>'+s+'</option>').join('')+'</select></label><label>Private internal notes (not emailed)<textarea id="detail-notes" maxlength="5000">'+esc(a.internal_notes)+'</textarea></label><h4>Applicant email update</h4><p class="muted">This message and interview details will be emailed to the applicant when you save, if email sending is configured.</p><label>Remarks for applicant<textarea id="candidate-update" maxlength="3000" placeholder="Write an update the applicant may see">'+esc(a.candidate_update||'')+'</textarea></label><label>Interview date and time (Lagos time, WAT)<input id="interview-at" type="datetime-local" value="'+esc(interviewLocal)+'"></label><label>Interview location<input id="interview-location" maxlength="300" value="'+esc(a.interview_location||'')+'" placeholder="Office address or online"></label><label>Interview meeting link<input id="interview-link" type="url" maxlength="500" value="'+esc(a.interview_link||'')+'" placeholder="https://"></label><p class="muted">Last email sent: '+esc(a.last_email_sent_at||'Not sent')+'</p><label><input id="notify-candidate" type="checkbox" checked style="display:inline;width:auto"> Email applicant when saving</label><button id="save-app">Save review and email update</button><span id="app-message" role="status"></span></article>';$('#save-app').onclick=async()=>{const localTime=$('#interview-at').value;const response=await fetch('/api/admin/careers/applications/'+a.id,{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({status:$('#detail-status').value,internal_notes:$('#detail-notes').value,candidate_update:$('#candidate-update').value,interview_at:localTime?localTime+':00+01:00':'',interview_location:$('#interview-location').value,interview_link:$('#interview-link').value,notify_candidate:$('#notify-candidate').checked})});const result=await response.json();$('#app-message').textContent=!response.ok?(result.error||'Could not save changes.'):result.email_sent?'Review saved and email sent to the applicant.':result.email_error||'Review saved; no email was sent.';if(response.ok)loadApplications()}}
    let timer;$('#app-search').oninput=()=>{clearTimeout(timer);timer=setTimeout(loadApplications,250)};$('#app-status').onchange=loadApplications;$('#app-job').onchange=loadApplications;loadJobs();loadApplications();
    </script>`, { headers: { 'Content-Type': 'text/html; charset=utf-8', 'X-Robots-Tag': 'noindex, nofollow' } });
  }
  if (pathname === '/admin/blog' && method === 'GET') {
    return new Response(`<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Blog management | CMC</title><style>body{font:15px system-ui;background:#f5f2eb;color:#171717;margin:0}main{max-width:1000px;margin:auto;padding:26px}article,form{background:white;border:1px solid #d9d4ca;padding:18px;margin:14px 0}label{display:block;font-weight:700;font-size:12px;margin:10px 0}input,textarea,select{display:block;width:100%;padding:9px;border:1px solid #aaa;margin-top:5px;font:14px system-ui}textarea{min-height:100px}button{padding:10px;margin:4px;background:#171717;color:white;border:0;cursor:pointer}</style><main><a href="/admin">← Dashboard</a> · <a href="/admin/logout">Log out</a><h1>Blog management</h1><p>Enter article body using HTML paragraphs, headings, lists, links and quotations. Images and videos can be uploaded when the R2 bucket is configured.</p><form id="f"><input type="hidden" name="id"><label>Title<input name="title" required></label><label>Slug<input name="slug" required></label><label>Excerpt<textarea name="excerpt"></textarea></label><label>Body HTML<textarea name="body"></textarea></label><label>Upload image/video (images up to 8 MB; videos up to 15 MB)<input id="media-file" type="file" accept="image/jpeg,image/png,image/webp,image/gif,video/mp4,video/webm"></label><button type="button" id="upload">Upload and insert</button><span id="upload-status" role="status"></span><label>Cover image URL<input name="cover_image" type="url"></label><label>Cover image alt text<input name="cover_alt"></label><label>Author<input name="author"></label><label>Status<select name="status"><option>draft</option><option>published</option></select></label><label>Publication date (Lagos time, WAT / UTC+1)<input name="published_at" type="datetime-local"></label><label>SEO title<input name="seo_title"></label><label>Meta description<textarea name="meta_description"></textarea></label><label>Keywords<input name="keywords"></label><label>Canonical URL<input name="canonical_url" type="url"></label><label>Social image URL<input name="social_image" type="url"></label><button>Save article</button><button type="reset">Clear</button><span id="msg"></span></form><h2>Articles</h2><div id="list">Loading…</div></main><script>const f=document.querySelector('#f'),list=document.querySelector('#list'),msg=document.querySelector('#msg');document.querySelector('#upload').onclick=async()=>{const file=document.querySelector('#media-file').files[0],status=document.querySelector('#upload-status');if(!file){status.textContent='Choose a file first.';return}const fd=new FormData();fd.append('file',file);status.textContent='Uploading…';try{const r=await fetch('/api/admin/media',{method:'POST',body:fd});const data=await r.json();if(!r.ok)throw new Error(data.error||'Upload failed');if(file.type.startsWith('image/')){f.elements.cover_image.value=data.url;if(!f.elements.cover_alt.value)f.elements.cover_alt.value=file.name;f.elements.body.value+='\\n<p><img src="'+data.url+'" alt=""></p>'}else f.elements.body.value+='\\n<video controls src="'+data.url+'"></video>';status.textContent='Uploaded. Article changes still need saving.'}catch(e){status.textContent=e.message}};async function load(){const r=await fetch('/api/admin/articles');if(!r.ok){list.textContent='Unable to load articles';return}const items=await r.json();list.innerHTML=items.length?items.map(a=>'<article><b>'+esc(a.title)+'</b> · '+esc(a.status)+' · Reads: '+Number(a.views||0)+'<p>'+esc(a.published_at||'Draft')+'</p><button data-edit="'+a.id+'">Edit</button> <button data-del="'+a.id+'">Delete</button> <a href="/admin/blog/preview/'+encodeURIComponent(a.slug)+'" target="_blank">Preview</a></article>').join(''):'<p>No articles yet.</p>';items.forEach(a=>{const e=list.querySelector('[data-edit="'+a.id+'"]');e.onclick=()=>{Object.entries(a).forEach(([k,v])=>{if(f.elements[k])f.elements[k].value=k==='published_at'&&v?formatLocalDateTime(v):v||''});f.elements.id.value=a.id;scrollTo(0,0)};list.querySelector('[data-del="'+a.id+'"]').onclick=async()=>{if(confirm('Delete this article?')){await fetch('/api/admin/articles/'+a.id,{method:'DELETE'});load()}}})}f.onsubmit=async e=>{e.preventDefault();const d=Object.fromEntries(new FormData(f)),id=d.id;delete d.id;if(d.published_at)d.published_at=new Date(d.published_at+':00+01:00').toISOString();const r=await fetch('/api/admin/articles'+(id?'/'+id:''),{method:id?'PUT':'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(d)});const j=await r.json();if(!r.ok){msg.textContent=j.error||'Save failed';return}load()};function formatLocalDateTime(value){const parts=new Intl.DateTimeFormat('en-CA',{timeZone:'Africa/Lagos',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(new Date(value));const p=Object.fromEntries(parts.map(x=>[x.type,x.value]));return p.year+'-'+p.month+'-'+p.day+'T'+p.hour+':'+p.minute}function esc(s){return String(s||'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))}load()</script>`, { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
  }
  if (pathname.startsWith('/admin/blog/preview/') && method === 'GET') {
    const slug = decodeURIComponent(pathname.slice('/admin/blog/preview/'.length));
    const article = await getOne(env.DB, 'SELECT * FROM articles WHERE slug = ?', slug);
    if (!article) return new Response('Article not found.', { status: 404 });
    return new Response(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><meta name="robots" content="noindex,nofollow"><title>${escapeHtml(article.title)} · Preview</title><style>body{max-width:760px;margin:50px auto;padding:0 22px;font:17px/1.8 system-ui;color:#262626}h1{font-size:clamp(42px,7vw,74px);line-height:1.02;letter-spacing:-.06em}.body img{max-width:100%;height:auto}</style></head><body><p><a href="/admin/blog">← Back to blog management</a> · PREVIEW (${escapeHtml(article.status)})</p><h1>${escapeHtml(article.title)}</h1><p>${escapeHtml(article.excerpt)}</p><time>${escapeHtml(article.published_at || 'Draft')}</time>${article.cover_image ? `<img src="${escapeHtml(article.cover_image)}" alt="${escapeHtml(article.cover_alt)}" style="max-width:100%;height:auto">` : ''}<div class="body">${article.body}</div></body></html>`, { headers: { 'Content-Type': 'text/html; charset=utf-8', 'X-Robots-Tag': 'noindex, nofollow' } });
  }
  if (pathname === '/admin/export/enquiries.csv' || pathname === '/admin/export/payments.csv') {
    const enquiries = pathname.includes('enquiries');
    const table = enquiries ? 'enquiries' : 'payments';
    const rows = await getRows(env.DB, `SELECT * FROM ${table} ORDER BY id DESC`);
    const csvCell = (value) => `"${String(value ?? '').replace(/"/g, '""')}"`;
    const csv = rows.length ? [Object.keys(rows[0]).join(','), ...rows.map((row) => Object.values(row).map(csvCell).join(','))].join('\n') : 'No data available';
    return new Response(csv, { headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="${table}.csv"` } });
  }
  if (pathname === '/admin/prices' && method === 'POST') {
    const form = new URLSearchParams(await request.text());
    const amount = Number(form.get('amount'));
    if (!form.get('plan') || !Number.isInteger(amount) || amount < 0) return new Response('Invalid price', { status: 400 });
    await env.DB.prepare('UPDATE prices SET amount = ?, updated_at = CURRENT_TIMESTAMP WHERE plan = ?').bind(amount, form.get('plan')).run();
    return new Response(null, { status: 303, headers: { Location: '/admin' } });
  }
  if (pathname !== '/admin' || method !== 'GET') return new Response('Not found', { status: 404 });

  const [enquiries, payments, visits, actions, prices] = await Promise.all([
    getRows(env.DB, 'SELECT * FROM enquiries ORDER BY id DESC'),
    getRows(env.DB, 'SELECT * FROM payments ORDER BY id DESC'),
    getRows(env.DB, 'SELECT * FROM visits ORDER BY id DESC'),
    getRows(env.DB, 'SELECT * FROM actions ORDER BY id DESC'),
    getRows(env.DB, 'SELECT * FROM prices ORDER BY id ASC')
  ]);
  const table = (rows, columns) => rows.length
    ? rows.map((row) => `<tr>${columns.map((column) => `<td>${escapeHtml(row[column] ?? '-')}</td>`).join('')}</tr>`).join('')
    : `<tr><td colspan="${columns.length}">No records yet.</td></tr>`;
  const priceForms = prices.map((price) => `<form method="post" action="/admin/prices"><input type="hidden" name="plan" value="${escapeHtml(price.plan)}"><label>${escapeHtml(price.plan)} <input type="number" name="amount" min="0" step="1" value="${escapeHtml(price.amount)}" required></label><button>Save</button></form>`).join('');
  const html = `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Trends Media Consult Admin</title><style>body{font:15px system-ui;margin:0;background:#f5f2eb;color:#171717}main{max-width:1200px;margin:auto;padding:24px}header,.stats,.columns{display:flex;gap:16px;justify-content:space-between;flex-wrap:wrap}.stats section,article{background:white;border:1px solid #d9d4ca;padding:18px;margin:14px 0;overflow:auto}section strong{display:block;font-size:28px}table{border-collapse:collapse;width:100%}td,th{text-align:left;padding:9px;border-bottom:1px solid #ddd}a,button{color:#171717}form{display:flex;gap:10px;margin:10px 0;align-items:center}input{padding:8px;max-width:180px}</style><main><header><div><small>Trends Media Consult</small><h1>Admin dashboard</h1></div><nav><a href="/admin/blog">Manage blog</a> | <a href="/admin/careers">Careers &amp; applications</a> | <a href="/admin/export/enquiries.csv">Export enquiries</a> | <a href="/admin/export/payments.csv">Export payments</a> | <a href="/admin/logout">Logout</a></nav></header><div class="stats"><section>Enquiries<strong>${enquiries.length}</strong></section><section>Payments<strong>${payments.length}</strong></section><section>Revenue<strong>₦${payments.reduce((sum, item) => sum + Number(item.amount || 0), 0).toLocaleString('en-NG')}</strong></section><section>Traffic<strong>${visits.length}</strong></section></div><article><h2>Recent enquiries</h2><table><thead><tr><th>Name</th><th>Email</th><th>Service</th><th>Message</th></tr></thead><tbody>${table(enquiries.slice(0, 8), ['name', 'email', 'service', 'message'])}</tbody></table></article><article><h2>Traffic</h2><table><thead><tr><th>Page</th><th>Time</th></tr></thead><tbody>${table(visits.slice(0, 8), ['path', 'created_at'])}</tbody></table></article><article><h2>Payments</h2><table><thead><tr><th>Name</th><th>Email</th><th>Plan</th><th>Amount</th><th>Reference</th></tr></thead><tbody>${table(payments.slice(0, 8), ['customer_name', 'email', 'plan', 'amount', 'reference'])}</tbody></table></article><article><h2>Recent actions</h2><table><thead><tr><th>Action</th><th>Target</th><th>Page</th><th>Time</th></tr></thead><tbody>${table(actions.slice(0, 12), ['action', 'target', 'path', 'created_at'])}</tbody></table></article><article><h2>Payment prices</h2>${priceForms}</article></main></html>`;
  return new Response(html, { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const allowedOrigins = (env.FRONTEND_ORIGIN || 'https://trendsmediaconsult.com,https://www.trendsmediaconsult.com').split(',').map((origin) => origin.trim());
    const origin = request.headers.get('Origin');
    const headers = new Headers();
    if (origin && allowedOrigins.includes(origin)) {
      headers.set('Access-Control-Allow-Origin', origin);
      headers.set('Access-Control-Allow-Credentials', 'true');
      headers.set('Vary', 'Origin');
    }
    if (request.method === 'OPTIONS') {
      headers.set('Access-Control-Allow-Headers', 'Content-Type');
      headers.set('Access-Control-Allow-Methods', 'GET,POST,PUT,OPTIONS');
      return new Response(null, { status: 204, headers });
    }

    try {
      let response;
      if (url.pathname.startsWith('/media/')) {
        const mediaKey = decodeURIComponent(url.pathname.slice('/media/'.length));
        if (mediaKey.startsWith('private/')) response = new Response('Not found', { status: 404 });
        else if (!env.MEDIA) response = new Response('Media storage is not configured.', { status: 503 });
        else {
          const object = await env.MEDIA.get(mediaKey);
          response = object ? new Response(object.body, { headers: { 'Content-Type': object.httpMetadata?.contentType || 'application/octet-stream', 'Cache-Control': object.httpMetadata?.cacheControl || 'public, max-age=86400', 'X-Content-Type-Options': 'nosniff' } }) : new Response('Not found', { status: 404 });
        }
      }
      else if (url.pathname === '/sitemap.xml' && request.method === 'GET') {
        const site = (env.FRONTEND_ORIGIN || 'https://trendsmediaconsult.com').split(',')[0].trim().replace(/\/$/, '');
        const articles = await getRows(env.DB, "SELECT slug, canonical_url, published_at, updated_at FROM articles WHERE status = 'published' AND published_at IS NOT NULL AND datetime(published_at) <= CURRENT_TIMESTAMP ORDER BY published_at DESC");
        const jobs = await getRows(env.DB, "SELECT slug, updated_at FROM career_jobs WHERE status = 'published' AND published_at IS NOT NULL AND datetime(published_at) <= CURRENT_TIMESTAMP AND (deadline IS NULL OR deadline = '' OR date(deadline) >= date('now', '+1 hour')) ORDER BY created_at DESC");
        const urls = [`<url><loc>${site}/</loc></url>`, `<url><loc>${site}/blog/</loc></url>`, `<url><loc>${site}/careers/</loc></url>`, ...jobs.map((j) => `<url><loc>${site}/careers/?job=${encodeURIComponent(j.slug)}</loc><lastmod>${escapeHtml(new Date(j.updated_at).toISOString().slice(0, 10))}</lastmod></url>`), ...articles.map((a) => `<url><loc>${escapeHtml(a.canonical_url || `${site}/blog/article.html?slug=${encodeURIComponent(a.slug)}`)}</loc><lastmod>${escapeHtml(new Date(a.updated_at || a.published_at).toISOString().slice(0, 10))}</lastmod></url>`)];
        response = new Response(`<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${urls.join('')}</urlset>`, { headers: { 'Content-Type': 'application/xml; charset=utf-8' } });
      }
      else if (url.pathname.startsWith('/api/')) response = await handleApi(request, env, url);
      else if (url.pathname.startsWith('/admin')) response = await renderAdmin(request, env, url);
      else if (url.pathname === '/') response = Response.redirect(`${url.origin}/admin/login`, 302);
      else response = new Response('Not found', { status: 404 });
      const mergedHeaders = new Headers(response.headers);
      headers.forEach((value, key) => mergedHeaders.set(key, value));
      return new Response(response.body, { status: response.status, headers: mergedHeaders });
    } catch (error) {
      console.error('Worker request failed:', error);
      return json({ error: 'Internal server error.' }, 500);
    }
  }
};
