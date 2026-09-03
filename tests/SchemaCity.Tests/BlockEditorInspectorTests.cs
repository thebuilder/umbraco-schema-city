using SchemaCity.Graph;
using SchemaCity.Models;
using Umbraco.Cms.Core.Models;
using Umbraco.Cms.Core.Models.Entities;
using Umbraco.Cms.Core.PropertyEditors;

namespace SchemaCity.Tests;

public class BlockEditorInspectorTests
{
    private static readonly Guid ContentKey = Guid.Parse("aaaaaaaa-0000-0000-0000-000000000001");
    private static readonly Guid SettingsKey = Guid.Parse("aaaaaaaa-0000-0000-0000-000000000002");
    private static readonly Guid DanglingKey = Guid.Parse("aaaaaaaa-0000-0000-0000-000000000003");

    [Fact]
    public void Index_reads_content_and_settings_keys_from_a_block_list()
    {
        var dataType = new FakeDataType(new BlockListConfiguration
        {
            Blocks = [new() { ContentElementTypeKey = ContentKey, SettingsElementTypeKey = SettingsKey }],
        });

        SchemaTarget[] targets = SingleResult(dataType);

        Assert.Equal(
            [new SchemaTarget(ContentKey.ToString(), BlockEditorInspector.ContentRole), new SchemaTarget(SettingsKey.ToString(), BlockEditorInspector.SettingsRole)],
            targets);
    }

    [Fact]
    public void Index_reads_a_block_grid()
    {
        var dataType = new FakeDataType(new BlockGridConfiguration
        {
            Blocks = [new() { ContentElementTypeKey = ContentKey }],
        });

        Assert.Equal([new SchemaTarget(ContentKey.ToString(), BlockEditorInspector.ContentRole)], SingleResult(dataType));
    }

    [Fact]
    public void Index_reads_rich_text_blocks()
    {
        var dataType = new FakeDataType(new RichTextConfiguration
        {
            Blocks = [new() { ContentElementTypeKey = ContentKey }],
        });

        Assert.Equal([new SchemaTarget(ContentKey.ToString(), BlockEditorInspector.ContentRole)], SingleResult(dataType));
    }

    [Fact]
    public void Index_reads_a_single_block_editor()
    {
        var dataType = new FakeDataType(new SingleBlockConfiguration
        {
            Blocks = [new() { ContentElementTypeKey = ContentKey }],
        });

        Assert.Equal([new SchemaTarget(ContentKey.ToString(), BlockEditorInspector.ContentRole)], SingleResult(dataType));
    }

    /// <summary>
    /// A block row saved before an Element Type still resolves the Data Type is not the block
    /// inspector's concern: <see cref="DeleteDoomedElementType"/>-style deletion is what the
    /// client's broken-block-reference finding reacts to. The inspector's job is only to keep
    /// naming the key, whether or not it still resolves.
    /// </summary>
    [Fact]
    public void Index_keeps_a_dangling_element_type_key()
    {
        var dataType = new FakeDataType(new BlockListConfiguration
        {
            Blocks = [new() { ContentElementTypeKey = DanglingKey }],
        });

        Assert.Equal([new SchemaTarget(DanglingKey.ToString(), BlockEditorInspector.ContentRole)], SingleResult(dataType));
    }

    [Fact]
    public void Index_reads_the_multi_node_tree_picker_filter_as_document_type_keys()
    {
        var dataType = new FakeDataType(new MultiNodePickerConfiguration { Filter = $"{ContentKey},{SettingsKey}" });

        Assert.Equal(
            [new SchemaTarget(ContentKey.ToString(), BlockEditorInspector.PickerRole), new SchemaTarget(SettingsKey.ToString(), BlockEditorInspector.PickerRole)],
            SingleResult(dataType));
    }

    /// <summary>
    /// The Multi Node Tree Picker filter is a comma separated list of Document Type keys, not
    /// aliases. An entry that does not parse as a Guid, such as a legacy alias-based filter, is
    /// ignored rather than guessed at.
    /// </summary>
    [Fact]
    public void Index_ignores_a_non_guid_filter_entry()
    {
        var dataType = new FakeDataType(new MultiNodePickerConfiguration { Filter = $"article,{ContentKey}" });

        Assert.Equal([new SchemaTarget(ContentKey.ToString(), BlockEditorInspector.PickerRole)], SingleResult(dataType));
    }

    [Fact]
    public void Index_leaves_out_a_data_type_with_no_targets()
    {
        var dataType = new FakeDataType(new BlockListConfiguration { Blocks = [] });

        Dictionary<Guid, SchemaTarget[]> index = BlockEditorInspector.Index([dataType]);

        Assert.Empty(index);
    }

    private static SchemaTarget[] SingleResult(IDataType dataType)
    {
        Dictionary<Guid, SchemaTarget[]> index = BlockEditorInspector.Index([dataType]);
        return Assert.Single(index).Value;
    }
}

/// <summary>
/// The block inspector only reads <see cref="IDataType.Key"/> and
/// <see cref="IDataType.ConfigurationObject"/>, and the graph builder also reads
/// <see cref="IDataType.EditorUiAlias"/>, so this leaves everything else unimplemented rather than
/// wiring up the real property editor pipeline the seeder needs. Shared with
/// <see cref="SchemaGraphBuilderTests"/>.
/// </summary>
internal sealed class FakeDataType(object configuration) : IDataType
{
        public Guid Key { get; set; } = Guid.NewGuid();

        public int Id { get; set; } = 1;

        public bool HasIdentity => true;

        public object ConfigurationObject => configuration;

        public string? EditorUiAlias { get; set; } = string.Empty;

        public string EditorAlias { get; set; } = "Umbraco.TextBox";

        public IDataEditor? Editor { get => throw new NotSupportedException(); set => throw new NotSupportedException(); }

        public ValueStorageType DatabaseType { get; set; } = ValueStorageType.Nvarchar;

        public IDictionary<string, object> ConfigurationData { get => throw new NotSupportedException(); set => throw new NotSupportedException(); }

        public IDataType DeepCloneWithResetIdentities() => throw new NotSupportedException();

        public void SetParent(ITreeEntity? parent) => throw new NotSupportedException();

        public string? Name { get => throw new NotSupportedException(); set => throw new NotSupportedException(); }

        public int CreatorId { get => throw new NotSupportedException(); set => throw new NotSupportedException(); }

        public int ParentId { get => throw new NotSupportedException(); set => throw new NotSupportedException(); }

        public int Level { get => throw new NotSupportedException(); set => throw new NotSupportedException(); }

        public string Path { get => throw new NotSupportedException(); set => throw new NotSupportedException(); }

        public int SortOrder { get => throw new NotSupportedException(); set => throw new NotSupportedException(); }

        public bool Trashed => throw new NotSupportedException();

        public void ResetIdentity() => throw new NotSupportedException();


        public DateTime CreateDate { get => throw new NotSupportedException(); set => throw new NotSupportedException(); }

        public DateTime UpdateDate { get => throw new NotSupportedException(); set => throw new NotSupportedException(); }

        public DateTime? DeleteDate { get => throw new NotSupportedException(); set => throw new NotSupportedException(); }


        public object DeepClone() => throw new NotSupportedException();

        public bool WasDirty() => throw new NotSupportedException();

        public bool WasPropertyDirty(string propertyName) => throw new NotSupportedException();

        public void ResetWereDirtyProperties() => throw new NotSupportedException();

        public void ResetDirtyProperties(bool rememberDirty) => throw new NotSupportedException();

        public void ResetDirtyProperties() => throw new NotSupportedException();

#pragma warning disable CS0067 // required by ICanBeDirty, never raised by this test double
        public event System.ComponentModel.PropertyChangedEventHandler? PropertyChanged;
#pragma warning restore CS0067

        public IEnumerable<string> GetWereDirtyProperties() => throw new NotSupportedException();

        public bool IsDirty() => throw new NotSupportedException();

        public bool IsPropertyDirty(string propertyName) => throw new NotSupportedException();

        public IEnumerable<string> GetDirtyProperties() => throw new NotSupportedException();

        public void DisableChangeTracking() => throw new NotSupportedException();

        public void EnableChangeTracking() => throw new NotSupportedException();
}
