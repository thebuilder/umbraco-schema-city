using SchemaCity.Models;
using Umbraco.Cms.Core.Models;
using Umbraco.Cms.Core.PropertyEditors;

namespace SchemaCity.Graph;

/// <summary>
/// Reads the Element Type keys out of the Data Types that can hold or point at other content
/// types, so a property can say what it contains. Every block editor's configuration object
/// exposes its rows as <see cref="IBlockConfiguration"/>, so matching on the configuration type
/// covers Block List, Block Grid, Rich Text blocks and the single block editor in one switch,
/// without a second list of editor aliases to keep in step.
/// </summary>
public static class BlockEditorInspector
{
    public const string ContentRole = "content";

    public const string SettingsRole = "settings";

    public const string PickerRole = "picker";

    /// <summary>
    /// Which content type keys each Data Type targets, keyed by Data Type key. Data Types that
    /// target nothing are left out. A key that no longer resolves to a content type stays in the
    /// list, because that is what the client reports as a broken block reference.
    /// </summary>
    /// <remarks>
    /// This does not recurse into the Data Types used by the Element Types it finds, and it does
    /// not need to. A nested block editor is a property on an Element Type, and that Element Type
    /// is a node in the graph whose own properties get inspected in the same pass, so the nesting
    /// is already there as a chain of block edges. A visited set would only matter if this ever
    /// tried to flatten that chain onto the outer property.
    /// </remarks>
    public static Dictionary<Guid, SchemaTarget[]> Index(IEnumerable<IDataType> dataTypes)
    {
        Dictionary<Guid, SchemaTarget[]> byDataTypeKey = [];

        foreach (IDataType dataType in dataTypes)
        {
            SchemaTarget[] targets = TargetsOf(dataType);
            if (targets.Length > 0)
            {
                byDataTypeKey[dataType.Key] = targets;
            }
        }

        return byDataTypeKey;
    }

    /// <summary>
    /// A few configuration values worth seeing beside a Data Type's name, for the editors this
    /// already reads, or null for any other editor. Limits Umbraco stores as unset are left out.
    /// </summary>
    public static IReadOnlyDictionary<string, object>? Summary(IDataType dataType)
    {
        Dictionary<string, object?>? summary = ConfigurationOf(dataType) switch
        {
            BlockListConfiguration c => new()
            {
                ["blocks"] = c.Blocks?.Length ?? 0,
                ["min"] = c.ValidationLimit?.Min,
                ["max"] = c.ValidationLimit?.Max,
            },
            BlockGridConfiguration c => new()
            {
                ["blocks"] = c.Blocks?.Length ?? 0,
                ["gridColumns"] = c.GridColumns,
                ["min"] = c.ValidationLimit?.Min,
                ["max"] = c.ValidationLimit?.Max,
            },
            RichTextConfiguration c => new() { ["blocks"] = c.Blocks?.Length ?? 0 },
            SingleBlockConfiguration c => new() { ["blocks"] = c.Blocks?.Length ?? 0 },
            MultiNodePickerConfiguration c => new()
            {
                ["min"] = c.MinNumber > 0 ? c.MinNumber : null,
                ["max"] = c.MaxNumber > 0 ? c.MaxNumber : null,
            },
            _ => null,
        };

        return summary?
            .Where(entry => entry.Value is not null)
            .ToDictionary(entry => entry.Key, entry => entry.Value!, StringComparer.Ordinal);
    }

    private static object? ConfigurationOf(IDataType dataType)
    {
        try
        {
            return dataType.ConfigurationObject;
        }
        catch (Exception)
        {
            // ponytail: a Data Type whose stored configuration no longer matches its editor throws
            // while deserialising, and one bad row should not empty the whole graph. Skipping it
            // loses that editor's block edges silently. Turn it into a finding of its own if a real
            // install hits it.
            return null;
        }
    }

    /// <summary>The block or picker targets of one Data Type, in configuration order, without repeats.</summary>
    public static SchemaTarget[] TargetsOf(IDataType dataType) =>
        (ConfigurationOf(dataType) switch
        {
            // BlockListConfiguration also covers single block mode, which is the same editor with
            // UseSingleBlockMode set. SingleBlockConfiguration is the separate Umbraco.SingleBlock
            // editor and exists on 17.0.0 upwards.
            BlockListConfiguration c => Blocks(c.Blocks),
            BlockGridConfiguration c => Blocks(c.Blocks),
            RichTextConfiguration c => Blocks(c.Blocks),
            SingleBlockConfiguration c => Blocks(c.Blocks),
            MultiNodePickerConfiguration c => Picked(c.Filter),
            _ => [],
        }).Distinct().ToArray();

    private static IEnumerable<SchemaTarget> Blocks(IEnumerable<IBlockConfiguration>? blocks)
    {
        foreach (IBlockConfiguration block in blocks ?? [])
        {
            // A block row saved before an Element Type was chosen carries an empty key.
            if (block.ContentElementTypeKey != Guid.Empty)
            {
                yield return new SchemaTarget(block.ContentElementTypeKey.ToString(), ContentRole);
            }

            if (block.SettingsElementTypeKey is Guid settings && settings != Guid.Empty)
            {
                yield return new SchemaTarget(settings.ToString(), SettingsRole);
            }
        }
    }

    /// <summary>
    /// The Multi Node Tree Picker keeps its allowed Document Types in Filter as a comma separated
    /// list of keys. PLAN.md section 4 says aliases; it is keys, and an entry that is not a Guid
    /// is ignored rather than guessed at.
    /// </summary>
    private static IEnumerable<SchemaTarget> Picked(string? filter) =>
        (filter ?? string.Empty)
            .Split(',', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries)
            .Select(entry => Guid.TryParse(entry, out Guid key) ? key : Guid.Empty)
            .Where(key => key != Guid.Empty)
            .Select(key => new SchemaTarget(key.ToString(), PickerRole));
}
