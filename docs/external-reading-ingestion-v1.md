# External Reading Ingestion v1

## User workflow

1. Open the Notion view `📥 外文閱讀收件箱`.
2. Create an empty row and paste only `Source URL`.
3. Leave `Title` empty. The scheduled ingestion worker only claims rows with an empty Title.
4. The worker either fills the Source page and marks it `Ready`, or records `Needs Review` / `Duplicate` with a reason.
5. Translation remains a separate, manually approved Transmith step. Ingestion never calls a paid translation model and never publishes content.

## Supported in v1

- Public HTTP/HTTPS pages.
- Ordinary English HTML articles that expose enough readable article text.
- Metadata extraction for title, author, source publication time, canonical URL, retrieval time and source hash.
- Safe Notion body subset: headings, paragraphs, lists, quotes and code.
- Stable translation identity based on the Notion Source page id.
- Source revision/dedup evidence using a content hash.

## Deliberately unsupported in v1

- Paywalls, login-required pages, CAPTCHA / challenge bypass.
- PDF, video, audio, social embeds and JavaScript-only pages.
- Non-English source languages.
- Arbitrary HTML fidelity, tables, iframes or interactive widgets.
- Automatic translation, approval or publication.
- Automatic rights determination.

Unsupported or uncertain inputs fail closed to `Needs Review` rather than being force-imported.

## Safety boundary

A pending ingestion row must satisfy all of the following:

- `Source URL` is set.
- `Title` is empty.
- `Ingestion Status` is empty.
- `Translation Source` is empty.

The worker re-checks the retrieved page before writing body content. Existing authored articles with titles are therefore outside the ingestion candidate set even if they already have a Source URL.

URL fetching validates schemes, credentials, DNS/IP results, redirects, response type, timeout and maximum response size before article extraction. The scheduled workflow checks out `main` with read-only repository permissions and contains no OpenAI or translation-apply credential path.

## Output state

Successful ingestion writes the canonical Source page as:

- `status = Draft`
- `Visibility = Test`
- `Language = en`
- `Translation Status = Source`
- `Translate To = zh-TW, zh-CN`
- `Rights Status = Unknown`
- `Ingestion Status = Ready`

This state is translation-ready after the Slice A contract refactor, but remains publication-ineligible until the separate editorial/publication contract is satisfied.
