using System.Diagnostics;
using System.Text.Json;
using SchemaCity.Models;

namespace SchemaCity.Usage;

/// <summary>
/// Counts the block instances stored in block editor property values, per Data Type and Element
/// Type. It reads only as much of each value as it needs: the contentTypeKey of every item in
/// contentData and settingsData, and the property values of those items, where a nested block
/// editor keeps its own blocks. Both the Umbraco 14+ shape, where an item's properties sit in a
/// values array, and the older one, where they are keys on the item, are read.
/// </summary>
public static class BlockCounter
{
    /// <summary>Keys on an old-format block item that are not property aliases.</summary>
    private static readonly HashSet<string> ItemKeys = new(StringComparer.Ordinal) { "contentTypeKey", "udi", "key" };

    /// <summary>
    /// Every row until <paramref name="maxValues"/> rows or <paramref name="budget"/> have gone,
    /// after which the result says it is partial. <paramref name="dataTypeOf"/> maps an Element
    /// Type key and a property alias to the Data Type that property uses, which is how a nested
    /// block value is credited to its own editor. A nested value whose property it cannot find is
    /// credited to the outer Data Type, so the blocks in it are still counted somewhere.
    /// </summary>
    public static BlockUsage Count(
        IEnumerable<ValueRow> rows,
        IReadOnlyDictionary<(Guid ElementType, string Alias), Guid> dataTypeOf,
        int maxValues,
        TimeSpan budget)
    {
        var tally = new Tally(dataTypeOf);
        Stopwatch clock = Stopwatch.StartNew();
        bool partial = false;

        foreach (ValueRow row in rows)
        {
            if (tally.ValuesRead >= maxValues || clock.Elapsed > budget)
            {
                partial = true;
                break;
            }

            tally.Read(row);
        }

        return tally.Result(partial);
    }

    /// <summary>One stored property value of a block editor, on the latest version of a content item.</summary>
    public sealed class ValueRow
    {
        public int NodeId { get; set; }

        public Guid DataTypeKey { get; set; }

        public string? Value { get; set; }
    }

    private sealed class Tally(IReadOnlyDictionary<(Guid ElementType, string Alias), Guid> dataTypeOf)
    {
        private readonly Dictionary<Guid, (int Values, HashSet<int> Items)> _byDataType = [];
        private readonly Dictionary<(Guid DataType, Guid ElementType), (int Content, int Settings, HashSet<int> Items)> _byElement = [];
        private int _unreadable;
        private int _node;

        public int ValuesRead { get; private set; }

        public void Read(ValueRow row)
        {
            ValuesRead++;

            // An empty editor, or rich text saved as bare markup before it could hold blocks.
            if (row.Value is null || row.Value.TrimStart().StartsWith('{') is false)
            {
                return;
            }

            _node = row.NodeId;
            (int values, HashSet<int> items) = _byDataType.GetValueOrDefault(row.DataTypeKey, (0, []));
            _byDataType[row.DataTypeKey] = (values + 1, items);

            try
            {
                using JsonDocument document = JsonDocument.Parse(row.Value);
                Walk(document.RootElement, row.DataTypeKey);
            }
            catch (JsonException)
            {
                // Hand-edited or truncated JSON says nothing about its blocks. It is counted, so the
                // report can say how many values it could not read, and the rest carry on.
                _unreadable++;
            }
        }

        /// <summary>
        /// A block value is an object with contentData and settingsData, or a rich text value whose
        /// blocks hold that object. Anything else holds no blocks.
        /// </summary>
        private void Walk(JsonElement value, Guid dataType)
        {
            if (value.ValueKind == JsonValueKind.String)
            {
                // Older versions stored a nested block value as a JSON string inside the outer one.
                string text = value.GetString() ?? string.Empty;
                if (text.TrimStart().StartsWith('{'))
                {
                    using JsonDocument nested = JsonDocument.Parse(text);
                    Walk(nested.RootElement, dataType);
                }

                return;
            }

            if (value.ValueKind != JsonValueKind.Object)
            {
                return;
            }

            if (value.TryGetProperty("blocks", out JsonElement blocks))
            {
                Walk(blocks, dataType);
            }

            Items(value, "contentData", dataType, settings: false);
            Items(value, "settingsData", dataType, settings: true);
        }

        private void Items(JsonElement value, string name, Guid dataType, bool settings)
        {
            if (value.TryGetProperty(name, out JsonElement items) is false || items.ValueKind != JsonValueKind.Array)
            {
                return;
            }

            foreach (JsonElement item in items.EnumerateArray())
            {
                if (item.ValueKind != JsonValueKind.Object)
                {
                    continue;
                }

                Guid elementType = item.TryGetProperty("contentTypeKey", out JsonElement key)
                    && key.ValueKind == JsonValueKind.String
                    && Guid.TryParse(key.GetString(), out Guid parsed)
                    ? parsed
                    : Guid.Empty;
                if (elementType != Guid.Empty)
                {
                    Add(dataType, elementType, settings);
                }

                foreach ((string alias, JsonElement nested) in Properties(item))
                {
                    Walk(nested, dataTypeOf.GetValueOrDefault((elementType, alias), dataType));
                }
            }
        }

        /// <summary>An item's property values, from a values array or, in the older shape, its own keys.</summary>
        private static IEnumerable<(string Alias, JsonElement Value)> Properties(JsonElement item)
        {
            if (item.TryGetProperty("values", out JsonElement values) && values.ValueKind == JsonValueKind.Array)
            {
                foreach (JsonElement entry in values.EnumerateArray())
                {
                    if (entry.ValueKind == JsonValueKind.Object
                        && entry.TryGetProperty("alias", out JsonElement alias)
                        && entry.TryGetProperty("value", out JsonElement value))
                    {
                        yield return (alias.GetString() ?? string.Empty, value);
                    }
                }

                yield break;
            }

            foreach (JsonProperty property in item.EnumerateObject())
            {
                if (ItemKeys.Contains(property.Name) is false)
                {
                    yield return (property.Name, property.Value);
                }
            }
        }

        private void Add(Guid dataType, Guid elementType, bool settings)
        {
            (int content, int settingsCount, HashSet<int> items) =
                _byElement.GetValueOrDefault((dataType, elementType), (0, 0, []));
            items.Add(_node);
            _byElement[(dataType, elementType)] = settings
                ? (content, settingsCount + 1, items)
                : (content + 1, settingsCount, items);

            // A nested Data Type may have no top-level value of its own, but it still has items.
            (int values, HashSet<int> dataTypeItems) = _byDataType.GetValueOrDefault(dataType, (0, []));
            dataTypeItems.Add(_node);
            _byDataType[dataType] = (values, dataTypeItems);
        }

        /// <summary>Sorted by key throughout, because the seeded site exports this to a fixture.</summary>
        public BlockUsage Result(bool partial) =>
            new(
                partial,
                ValuesRead,
                _unreadable,
                _byDataType
                    .OrderBy(entry => entry.Key.ToString(), StringComparer.Ordinal)
                    .Select(entry => new DataTypeBlocks(
                        entry.Key.ToString(),
                        entry.Value.Values,
                        entry.Value.Items.Count,
                        _byElement
                            .Where(element => element.Key.DataType == entry.Key)
                            .OrderBy(element => element.Key.ElementType.ToString(), StringComparer.Ordinal)
                            .Select(element => new ElementBlocks(
                                element.Key.ElementType.ToString(),
                                element.Value.Content,
                                element.Value.Settings,
                                element.Value.Items.Count))
                            .ToArray()))
                    .ToArray());
    }
}
