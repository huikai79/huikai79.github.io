# External Reading Ingestion v1 field ownership

| Property | Owner | Meaning |
| --- | --- | --- |
| Source URL | Author | The URL pasted into the inbox. |
| Ingestion Status | System | Ready, Needs Review or Duplicate. |
| Canonical URL | System | Canonical article URL extracted after fetching. |
| Source Hash | System | Hash of normalized extracted source content; revision/dedup evidence, not stable identity. |
| Retrieved At | System | Retrieval timestamp. |
| Source Published At | System | Publication timestamp claimed by the source page when detectable. |
| Ingestion Note | System | Failure/warning/duplicate explanation. |
| Rights Status | Editorial | Defaults to Unknown; never inferred as publication permission. |
| Translation Group | System | Stable identity derived from the canonical Notion Source page id. |
| Category / Type / date / Summary | Editorial | Not required for ingestion; publication rules remain separate. |
