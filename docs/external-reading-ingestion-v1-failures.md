# External Reading Ingestion v1 fail-closed outcomes

Inputs that cannot be safely or confidently imported must not be translated or published automatically. The worker records `Ingestion Status = Needs Review` and a concise `Ingestion Note` for conditions such as invalid/public-network-unsafe URLs, request failures, non-HTML responses, oversized responses, redirect overflow, unsupported languages, insufficient article text, or pre-existing page body content.

Duplicate canonical URLs or normalized source hashes are marked `Duplicate` and are not copied into another canonical Source page.
