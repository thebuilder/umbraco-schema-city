using System.Text.Json;
using Microsoft.Extensions.Options;
using SchemaCity.Manifest;

namespace SchemaCity.Tests;

public class RelationshipsTabManifestReaderTests
{
    private static RelationshipsTabManifestReader Reader(bool relationshipsTab) =>
        new(Options.Create(new SchemaCityOptions { RelationshipsTab = relationshipsTab }));

    [Fact]
    public async Task Registers_the_tab_on_the_Document_Type_editor_by_default()
    {
        RelationshipsTabManifestReader reader = new(Options.Create(new SchemaCityOptions()));

        var manifest = Assert.Single(await reader.ReadPackageManifestsAsync());
        var extension = JsonSerializer.SerializeToElement(Assert.Single(manifest.Extensions));

        Assert.Equal("workspaceView", extension.GetProperty("type").GetString());
        Assert.Equal("SchemaCity.DocumentTypeView", extension.GetProperty("alias").GetString());
        Assert.Equal("/App_Plugins/SchemaCity/document-type-view.js", extension.GetProperty("element").GetString());
        Assert.Equal("Relationships", extension.GetProperty("meta").GetProperty("label").GetString());
        Assert.Equal(
            "Umb.Workspace.DocumentType",
            extension.GetProperty("conditions")[0].GetProperty("match").GetString());
    }

    [Fact]
    public async Task Registers_nothing_when_appsettings_turns_the_tab_off()
    {
        Assert.Empty(await Reader(relationshipsTab: false).ReadPackageManifestsAsync());
        Assert.Single(await Reader(relationshipsTab: true).ReadPackageManifestsAsync());
    }
}
