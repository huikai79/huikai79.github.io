export const VALID_SOURCE_USES = new Set([
  "Original / Reference",
  "Excerpt",
  "Translation",
  "Republication",
  "Adaptation"
]);

export const UNRESOLVED_RIGHTS_STATUSES = new Set([
  "",
  "Unknown",
  "Private Use",
  "Needs Review"
]);

function text(value) {
  return String(value || "").trim();
}

function policyStateForUse(sourceUse, policy = {}) {
  if (sourceUse === "Translation") return text(policy.fullTranslation) || "unknown";
  if (sourceUse === "Republication") return text(policy.fullRepublication) || "unknown";
  return "";
}

export function publicationRightsAdvisory(candidate = {}, policy = {}) {
  const findings = [];
  if (text(candidate.visibility) !== "Public") {
    return { findings, reviewRequired: false, policyState: "" };
  }

  const sourceUrl = text(candidate.sourceUrl);
  const sourceUse = text(candidate.sourceUse);
  const rightsStatus = text(candidate.rightsStatus);

  if (!sourceUrl) {
    if (sourceUse && sourceUse !== "Original / Reference") {
      findings.push({
        code: "source-use-without-source-url",
        message: `Source Use=${sourceUse} requires an external Source URL or a reviewed exception.`
      });
    }
    return { findings, reviewRequired: findings.length > 0, policyState: "" };
  }

  if (!sourceUse) {
    findings.push({
      code: "source-use-missing",
      message: "External-source public content should declare Source Use before rights enforcement is enabled."
    });
    return { findings, reviewRequired: true, policyState: "" };
  }

  if (!VALID_SOURCE_USES.has(sourceUse)) {
    findings.push({
      code: "source-use-invalid",
      message: `Unsupported Source Use=${sourceUse}.`
    });
    return { findings, reviewRequired: true, policyState: "" };
  }

  if (sourceUse === "Original / Reference") {
    return { findings, reviewRequired: false, policyState: "" };
  }

  const unresolved = UNRESOLVED_RIGHTS_STATUSES.has(rightsStatus);
  const policyState = policyStateForUse(sourceUse, policy);

  if (unresolved) {
    findings.push({
      code: "rights-status-unresolved",
      message:
        `Source Use=${sourceUse} has unresolved Rights Status=${rightsStatus || "EMPTY"}` +
        `${policyState ? `; registry policy=${policyState}` : ""}.`
    });
  }

  return { findings, reviewRequired: findings.length > 0, policyState };
}
