# External Reading Ingestion v1 network boundary

The ingestion fetcher accepts only HTTP/HTTPS sources, rejects URL credentials and non-public network destinations, revalidates every redirect, pins each request to a DNS result that was checked before connection, and bounds timeout, redirect count, content type and response size. It does not bypass authentication, paywalls, CAPTCHA or challenge pages.
