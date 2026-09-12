export function buildExternalIngestionCandidateFilter() {
  return {
    and: [
      { property: "Source URL", url: { is_not_empty: true } },
      { property: "Title", title: { is_empty: true } },
      { property: "Ingestion Status", select: { is_empty: true } },
      { property: "Translation Source", relation: { is_empty: true } }
    ]
  };
}

export function externalInboxViewFilterDescription() {
  return 'Source URL is set AND (Title is empty OR Ingestion Status is set)';
}
