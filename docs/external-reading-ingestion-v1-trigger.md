# External Reading Ingestion v1 trigger

The v1 trigger is scheduled polling, not a public webhook. The GitHub Actions worker scans the Notion data source every 15 minutes and processes only blank inbox rows that match the candidate contract.

This deliberately avoids adding a new public runtime/deployment surface. A future webhook may reuse the same ingestion function if lower latency proves valuable; it must not change translation or publication authorization semantics.
