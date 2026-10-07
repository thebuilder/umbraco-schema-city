using System.Text.Json;
using SchemaCity.Graph;
using SchemaCity.Models;
using Umbraco.Cms.Core.Models;
using Umbraco.Cms.Core.PropertyEditors;
using Umbraco.Cms.Core.Strings;

namespace SchemaCity.Tests;

public class SchemaGraphBuilderTests
{
    private static readonly Guid FolderKey = Guid.Parse("11111111-1111-1111-1111-111111111111");
    private static readonly Guid HomeKey = Guid.Parse("22222222-2222-2222-2222-222222222222");
    private static readonly Guid BannerKey = Guid.Parse("33333333-3333-3333-3333-333333333333");

    [Fact]
    public void BuildGraph_reads_identity_behaviour_and_folder_from_the_content_types()
    {
        EntityContainer folder = new(Umbraco.Cms.Core.Constants.ObjectTypes.DocumentType)
        {
            Id = 1050,
            Key = FolderKey,
            Name = "Pages",
            ParentId = -1,
        };

        // Sits in the folder, is a real page, can be a root, and carries an icon colour.
        ContentType home = NewContentType(1100, HomeKey, "home", "Home", parentId: folder.Id);
        home.Icon = "icon-home color-blue";
        home.AllowedAsRoot = true;
        home.Variations = ContentVariation.Culture;

        // Sits at the tree root, is an Element Type, and has no icon colour.
        ContentType banner = NewContentType(1101, BannerKey, "banner", "Banner", parentId: -1);
        banner.Icon = "icon-picture";
        banner.IsElement = true;

        SchemaGraph graph = SchemaGraphBuilder.BuildGraph([home, banner], [folder], []);

        SchemaFolder onlyFolder = Assert.Single(graph.Folders);
        Assert.Equal(FolderKey.ToString(), onlyFolder.Id);
        Assert.Equal("Pages", onlyFolder.Name);
        Assert.Null(onlyFolder.ParentId);

        // Nodes come back sorted by alias, so banner is first.
        Assert.Equal(["banner", "home"], graph.Nodes.Select(n => n.Alias));

        SchemaNode bannerNode = graph.Nodes[0];
        Assert.True(bannerNode.IsElement);
        Assert.False(bannerNode.AllowedAsRoot);
        Assert.Equal("icon-picture", bannerNode.Icon);
        Assert.Null(bannerNode.IconColor);
        Assert.Null(bannerNode.FolderId);

        SchemaNode homeNode = graph.Nodes[1];
        Assert.Equal(HomeKey.ToString(), homeNode.Id);
        Assert.False(homeNode.IsElement);
        Assert.True(homeNode.AllowedAsRoot);
        Assert.Equal("icon-home", homeNode.Icon);
        Assert.Equal("color-blue", homeNode.IconColor);
        Assert.Equal(FolderKey.ToString(), homeNode.FolderId);
        Assert.True(homeNode.VariesByCulture);
        Assert.False(homeNode.VariesBySegment);
        Assert.Equal(0, homeNode.OwnPropertyCount);
        Assert.Equal(0, homeNode.ComposedPropertyCount);
        Assert.Empty(homeNode.Templates);
    }

    /// <summary>
    /// Own tabs and groups keep editor order, a nested group carries its tab as parentAlias, and a
    /// composed property lands in its own group tagged with the composition it came from.
    /// </summary>
    [Fact]
    public void BuildGraph_orders_groups_and_marks_composed_properties_with_their_origin()
    {
        Guid compositionKey = Guid.Parse("44444444-4444-4444-4444-444444444444");
        ContentType seo = NewContentType(1200, compositionKey, "seoComposition", "Seo", parentId: -1);
        seo.AddPropertyType(NewProperty("seoTitle", id: 1), "seo", "Seo");

        Guid articleKey = Guid.Parse("55555555-5555-5555-5555-555555555555");
        ContentType article = NewContentType(1201, articleKey, "article", "Article", parentId: -1);
        article.AddPropertyType(NewProperty("title", id: 2), "content", "Content");
        article.AddPropertyType(NewProperty("intro", id: 3), "content", "Content");
        article.PropertyGroups["content"].Type = PropertyGroupType.Tab;
        article.AddPropertyType(NewProperty("layout", id: 4), "content/details", "Details");
        article.AddPropertyType(NewProperty("legacyField", id: 5));
        article.AddContentType(seo);

        SchemaGraph graph = SchemaGraphBuilder.BuildGraph([article, seo], [], []);
        SchemaNode articleNode = Assert.Single(graph.Nodes, n => n.Alias == "article");

        Assert.Equal(["content", "details", "no-group", "seo"], articleNode.Groups.Select(g => g.Alias));

        var contentTab = articleNode.Groups[0];
        Assert.Equal("Tab", contentTab.Type);
        Assert.Null(contentTab.ParentAlias);
        Assert.Null(contentTab.FromCompositionId);
        Assert.Equal(["title", "intro"], contentTab.Properties.Select(p => p.Alias));
        Assert.All(contentTab.Properties, p => Assert.Null(p.FromCompositionId));

        var details = articleNode.Groups[1];
        Assert.Equal("content", details.ParentAlias);
        Assert.Null(details.FromCompositionId);

        var noGroup = articleNode.Groups[2];
        Assert.Equal(["legacyField"], noGroup.Properties.Select(p => p.Alias));

        var composedGroup = articleNode.Groups[3];
        Assert.Equal(compositionKey.ToString(), composedGroup.FromCompositionId);
        SchemaProperty composedProperty = Assert.Single(composedGroup.Properties);
        Assert.Equal("seoTitle", composedProperty.Alias);
        Assert.Equal(compositionKey.ToString(), composedProperty.FromCompositionId);

        Assert.Equal(4, articleNode.OwnPropertyCount);
        Assert.Equal(1, articleNode.ComposedPropertyCount);
    }

    /// <summary>
    /// A composition tab that holds only groups, tab "seo" with group "seo/meta", still reaches
    /// the user, so its groups have a tab to sit in.
    /// </summary>
    [Fact]
    public void BuildGraph_emits_a_composition_tab_that_only_holds_groups()
    {
        Guid seoKey = Guid.Parse("45454545-4545-4545-4545-454545454545");
        ContentType seo = NewContentType(1210, seoKey, "seoTabComposition", "Seo Tab", parentId: -1);
        seo.AddPropertyGroup("seo", "SEO");
        seo.PropertyGroups["seo"].Type = PropertyGroupType.Tab;
        seo.AddPropertyType(NewProperty("metaTitle", id: 40), "seo/meta", "Meta");
        seo.AddPropertyGroup("empty", "Empty");
        seo.PropertyGroups["empty"].Type = PropertyGroupType.Tab;

        ContentType page = NewContentType(1211, Guid.Parse("56565656-5656-5656-5656-565656565656"), "page", "Page", parentId: -1);
        page.AddContentType(seo);

        SchemaGraph graph = SchemaGraphBuilder.BuildGraph([page, seo], [], []);
        SchemaNode pageNode = Assert.Single(graph.Nodes, n => n.Alias == "page");

        Assert.Equal(["seo", "meta"], pageNode.Groups.Select(g => g.Alias));
        Assert.Equal("Tab", pageNode.Groups[0].Type);
        Assert.Empty(pageNode.Groups[0].Properties);
        Assert.Equal(seoKey.ToString(), pageNode.Groups[0].FromCompositionId);
        Assert.Equal("seo", pageNode.Groups[1].ParentAlias);
    }

    /// <summary>A property whose Data Type is not in the list says so with a null name.</summary>
    [Fact]
    public void BuildGraph_leaves_the_data_type_name_null_when_the_data_type_is_missing()
    {
        ContentType home = NewContentType(1220, HomeKey, "home", "Home", parentId: -1);
        home.AddPropertyType(NewProperty("title", id: 41), "content", "Content");

        SchemaGraph graph = SchemaGraphBuilder.BuildGraph([home], [], []);

        SchemaProperty title = graph.Nodes.Single().Groups.SelectMany(g => g.Properties).Single();
        Assert.Null(title.DataTypeName);
        Assert.Null(title.EditorUiAlias);
    }

    /// <summary>
    /// A type that inherits from another one still finds the properties its parent in turn
    /// composes in, and gets both a composition edge and an inherits edge to that parent.
    /// </summary>
    [Fact]
    public void BuildGraph_walks_the_composition_chain_and_emits_inherits_and_composition_edges()
    {
        Guid seoKey = Guid.Parse("66666666-6666-6666-6666-666666666666");
        ContentType seo = NewContentType(1300, seoKey, "seoComposition", "Seo", parentId: -1);
        seo.AddPropertyType(NewProperty("seoTitle", id: 10), "seo", "Seo");

        Guid articleKey = Guid.Parse("77777777-7777-7777-7777-777777777777");
        ContentType article = NewContentType(1301, articleKey, "article", "Article", parentId: -1);
        article.AddPropertyType(NewProperty("body", id: 11), "content", "Content");
        article.AddContentType(seo);

        Guid pressReleaseKey = Guid.Parse("88888888-8888-8888-8888-888888888888");
        ContentType pressRelease = new(ShortStringHelper, article, "pressRelease")
        {
            Id = 1302,
            Key = pressReleaseKey,
            Name = "Press Release",
        };

        SchemaGraph graph = SchemaGraphBuilder.BuildGraph([article, seo, pressRelease], [], []);
        SchemaNode pressReleaseNode = Assert.Single(graph.Nodes, n => n.Alias == "pressRelease");

        // The seo property comes from two levels up, through article, and still gets a group.
        Assert.Equal(0, pressReleaseNode.OwnPropertyCount);
        Assert.Equal(2, pressReleaseNode.ComposedPropertyCount);
        SchemaProperty[] composedProperties = pressReleaseNode.Groups.SelectMany(g => g.Properties).ToArray();
        Assert.Equal(["body", "seoTitle"], composedProperties.Select(p => p.Alias).OrderBy(a => a, StringComparer.Ordinal));

        Assert.Contains(graph.Edges, e => e.Kind == EdgeKind.Inherits && e.From == pressReleaseKey.ToString() && e.To == articleKey.ToString());
        Assert.Contains(graph.Edges, e => e.Kind == EdgeKind.Composition && e.From == pressReleaseKey.ToString() && e.To == articleKey.ToString());
    }

    /// <summary>A block editor property gets a target and the graph gets a block edge for it.</summary>
    [Fact]
    public void BuildGraph_emits_a_block_edge_and_a_property_target_for_a_block_editor()
    {
        Guid elementKey = Guid.Parse("99999999-9999-9999-9999-999999999999");
        ContentType element = NewContentType(1400, elementKey, "elementCard", "Card", parentId: -1);
        element.IsElement = true;

        var dataType = new FakeDataType(new BlockListConfiguration
        {
            Blocks = [new() { ContentElementTypeKey = elementKey }],
        })
        {
            Name = "Page Blocks",
        };

        Guid hostKey = Guid.Parse("10101010-1010-1010-1010-101010101010");
        ContentType host = NewContentType(1401, hostKey, "home", "Home", parentId: -1);
        host.AddPropertyType(NewProperty("body", dataType, id: 20), "content", "Content");

        SchemaGraph graph = SchemaGraphBuilder.BuildGraph([host, element], [], [dataType]);
        SchemaNode hostNode = Assert.Single(graph.Nodes, n => n.Alias == "home");
        SchemaProperty bodyProperty = hostNode.Groups.SelectMany(g => g.Properties).Single();
        Assert.Equal("Page Blocks", bodyProperty.DataTypeName);

        SchemaTarget target = Assert.Single(bodyProperty.Targets);
        Assert.Equal(elementKey.ToString(), target.NodeId);
        Assert.Equal(BlockEditorInspector.ContentRole, target.Role);

        Assert.Contains(
            graph.Edges,
            e => e.Kind == EdgeKind.Block && e.From == hostKey.ToString() && e.To == elementKey.ToString()
                && e.PropertyAlias == "body" && e.Role == BlockEditorInspector.ContentRole);
    }

    /// <summary>
    /// Data Types come back whether a property uses them or not, with the keys a block editor
    /// offers even once the Element Type is gone, the folder path, and the uses the graph has no
    /// node for.
    /// </summary>
    [Fact]
    public void BuildGraph_lists_every_data_type_with_its_targets_folder_and_other_uses()
    {
        Guid elementKey = Guid.Parse("99999999-9999-9999-9999-999999999999");
        Guid goneKey = Guid.Parse("98989898-9898-9898-9898-989898989898");
        ContentType element = NewContentType(1600, elementKey, "elementCard", "Card", parentId: -1);
        element.IsElement = true;

        EntityContainer blocksFolder = new(Umbraco.Cms.Core.Constants.ObjectTypes.DataType) { Id = 70, Name = "Blocks", ParentId = -1 };
        EntityContainer gridsFolder = new(Umbraco.Cms.Core.Constants.ObjectTypes.DataType) { Id = 71, Name = "Grids", ParentId = 70 };

        var grid = new FakeDataType(new BlockGridConfiguration
        {
            GridColumns = 12,
            Blocks = [new() { ContentElementTypeKey = elementKey }, new() { ContentElementTypeKey = goneKey }],
        })
        {
            Name = "Page Grid",
            EditorAlias = "Umbraco.BlockGrid",
            ParentId = 71,
        };
        var unused = new FakeDataType(new object()) { Name = "Unused Text" };
        var mediaOnly = new FakeDataType(new object()) { Name = "Upload" };

        ContentType host = NewContentType(1601, HomeKey, "home", "Home", parentId: -1);
        host.AddPropertyType(NewProperty("grid", grid, id: 40), "content", "Content");
        MediaType image = new(ShortStringHelper, -1) { Id = 1602, Key = Guid.NewGuid(), Alias = "image", Name = "Image" };
        image.AddPropertyType(NewProperty("file", mediaOnly, id: 41), "media", "Media");

        SchemaGraph graph = SchemaGraphBuilder.BuildGraph(
            [host, element], [], [unused, grid, mediaOnly], [blocksFolder, gridsFolder], [image]);

        Assert.Equal(["Page Grid", "Unused Text", "Upload"], graph.DataTypes.Select(d => d.Name));

        SchemaDataType gridType = graph.DataTypes[0];
        Assert.Equal(grid.Key.ToString(), gridType.Id);
        Assert.Equal("Umbraco.BlockGrid", gridType.EditorAlias);
        Assert.Equal("Blocks/Grids", gridType.Folder);
        Assert.Equal([elementKey.ToString(), goneKey.ToString()], gridType.Targets.Select(t => t.NodeId));
        Assert.Equal(12, gridType.Configuration?["gridColumns"]);
        Assert.Equal(2, gridType.Configuration?["blocks"]);
        Assert.Equal(0, gridType.OtherUses);

        SchemaDataType unusedType = graph.DataTypes[1];
        Assert.Null(unusedType.Folder);
        Assert.Empty(unusedType.Targets);
        Assert.Null(unusedType.Configuration);
        Assert.Equal(0, unusedType.OtherUses);

        Assert.Equal(1, graph.DataTypes[2].OtherUses);
        Assert.DoesNotContain(graph.DataTypes, d => d.IsBuiltIn);
    }

    /// <summary>
    /// Built-in Data Types are recognised by Umbraco's own keys, both the ones it exposes as Guid
    /// fields and the ones it exposes only as strings, such as Label (bytes).
    /// </summary>
    [Fact]
    public void BuildGraph_marks_the_data_types_umbraco_installs_itself()
    {
        var textstring = new FakeDataType(new object())
        {
            Key = Umbraco.Cms.Core.Constants.DataTypes.Guids.TextstringGuid,
            Name = "Textstring",
        };
        var labelBytes = new FakeDataType(new object())
        {
            Key = Guid.Parse(Umbraco.Cms.Core.Constants.DataTypes.Guids.LabelBytes),
            Name = "Label (bytes)",
        };
        var own = new FakeDataType(new object()) { Name = "Page Blocks" };

        SchemaGraph graph = SchemaGraphBuilder.BuildGraph([], [], [textstring, labelBytes, own]);

        Assert.Equal(
            [("Label (bytes)", true), ("Page Blocks", false), ("Textstring", true)],
            graph.DataTypes.Select(d => (d.Name, d.IsBuiltIn)));
    }

    /// <summary>Building the same content types twice has to produce byte-identical JSON.</summary>
    [Fact]
    public void BuildGraph_is_deterministic()
    {
        // A real install assigns a stable database key to a property group once and keeps it on
        // every read; AddPropertyType on a fresh, unsaved ContentType hands out a new random key
        // each time instead, so the factory pins one here to reproduce what persistence gives for
        // free, rather than testing an artifact of building unsaved models twice.
        Guid groupKey = Guid.Parse("99001100-9900-1100-9900-110099001100");

        ContentType Build()
        {
            ContentType type = NewContentType(1500, Guid.Parse("11223344-1122-3344-1122-334411223344"), "home", "Home", parentId: -1);
            type.AddPropertyType(NewProperty("title", id: 30), "content", "Content");
            type.PropertyGroups["content"].Key = groupKey;
            return type;
        }

        SchemaGraph first = SchemaGraphBuilder.BuildGraph([Build()], [], []);
        SchemaGraph second = SchemaGraphBuilder.BuildGraph([Build()], [], []);

        JsonSerializerOptions options = new() { PropertyNamingPolicy = JsonNamingPolicy.CamelCase };
        string firstJson = JsonSerializer.Serialize(first with { GeneratedAt = DateTimeOffset.UnixEpoch }, options);
        string secondJson = JsonSerializer.Serialize(second with { GeneratedAt = DateTimeOffset.UnixEpoch }, options);

        Assert.Equal(firstJson, secondJson);
    }

    /// <summary>
    /// A review decision reopens when its subject's fingerprint changes, so the fingerprint has to
    /// be the same on every run and move when the type's properties or connections do. The pinned
    /// value catches a change to the rule itself, which would reopen every stored decision.
    /// </summary>
    [Fact]
    public void Fingerprint_is_stable_and_follows_properties_and_connections()
    {
        // The shared default Data Type gets a new key every run, so this one has a fixed key.
        FakeDataType text = new(new object()) { Key = Guid.Parse("88888888-8888-8888-8888-888888888888") };
        ContentType home = NewContentType(1100, HomeKey, "home", "Home", parentId: -1);
        home.AddPropertyType(NewProperty("title", text, id: 1), "content", "Content");
        home.PropertyGroups["content"].Key = Guid.Parse("66666666-6666-6666-6666-666666666666");
        ContentType banner = NewContentType(1101, BannerKey, "banner", "Banner", parentId: -1);

        string Of(SchemaGraph graph, Guid key) => graph.Nodes.Single(n => n.Id == key.ToString()).Fingerprint!;

        SchemaGraph before = SchemaGraphBuilder.BuildGraph([home, banner], [], []);
        Assert.Equal(Of(before, HomeKey), Of(SchemaGraphBuilder.BuildGraph([home, banner], [], []), HomeKey));
        Assert.Equal("ce33d3efe11e4508", Of(before, HomeKey));

        // A new property changes the type's fingerprint and leaves the unrelated one alone.
        home.AddPropertyType(NewProperty("intro", text, id: 2), "content", "Content");
        SchemaGraph withProperty = SchemaGraphBuilder.BuildGraph([home, banner], [], []);
        Assert.NotEqual(Of(before, HomeKey), Of(withProperty, HomeKey));
        Assert.Equal(Of(before, BannerKey), Of(withProperty, BannerKey));

        // An allowed child is an edge, so it changes the fingerprint at both ends.
        home.AllowedContentTypes = [new ContentTypeSort(BannerKey, 0, "banner")];
        SchemaGraph withChild = SchemaGraphBuilder.BuildGraph([home, banner], [], []);
        Assert.NotEqual(Of(withProperty, HomeKey), Of(withChild, HomeKey));
        Assert.NotEqual(Of(withProperty, BannerKey), Of(withChild, BannerKey));
    }

    [Fact]
    public void Fingerprint_of_a_data_type_follows_its_own_record()
    {
        FakeDataType dataType = new(new object())
        {
            Key = Guid.Parse("77777777-7777-7777-7777-777777777777"),
            Name = "Spare",
        };
        string? Of() => Assert.Single(SchemaGraphBuilder.BuildGraph([], [], [dataType]).DataTypes).Fingerprint;

        string? before = Of();
        Assert.NotNull(before);
        Assert.Equal(before, Of());
        dataType.Name = "Spare text";
        Assert.NotEqual(before, Of());
    }

    private static PropertyType NewProperty(string alias, int id) =>
        NewProperty(alias, DefaultDataType, id);

    private static PropertyType NewProperty(string alias, IDataType dataType, int id) =>
        new(ShortStringHelper, dataType, alias) { Id = id, Name = alias };

    private static readonly IDataType DefaultDataType = new FakeDataType(new object());

    private static ContentType NewContentType(int id, Guid key, string alias, string name, int parentId) =>
        new(ShortStringHelper, parentId)
        {
            Id = id,
            Key = key,
            Alias = alias,
            Name = name,
        };

    private static readonly IShortStringHelper ShortStringHelper = new PassThroughShortStringHelper();

    /// <summary>
    /// ContentType needs a short string helper to clean the alias it is given. The graph builder
    /// only ever reads aliases back, so handing the input through unchanged keeps the test's
    /// aliases exactly what the test wrote.
    /// </summary>
    private sealed class PassThroughShortStringHelper : IShortStringHelper
    {
        public string CleanString(string text, CleanStringType stringType) => text;

        public string CleanString(string text, CleanStringType stringType, char separator) => text;

        public string CleanString(string text, CleanStringType stringType, string culture) => text;

        public string CleanString(string text, CleanStringType stringType, char separator, string culture) => text;

        public string CleanStringForSafeAlias(string text) => text;

        public string CleanStringForSafeAlias(string text, string culture) => text;

        public string CleanStringForSafeFileName(string text) => text;

        public string CleanStringForSafeFileName(string text, string culture) => text;

        public string CleanStringForUrlSegment(string text) => text;

        public string CleanStringForUrlSegment(string text, string? culture) => text;

        public string SplitPascalCasing(string text, char separator) => text;
    }
}
