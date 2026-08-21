# MijnTunes Landing Engineering Agent

Standalone engineering-agent runtime for the public MijnTunes.nl landing site.

## Hard boundary

This agent is dedicated exclusively to `Tonnyvanleest/mijntunes-landing`.

It must not operate on `mijntunes-engineering-agent`, the authenticated `app.mijntunes.nl` application, Supabase production data, or unrelated MijnTunes repositories. The runtime enforces the target repository name before GitHub operations are performed.

## Phase 0 / bootstrap

Current capabilities are deliberately read-only:

- `GET /` - service identity and capabilities
- `GET /health` - Railway health endpoint
- `GET /api/landing/status` - repository and GitHub Actions status
- `GET /api/landing/failures` - recent failed workflow diagnostics

No production write or deployment capability is enabled yet.

## Railway

Create one Railway service from this repository. Railway should detect Node.js 20+ and run `npm start`.

Healthcheck path: `/health`

Railway supplies `PORT`; do not hard-code the production port.

## Environment

Copy variable names from `.env.example` into Railway Variables. Never commit secrets.

Use a dedicated OpenAI API key for this agent. `LANDING_GITHUB_REPOSITORY` must remain exactly `Tonnyvanleest/mijntunes-landing`.

## Next controlled capabilities

After the read-only service is verified, controlled engineering capabilities can be added for the landing repository, such as inspecting files, creating bounded implementation jobs, committing approved changes, and validating Vercel production deployments.

The agent must always report the repository, starting HEAD, ending HEAD, commits, push status and deployment validation for write jobs.
