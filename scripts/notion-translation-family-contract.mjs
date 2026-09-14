export function translationFamilyContractIssues({ group, members = [], sourceRecordsById = new Map() } = {}) {
  const issues = [];
  const canonicalIds = new Set();

  for (const member of members) {
    if (member.translationStatus === "Source" && member.pageId) {
      canonicalIds.add(member.pageId);
    }
    if (member.translationStatus === "Approved" && member.translationSourceIds?.length === 1) {
      canonicalIds.add(member.translationSourceIds[0]);
    }
  }

  if (canonicalIds.size !== 1) {
    issues.push(`production family requires exactly one canonical Source; found ${canonicalIds.size}`);
    return issues;
  }

  const sourceId = [...canonicalIds][0];
  const source = sourceRecordsById.get(sourceId);
  if (!source) {
    issues.push(`canonical Source ${sourceId} could not be resolved`);
    return issues;
  }

  if (source.translationStatus !== "Source") {
    issues.push(`canonical Source ${sourceId} has Translation Status ${source.translationStatus || "missing"}`);
  }
  if (source.translationGroup !== group) {
    issues.push(
      `canonical Source ${sourceId} belongs to Translation Group ${source.translationGroup || "missing"}, expected ${group}`
    );
  }
  if (source.notionStatus !== "Published") {
    issues.push(`canonical Source ${sourceId} must be Published; found ${source.notionStatus || "missing"}`);
  }
  if (source.visibility !== "Public") {
    issues.push(`canonical Source ${sourceId} must be Public; found ${source.visibility || "missing"}`);
  }

  for (const member of members.filter(item => item.translationStatus === "Approved")) {
    if (member.translationSourceIds?.length !== 1 || member.translationSourceIds[0] !== sourceId) {
      issues.push(
        `${member.title || member.pageId} [${member.pageId}]: Approved translation must relate to canonical Source ${sourceId}`
      );
    }
  }

  return issues;
}
