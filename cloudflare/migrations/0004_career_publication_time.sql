ALTER TABLE career_jobs ADD COLUMN published_at TEXT;

UPDATE career_jobs
SET published_at = strftime('%Y-%m-%dT%H:%M:%S+01:00', created_at, '+1 hour')
WHERE status = 'published' AND published_at IS NULL;
