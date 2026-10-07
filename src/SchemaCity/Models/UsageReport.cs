using System.Text.Json.Serialization;

namespace SchemaCity.Models;

/// <summary>
/// What the content actually does, per Document Type. Mirrored by UsageReport in
/// Client/src/model/types.ts, which is the contract. Property names here have to keep matching it.
/// ByType is keyed by Document Type key, the same string SchemaNode.Id carries, and holds a row for
/// every Document Type, so a type with no content reads as zeros rather than as a missing key.
/// Blocks is omitted only by callers that did not count them; the endpoint always sends it.
/// </summary>
public record UsageReport(
    DateTimeOffset GeneratedAt,
    IReadOnlyDictionary<string, TypeUsage> ByType,
    IReadOnlyList<TypeReference> References,
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] BlockUsage? Blocks = null);

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

/// <summary>
/// Block instances stored in content, per block editor Data Type. Read from the latest version of
/// every content item that is not in the recycle bin, published or draft. Partial is true when the
/// count stopped at its row cap or time budget, or failed, so the numbers are a lower bound.
/// ValuesRead is how many property values were looked at, Unreadable how many of them were not
/// valid JSON.
/// </summary>
public record BlockUsage(
    bool Partial,
    int ValuesRead,
    int Unreadable,
    IReadOnlyList<DataTypeBlocks> ByDataType);

/// <summary>
/// One Data Type's stored blocks. Values is the number of its property values that hold any JSON,
/// Items the content items with at least one block in it. A nested block editor has items but can
/// have no values of its own, since its blocks live inside another editor's value.
/// </summary>
public record DataTypeBlocks(
    string DataTypeId,
    int Values,
    int Items,
    IReadOnlyList<ElementBlocks> Elements);

/// <summary>
/// How many blocks of one Element Type a Data Type holds, as content and as settings, and on how
/// many content items. The Element Type can be one the Data Type no longer offers, or one that no
/// longer exists.
/// </summary>
public record ElementBlocks(string ElementTypeId, int Content, int Settings, int Items);
