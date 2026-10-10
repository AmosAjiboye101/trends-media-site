ALTER TABLE career_applications ADD COLUMN candidate_update TEXT NOT NULL DEFAULT '';
ALTER TABLE career_applications ADD COLUMN interview_at TEXT;
ALTER TABLE career_applications ADD COLUMN interview_location TEXT NOT NULL DEFAULT '';
ALTER TABLE career_applications ADD COLUMN interview_link TEXT NOT NULL DEFAULT '';
ALTER TABLE career_applications ADD COLUMN last_email_sent_at TEXT;
