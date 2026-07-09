# IdentityHub

report NHI (Non-Human Identity) findings as Jira tickets.

Design docs: 
* [backend](design-docs/backend-design.md)
* [frontend](design-docs/frontend-design.md)
* [assumptions](design-docs/assumptions.md).

## Prerequisites

- nodejs v26
- Docker (for Postgres and Redis)
- chromium (for frontend e2e tests)
- A `.env` file with the Jira OAuth credentials and Postgres/Redis settings
  (see the Run locally section of the backend design doc for the full list).

## Setup

```bash
npm install
npm run docker-compose:up   # start Postgres and Redis
```

## Run

```bash
npm run backend    # migrate DB -> generate Kysely types -> start server + serve the frontend
npm run scraper    # migrate DB -> generate Kysely types -> start scraper -->> bonus task
npm run e2e        # make sure the backend runs as well in the background
```

now go to: http://localhost:3000

---

#### Some debugging help:

```
# call to the ai model directly
curl -s https://api.aionlabs.ai/v1/chat/completions \
  -H "Authorization: Bearer $(grep '^AIONLABS_API_KEY=' .env | cut -d= -f2)" \
  -H "Content-Type: application/json" \
  -d '{"model":"aion-labs/aion-2.0","messages":[{"role":"user","content":"hi"}]}'


# all posts we sent to kafka for future summary by ai
docker exec -e PGPASSWORD=identityhub_dev_pw devex-postgres-1 psql -U identityhub -d identityhub \
  -c "select jira_issue_key, ticketed_at, title, summary from blog_posts order by ticketed_at desc;"

# all possts summarised by ai
docker exec -e PGPASSWORD=identityhub_dev_pw devex-postgres-1 psql -U identityhub -d identityhub \
  -c "select jira_issue_key, ticketed_at, title, summary from blog_posts order by ticketed_at desc;"
```


https://docs.google.com/presentation/d/1HqP3s5PDygWKovg3Z62HL-tb4hTQtD-lu46hhP4cf6I/edit?usp=sharing