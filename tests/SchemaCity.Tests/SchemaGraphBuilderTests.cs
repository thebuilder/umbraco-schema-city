using SchemaCity.Graph;
using SchemaCity.Models;
using Umbraco.Cms.Core.Models;
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

        SchemaGraph graph = SchemaGraphBuilder.BuildGraph([home, banner], [folder]);

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
