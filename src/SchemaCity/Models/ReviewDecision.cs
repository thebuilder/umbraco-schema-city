namespace SchemaCity.Models;

/// <summary>
/// A team's decision that a finding is intentional. Mirrored by Decision in
/// Client/src/model/review.ts. FindingId is the client's finding id, "kind:subjectKey". Status
/// is always "intentional" for now. Fingerprint is the subject's fingerprint when the decision
/// was made; once the graph's differs, the client shows the decision as reopened.
/// </summary>
public record ReviewDecision(
    string FindingId,
    string Status,
    string Reason,
    string DecidedBy,
    Guid DecidedByKey,
    DateTimeOffset DecidedAt,
    string Fingerprint);

/// <summary>The body of a PUT: the reason, and the subject's fingerprint as the client saw it.</summary>
public record DecisionRequest(string? Reason, string? Fingerprint);
