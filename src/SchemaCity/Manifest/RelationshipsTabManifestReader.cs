using Microsoft.Extensions.Options;
using Umbraco.Cms.Core.Manifest;
using Umbraco.Cms.Infrastructure.Manifest;

namespace SchemaCity.Manifest;

/// <summary>
/// Registers the Relationships tab on the Document Type editor. It is the one extension
/// not in umbraco-package.json, because a static manifest cannot read appsettings, and
/// <see cref="SchemaCityOptions.RelationshipsTab"/> has to be able to leave it out.
/// </summary>
public sealed class RelationshipsTabManifestReader(IOptions<SchemaCityOptions> options)
    : IPackageManifestReader
{
    public Task<IEnumerable<PackageManifest>> ReadPackageManifestsAsync()
    {
        if (!options.Value.RelationshipsTab)
            return Task.FromResult(Enumerable.Empty<PackageManifest>());

        PackageManifest manifest = new()
        {
            Name = "Schema City Relationships",
            // The package's own manifest already reports the install.
            AllowTelemetry = false,
            Extensions =
            [
                new
                {
                    type = "workspaceView",
                    alias = $"{Constants.ExtensionAliasPrefix}DocumentTypeView",
                    name = "Schema City Relationships View",
                    element = "/App_Plugins/SchemaCity/document-type-view.js",
                    weight = 50,
                    meta = new
                    {
                        label = "Relationships",
                        pathname = "relationships",
                        icon = "icon-company",
                    },
                    conditions = new[]
                    {
                        new { alias = "Umb.Condition.WorkspaceAlias", match = "Umb.Workspace.DocumentType" },
                    },
                },
            ],
        };
        return Task.FromResult<IEnumerable<PackageManifest>>([manifest]);
    }
}
