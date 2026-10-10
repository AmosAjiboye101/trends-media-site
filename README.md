# Trends Media Consult

A responsive marketing website for Trends Media Consult with a lightweight admin dashboard for enquiries, payments, and traffic metrics.

## Run locally

1. Install dependencies:
   `npm install`
2. Start the site and admin dashboard:
   `npm start`
3. Open the site at `http://localhost:3000`
4. Log in to the admin dashboard at `http://localhost:3000/admin/login`

Default admin credentials:
- Username: `admin`
- Password: `admin123`

## Deployment

GitHub Pages hosts the static frontend. The Node/Express backend is deployed by
the included `render.yaml` blueprint because GitHub Pages cannot run Node
servers or databases.

### Frontend on GitHub Pages

1. Push this repository to GitHub, using `main` as the default branch.
2. In **Settings > Pages**, choose **GitHub Actions** as the source.
3. The workflow deploys the site and uses the included `CNAME` file for
   `trendsmediaconsult.com`.
4. At your domain registrar, create these DNS records:
   - `A` records for `@` to `185.199.108.153`, `185.199.109.153`,
     `185.199.110.153`, and `185.199.111.153`
   - A `CNAME` record for `www` to `<github-username>.github.io`

### Careers API and applicant email updates

The Careers page and recruitment admin endpoints run on the Cloudflare Worker
configured in `wrangler.toml`. After changing the Worker or its migrations, run:

1. `npx wrangler d1 migrations apply trends-media-db --remote`
2. `npx wrangler deploy`

Applicant review emails use Resend. Before enabling them, add and verify a
sending domain in Resend, create a sending-only API key, and set these Worker
secrets (the sender address must belong to the verified domain):

1. `npx wrangler secret put RESEND_API_KEY`
2. `npx wrangler secret put CAREERS_FROM_EMAIL`

Then deploy the Worker again. The admin review form keeps private notes separate
from the remarks and interview details sent to the applicant. The UI reports
whether each email was sent; review changes are saved even if email delivery is
not configured or the email service is temporarily unavailable.

### Backend on Render

1. Create a new Render Blueprint from this repository.
2. Set `ADMIN_USERNAME` and `ADMIN_PASSWORD` when Render prompts for them.
3. Add the custom domain `api.trendsmediaconsult.com` to the `trends-media-api` web
   service and follow Render's DNS instructions.
4. Confirm `https://api.trendsmediaconsult.com/api/health` returns JSON.

For the API DNS record, the usual Render setup is a `CNAME` record named
`api` pointing to the `trends-media-api.onrender.com` hostname shown in your
Render service. Do not create an `A` record for the API.

The frontend automatically uses the local backend on `localhost` and
`https://api.trendsmediaconsult.com` everywhere else.

## Hosted backend configuration

The app is designed to use a real hosted Postgres/Supabase backend when you provide connection details in a `.env` file.

Copy `.env.example` and fill in your values:
- `DATABASE_URL` (recommended for Postgres)
- `ADMIN_USERNAME`
- `ADMIN_PASSWORD`
- `SESSION_SECRET`

If no database URL is set, the app falls back to a local SQLite database for development.

For production, use the Postgres database created by the Render blueprint and
set a strong `SESSION_SECRET`. Do not use the development admin credentials in
production.

## Exporting data

From the admin dashboard you can download CSV exports for:
- enquiries
- payments

The dashboard also shows totals for enquiries, revenue, and site traffic.
