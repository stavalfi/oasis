# ZDM Proxy & CDM — Q&A

- **Q: Will `uuid()`/`now()` produce the same value on both clusters?** No. The proxy forwards the CQL statement text; each cluster evaluates server-side functions independently.
- **Q: What if a write fails on one cluster?** Write is rejected entirely. No partial success, no retry. Proxy becomes unresponsive if a cluster is down.
- **Q: How does CDM handle TTL?** Approximated — picks max TTL across all cells per row. Per-cell TTL precision is not possible.
- **Q: How to resume a failed CDM run?** Enable `trackRun=true` and `trackRun.autoRerun=true`. CDM stores progress per token-range in `cdm_run_info`/`cdm_run_details` tables on target. On the next run, it auto-discovers the last incomplete run and only processes failed/pending ranges.
- **Q: What is `rerunMultiplier`?** On rerun, each failed token-range is split into N sub-ranges (e.g. `rerunMultiplier=10` splits each failed range into 10). Helps when large partitions caused timeouts — smaller chunks are more likely to succeed.
- **Q: What if ZDM goes down and writes only reach origin?** CDM won't retroactively catch those gaps unless you re-run it. At scale (100+ tables) this is impractical.
