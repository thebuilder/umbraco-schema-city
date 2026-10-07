using SchemaCity.Models;
using SchemaCity.Review;
using Umbraco.Cms.Core.Services;

namespace SchemaCity.Tests;

public class DecisionStoreTests
{
    private const string FindingId = "duplicateAlias:22222222-2222-2222-2222-222222222222";

    private static ReviewDecision Decision(string findingId = FindingId, string reason = "Kept for the old import") =>
        new(findingId, "intentional", reason, "Ada", Guid.Parse("99999999-9999-9999-9999-999999999999"),
            DateTimeOffset.Parse("2026-10-07T08:41:00Z"), "0123456789abcdef");

    [Fact]
    public void Saves_lists_and_removes_decisions_under_its_own_prefix()
    {
        MemoryKeyValues keyValues = new();
        keyValues.SetValue("Umbraco.Core.Upgrader.State+Umbraco.Core", "{something else}");
        DecisionStore store = new(keyValues);

        store.Save(Decision());
        store.Save(Decision("unusedDataType:77777777-7777-7777-7777-777777777777", "Used by a package"));

        Assert.Equal(
            ["duplicateAlias:22222222-2222-2222-2222-222222222222", "unusedDataType:77777777-7777-7777-7777-777777777777"],
            store.All().Select(d => d.FindingId));
        Assert.Equal(Decision(), store.All()[0]);
        Assert.StartsWith("{\"findingId\":", keyValues.GetValue(DecisionStore.KeyPrefix + FindingId));

        store.Remove(FindingId);
        Assert.Equal(["Used by a package"], store.All().Select(d => d.Reason));

        // Removing twice, or something never decided, is not an error.
        store.Remove(FindingId);
        store.Remove("deadEnd:22222222-2222-2222-2222-222222222222");
        Assert.Single(store.All());
    }

    [Fact]
    public void Skips_rows_it_cannot_read()
    {
        MemoryKeyValues keyValues = new();
        keyValues.SetValue(DecisionStore.KeyPrefix + "broken", "not json");
        keyValues.SetValue(DecisionStore.KeyPrefix + "blank", string.Empty);
        DecisionStore store = new(keyValues);
        store.Save(Decision());

        Assert.Equal([FindingId], store.All().Select(d => d.FindingId));
    }

    [Theory]
    [InlineData("duplicateAlias:22222222-2222-2222-2222-222222222222", true)]
    [InlineData("unusedDataType:77777777-7777-7777-7777-777777777777", true)]
    [InlineData("duplicateAlias:not-a-key", false)]
    [InlineData("22222222-2222-2222-2222-222222222222", false)]
    [InlineData("dead End:22222222-2222-2222-2222-222222222222", false)]
    [InlineData("", false)]
    [InlineData(null, false)]
    public void Accepts_only_finding_ids(string? id, bool expected) =>
        Assert.Equal(expected, DecisionStore.IsFindingId(id));

    [Fact]
    public void Trims_the_reason_and_refuses_an_empty_or_long_one()
    {
        Assert.Equal("Kept on purpose", DecisionStore.CleanReason("  Kept on purpose \n"));
        Assert.Null(DecisionStore.CleanReason("   "));
        Assert.Null(DecisionStore.CleanReason(null));
        Assert.Equal(500, DecisionStore.CleanReason(new string('a', 500))?.Length);
        Assert.Null(DecisionStore.CleanReason(new string('a', 501)));
        Assert.Equal("22222222-2222-2222-2222-222222222222", DecisionStore.SubjectOf(FindingId));
    }

    /// <summary>The key-value table as a dictionary, with Umbraco's prefix match.</summary>
    private sealed class MemoryKeyValues : IKeyValueService
    {
        private readonly Dictionary<string, string?> _rows = [];

        public string? GetValue(string key) => _rows.GetValueOrDefault(key);

        public IReadOnlyDictionary<string, string?>? FindByKeyPrefix(string keyPrefix) =>
            _rows.Where(row => row.Key.StartsWith(keyPrefix, StringComparison.Ordinal))
                .ToDictionary(row => row.Key, row => row.Value);

        public void SetValue(string key, string value) => _rows[key] = value;

        public void SetValue(string key, string originalValue, string newValue) => _rows[key] = newValue;

        public bool TrySetValue(string key, string originalValue, string newValue)
        {
            _rows[key] = newValue;
            return true;
        }
    }
}
