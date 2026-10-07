using SchemaCity.Models;
using SchemaCity.Usage;

namespace SchemaCity.Tests;

/// <summary>
/// The JSON samples follow what Umbraco stores: the 14+ shape with a values array per block item,
/// the older shape with properties as keys and nested values as strings, and rich text that keeps
/// its blocks next to the markup.
/// </summary>
public class BlockCounterTests
{
    private static readonly Guid BodyBlocks = Guid.Parse("b0000000-0000-0000-0000-000000000001");
    private static readonly Guid PageGrid = Guid.Parse("b0000000-0000-0000-0000-000000000002");
    private static readonly Guid RichText = Guid.Parse("b0000000-0000-0000-0000-000000000003");
    private static readonly Guid InnerList = Guid.Parse("b0000000-0000-0000-0000-000000000004");

    private const string Card = "e0000000-0000-0000-0000-000000000001";
    private const string Quote = "e0000000-0000-0000-0000-000000000002";
    private const string Settings = "e0000000-0000-0000-0000-000000000003";
    private const string Accordion = "e0000000-0000-0000-0000-000000000004";

    private static readonly Dictionary<(Guid, string), Guid> NoLookup = [];

    [Fact]
    public void Counts_content_and_settings_blocks_and_the_items_holding_them()
    {
        string value = $$"""
            {
              "layout": { "Umbraco.BlockList": [{ "contentKey": "c1", "settingsKey": "s1" }, { "contentKey": "c2" }] },
              "contentData": [
                { "key": "c1", "contentTypeKey": "{{Card}}", "values": [{ "alias": "title", "value": "Hello" }] },
                { "key": "c2", "contentTypeKey": "{{Card}}", "values": [] }
              ],
              "settingsData": [{ "key": "s1", "contentTypeKey": "{{Settings}}", "values": [] }],
              "expose": []
            }
            """;

        BlockUsage usage = Count([Row(1, BodyBlocks, value), Row(2, BodyBlocks, value)]);

        DataTypeBlocks body = Assert.Single(usage.ByDataType);
        Assert.Equal(2, body.Values);
        Assert.Equal(2, body.Items);
        Assert.Equal(
            [new ElementBlocks(Card, 4, 0, 2), new ElementBlocks(Settings, 0, 2, 2)],
            body.Elements);
        Assert.False(usage.Partial);
        Assert.Equal(2, usage.ValuesRead);
    }

    /// <summary>A grid keeps area items in the same contentData list, so they count once each.</summary>
    [Fact]
    public void Counts_block_grid_area_items_and_rich_text_blocks()
    {
        string grid = $$"""
            {
              "layout": { "Umbraco.BlockGrid": [{ "contentKey": "row", "areas": [{ "key": "a", "items": [{ "contentKey": "q" }] }] }] },
              "contentData": [
                { "key": "row", "contentTypeKey": "{{Card}}", "values": [] },
                { "key": "q", "contentTypeKey": "{{Quote}}", "values": [] }
              ],
              "settingsData": []
            }
            """;
        string rich = $$"""
            {
              "markup": "<p>Text</p><umb-rte-block data-content-key=\"q\"></umb-rte-block>",
              "blocks": { "layout": {}, "contentData": [{ "key": "q", "contentTypeKey": "{{Quote}}", "values": [] }], "settingsData": [] }
            }
            """;

        BlockUsage usage = Count([Row(1, PageGrid, grid), Row(1, RichText, rich)]);

        Assert.Equal([Card, Quote], Elements(usage, PageGrid).Select(e => e.ElementTypeId));
        Assert.Equal([new ElementBlocks(Quote, 1, 0, 1)], Elements(usage, RichText));
    }

    /// <summary>
    /// A block list inside a card is credited to the inner list's own Data Type, found through the
    /// card's property, in both the current shape and the older one that stores it as a string.
    /// </summary>
    [Fact]
    public void Credits_nested_blocks_to_the_nested_editor_in_both_shapes()
    {
        string inner = $$"""{ "layout": {}, "contentData": [{ "contentTypeKey": "{{Accordion}}", "values": [] }, { "contentTypeKey": "{{Accordion}}", "values": [] }], "settingsData": [] }""";
        string current = $$"""
            {
              "contentData": [{ "contentTypeKey": "{{Card}}", "values": [{ "alias": "items", "value": {{inner}} }] }],
              "settingsData": []
            }
            """;
        string older = $$"""
            {
              "contentData": [{ "contentTypeKey": "{{Card}}", "udi": "umb://element/1", "items": {{System.Text.Json.JsonSerializer.Serialize(inner)}} }],
              "settingsData": []
            }
            """;
        Dictionary<(Guid, string), Guid> lookup = new() { [(Guid.Parse(Card), "items")] = InnerList };

        BlockUsage usage = BlockCounter.Count(
            [Row(1, BodyBlocks, current), Row(2, BodyBlocks, older)], lookup, int.MaxValue, TimeSpan.FromMinutes(1));

        Assert.Equal([new ElementBlocks(Card, 2, 0, 2)], Elements(usage, BodyBlocks));
        Assert.Equal([new ElementBlocks(Accordion, 4, 0, 2)], Elements(usage, InnerList));

        // The inner list has items but no value of its own.
        DataTypeBlocks innerList = Assert.Single(usage.ByDataType, d => d.DataTypeId == InnerList.ToString());
        Assert.Equal(0, innerList.Values);
        Assert.Equal(2, innerList.Items);
    }

    [Fact]
    public void Credits_a_nested_value_it_cannot_place_to_the_outer_editor()
    {
        string value = $$"""
            {
              "contentData": [{ "contentTypeKey": "{{Card}}", "values": [{ "alias": "unknown", "value": { "contentData": [{ "contentTypeKey": "{{Quote}}" }] } }] }]
            }
            """;

        BlockUsage usage = Count([Row(1, BodyBlocks, value)]);

        Assert.Equal([Card, Quote], Elements(usage, BodyBlocks).Select(e => e.ElementTypeId));
    }

    /// <summary>
    /// Malformed JSON is counted as unreadable and skipped, markup without blocks and empty values
    /// are not block values at all, and an item without a usable key adds nothing.
    /// </summary>
    [Fact]
    public void Skips_malformed_values_markup_and_items_without_a_key()
    {
        string good = $$"""{ "contentData": [{ "contentTypeKey": "{{Card}}" }, { "contentTypeKey": "not a guid" }, 7] }""";

        BlockUsage usage = Count(
        [
            Row(1, BodyBlocks, "{ \"contentData\": [ { \"contentTypeKey\": "),
            Row(2, RichText, "<p>Only markup</p>"),
            Row(3, BodyBlocks, string.Empty),
            Row(4, BodyBlocks, "{ \"contentData\": \"not a list\" }"),
            Row(5, BodyBlocks, good),
        ]);

        Assert.Equal(5, usage.ValuesRead);
        Assert.Equal(1, usage.Unreadable);
        Assert.Equal([new ElementBlocks(Card, 1, 0, 1)], Elements(usage, BodyBlocks));
        Assert.DoesNotContain(usage.ByDataType, d => d.DataTypeId == RichText.ToString());
    }

    [Fact]
    public void Stops_at_the_row_cap_and_says_the_count_is_partial()
    {
        string value = $$"""{ "contentData": [{ "contentTypeKey": "{{Card}}" }] }""";

        BlockUsage usage = BlockCounter.Count(
            [Row(1, BodyBlocks, value), Row(2, BodyBlocks, value), Row(3, BodyBlocks, value)],
            NoLookup,
            maxValues: 2,
            TimeSpan.FromMinutes(1));

        Assert.True(usage.Partial);
        Assert.Equal(2, usage.ValuesRead);
        Assert.Equal([new ElementBlocks(Card, 2, 0, 2)], Elements(usage, BodyBlocks));
    }

    [Fact]
    public void Stops_when_the_time_budget_is_spent()
    {
        BlockUsage usage = BlockCounter.Count([Row(1, BodyBlocks, "{}")], NoLookup, int.MaxValue, TimeSpan.FromTicks(-1));

        Assert.True(usage.Partial);
        Assert.Equal(0, usage.ValuesRead);
    }

    private static BlockUsage Count(IEnumerable<BlockCounter.ValueRow> rows) =>
        BlockCounter.Count(rows, NoLookup, int.MaxValue, TimeSpan.FromMinutes(1));

    private static IReadOnlyList<ElementBlocks> Elements(BlockUsage usage, Guid dataType) =>
        Assert.Single(usage.ByDataType, d => d.DataTypeId == dataType.ToString()).Elements;

    private static BlockCounter.ValueRow Row(int node, Guid dataType, string value) =>
        new() { NodeId = node, DataTypeKey = dataType, Value = value };
}
