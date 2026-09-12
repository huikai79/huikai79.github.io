# External Reading Ingestion v1 acceptance

The Slice B implementation is acceptable when all of the following hold:

- Existing authored rows with a non-empty `Title` are never ingestion candidates.
- A new blank inbox row can be identified using only `Source URL`.
- Fetching rejects non-HTTP(S), credential-bearing and non-public network destinations, including redirects.
- Responses are bounded by timeout, content type, redirect count and maximum bytes.
- Only English HTML articles are accepted in v1.
- Extracted content is normalized into the safe Notion block subset used by the translation pipeline.
- Canonical URL and source hash are recorded separately from the stable Translation Group identity.
- Duplicates and unsupported sources fail closed with an `Ingestion Status` and reason.
- Successful ingestion ends at `Draft` + `Test` + `Translation Status=Source` + `Rights Status=Unknown`.
- The ingestion workflow does not call OpenAI, create translation drafts, approve content or publish content.
- Translation remains separately gated by the existing Transmith workflow.
