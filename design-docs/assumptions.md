# Assumptions

## "Recent tickets from this app"

- The 10-recent view is per-project and shared across users of that project,
  filtered through the caller's Jira visibility. Not per-user-private.

## Bonus (NHI Blog Digest)

- Trigger = poll loop in a separate scraper service.
- Summary tickets are filed by a service-account API token, not any tenant's OAuth.
