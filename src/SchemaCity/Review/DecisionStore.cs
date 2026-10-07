using System.Text.Json;
using System.Text.RegularExpressions;
using SchemaCity.Models;
using Umbraco.Cms.Core.Services;

namespace SchemaCity.Review;

/// <summary>
/// Review decisions in Umbraco's key-value table, one row per finding under
/// <see cref="KeyPrefix"/>, with the decision as JSON. That table is app data Umbraco already
/// has in 17 and 18, so the package needs no migration, and nothing here reads or writes a
/// content type, a Data Type or content.
/// </summary>
public sealed partial class DecisionStore
{
    public const string KeyPrefix = "SchemaCity.Decision.";

    public const int MaxReasonLength = 500;

    private readonly IKeyValueService _keyValues;

    public DecisionStore(IKeyValueService keyValues) => _keyValues = keyValues;

    /// <summary>"kind:key", the shape of every finding id the client makes.</summary>
    [GeneratedRegex("^[A-Za-z]{1,64}:[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$")]
    private static partial Regex FindingIdPattern();

    public static bool IsFindingId(string? id) => id is not null && FindingIdPattern().IsMatch(id);

    /// <summary>The key of the type or Data Type a finding id is about.</summary>
    public static string SubjectOf(string findingId) => findingId[(findingId.IndexOf(':') + 1)..];

    /// <summary>The reason trimmed, or null when it is empty or longer than the limit.</summary>
    public static string? CleanReason(string? reason) =>
        reason?.Trim() is { Length: > 0 and <= MaxReasonLength } trimmed ? trimmed : null;

    /// <summary>Every decision, by finding id. A blank or unreadable row is skipped.</summary>
    public IReadOnlyList<ReviewDecision> All() =>
        (_keyValues.FindByKeyPrefix(KeyPrefix) ?? new Dictionary<string, string?>())
            .Values
            .Select(Read)
            .OfType<ReviewDecision>()
            .OrderBy(d => d.FindingId, StringComparer.Ordinal)
            .ToArray();

    public void Save(ReviewDecision decision) =>
        _keyValues.SetValue(KeyPrefix + decision.FindingId, JsonSerializer.Serialize(decision, JsonSerializerOptions.Web));

    // ponytail: IKeyValueService has no delete, so undo blanks the row and All skips blanks. That
    // leaves one empty row per finding ever decided; delete through IKeyValueRepository in a
    // scope if those rows ever matter.
    public void Remove(string findingId)
    {
        string key = KeyPrefix + findingId;
        if (string.IsNullOrEmpty(_keyValues.GetValue(key)) is false)
        {
            _keyValues.SetValue(key, string.Empty);
        }
    }

    private static ReviewDecision? Read(string? json)
    {
        if (string.IsNullOrEmpty(json))
        {
            return null;
        }

        try
        {
            return JsonSerializer.Deserialize<ReviewDecision>(json, JsonSerializerOptions.Web);
        }
        catch (JsonException)
        {
            return null;
        }
    }
}
