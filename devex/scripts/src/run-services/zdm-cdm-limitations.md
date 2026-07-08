# ZDM Proxy & CDM Limitations

- **Server-side CQL functions** (`uuid()`, `now()`, `toTimestamp(now())`) are evaluated independently on each cluster, producing different values. All other services generate IDs/timestamps in app code. Affected:
  - `helperon` `src/dal/agentTemplateRepo.ts:37` — `toTimestamp(now())` in INSERT
  - `helperon` `src/dal/clusterConfigRepo.ts:10` — `toTimestamp(now())` in INSERT
  - `helperon` `src/dal/pendingAgentRepo.ts:109` — `toTimestamp(now())` in INSERT
  - `helperon` `src/dal/pendingAgentRepo.ts:152` — `toTimestamp(now())` in UPDATE
  - `helperon` `src/dal/pendingAgentRepo.ts:188` — `toTimestamp(now())` in UPDATE
  - `swoop` `src/cassandra/azureSubscriptionMapping.ts:8` — `toTimestamp(now())` in INSERT
  - `swoop` `src/cassandra/bedrockRateLimit.ts:11` — `now()` as a value in INSERT
- **Both clusters must be healthy** for writes to succeed. If either is down, writes are rejected. No retry, no reconciliation, no hint storage.
- **DDL must go through the proxy** to stay in sync. Direct schema changes to one cluster cause drift and write failures.
- **CDM writetime/TTL approximation can cause data corruption**. CDM picks the max writetime across all cells per row. If cells have different writetimes (from separate UPDATEs), CDM inflates lower writetimes to the max. A concurrent ZDM write can be incorrectly overwritten on target:
  1. Row on origin: `name` (writetime=200), `email` (writetime=500), `age` (writetime=100)
  2. CDM reads the row, will write to target with max writetime=**500**
  3. App writes through ZDM: `UPDATE SET name='Bob'` — gets writetime=300 on both clusters
     - Origin: name=Bob (300 > 200) — wins correctly
     - Target: name=Bob (300) — written
  4. CDM writes to target: name=Alice with writetime=**500** (inflated from 200)
     - Target: name=Alice (500 > 300) — **overwrites Bob**
  5. Result: origin has name=**Bob**, target has name=**Alice** — **corruption**
  - Same applies to **TTL** — TTL is part of the same cell mutation. The inflated writetime makes CDM's approximated TTL (max across cells) also win over the legitimate ZDM write's TTL. Both value and TTL are corrupted together.
