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
        });

        Guid hostKey = Guid.Parse("10101010-1010-1010-1010-101010101010");
        ContentType host = NewContentType(1401, hostKey, "home", "Home", parentId: -1);
        host.AddPropertyType(NewProperty("body", dataType, id: 20), "content", "Content");

        SchemaGraph graph = SchemaGraphBuilder.BuildGraph([host, element], [], [dataType]);
        SchemaNode hostNode = Assert.Single(graph.Nodes, n => n.Alias == "home");
        SchemaProperty bodyProperty = hostNode.Groups.SelectMany(g => g.Properties).Single();

        SchemaTarget target = Assert.Single(bodyProperty.Targets);
        Assert.Equal(elementKey.ToString(), target.NodeId);
        Assert.Equal(BlockEditorInspector.ContentRole, target.Role);

        Assert.Contains(
            graph.Edges,
            e => e.Kind == EdgeKind.Block && e.From == hostKey.ToString() && e.To == elementKey.ToString()
                && e.PropertyAlias == "body" && e.Role == BlockEditorInspector.ContentRole);
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
