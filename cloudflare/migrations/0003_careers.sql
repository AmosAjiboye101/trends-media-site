CREATE TABLE IF NOT EXISTS career_jobs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  department TEXT NOT NULL DEFAULT '',
  location TEXT NOT NULL DEFAULT '',
  employment_type TEXT NOT NULL DEFAULT '',
  work_arrangement TEXT NOT NULL DEFAULT '',
  summary TEXT NOT NULL DEFAULT '',
  description TEXT NOT NULL DEFAULT '',
  responsibilities TEXT NOT NULL DEFAULT '',
  qualifications TEXT NOT NULL DEFAULT '',
  preferred_skills TEXT NOT NULL DEFAULT '',
  deadline TEXT,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published', 'closed')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS career_applications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  job_id INTEGER REFERENCES career_jobs(id) ON DELETE SET NULL,
  position_title TEXT NOT NULL,
  full_name TEXT NOT NULL,
  email TEXT NOT NULL,
  phone TEXT NOT NULL,
  cover_letter TEXT NOT NULL DEFAULT '',
  experience TEXT NOT NULL DEFAULT '',
  portfolio_url TEXT NOT NULL DEFAULT '',
  cv_key TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'New' CHECK (status IN ('New', 'Under Review', 'Shortlisted', 'Rejected', 'Hired')),
  internal_notes TEXT NOT NULL DEFAULT '',
  submitted_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS career_jobs_public_idx ON career_jobs(status, deadline);
CREATE INDEX IF NOT EXISTS career_applications_recent_idx ON career_applications(submitted_at DESC);
CREATE INDEX IF NOT EXISTS career_applications_job_status_idx ON career_applications(job_id, status);
CREATE INDEX IF NOT EXISTS career_applications_email_idx ON career_applications(email);
