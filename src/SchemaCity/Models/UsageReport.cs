namespace SchemaCity.Models;

/// <summary>
/// What the content actually does, per Document Type. Mirrored by UsageReport in
/// Client/src/model/types.ts, which is the contract. Property names here have to keep matching it.
/// ByType is keyed by Document Type key, the same string SchemaNode.Id carries, and holds a row for
/// every Document Type, so a type with no content reads as zeros rather than as a missing key.
/// </summary>
public record UsageReport(
    DateTimeOffset GeneratedAt,
    IReadOnlyDictionary<string, TypeUsage> ByType,
    IReadOnlyList<TypeReference> References);

/// <summary>
/// Counts for one Document Type. Published, Drafts and Trashed partition Total: Umbraco unpublishes
/// on trash, so nothing is counted twice. Cultures holds the cultures with at least one variant,
/// sorted. LastEdited is the newest version date across all content of the type, server local time
/// the way Umbraco writes it, and null when the type has no content.
/// </summary>
public record TypeUsage(
    int Total,
    int Published,
    int Drafts,
    int Trashed,
    int RootInstances,
    IReadOnlyList<string> Cultures,
    DateTime? LastEdited);

/// <summary>
/// Instance-level references between two Document Types, aggregated. FromType is the type holding
/// the picker, ToType the type it points at.
/// </summary>
public record TypeReference(string FromType, string ToType, int Count);
