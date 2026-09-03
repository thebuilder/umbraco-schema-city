using SchemaCity.Models;
using Umbraco.Cms.Core.Events;
using Umbraco.Cms.Core.Models;
using Umbraco.Cms.Core.Notifications;
using Umbraco.Cms.Core.Services;

namespace SchemaCity.Graph;

/// <summary>
/// Turns the Document Types into a <see cref="SchemaGraph"/> and holds the last one until
/// Umbraco reports a content type or data type change. Both cache refresher notifications fire on
/// every server in a load balanced setup, so this needs nothing extra to stay in step.
/// </summary>
public sealed class SchemaGraphBuilder :
    INotificationHandler<ContentTypeCacheRefresherNotification>,
    INotificationHandler<DataTypeCacheRefresherNotification>
{
    private readonly IContentTypeService _contentTypeService;
    private SchemaGraph? _cached;

    public SchemaGraphBuilder(IContentTypeService contentTypeService) =>
        _contentTypeService = contentTypeService;

    // ponytail: no lock. Two threads racing here build the graph twice and one result wins,
    // which costs a few milliseconds. Add a Lazy if a profiler ever says it matters.
    public SchemaGraph Build() => _cached ??= BuildGraph(
        _contentTypeService.GetAll(),
        _contentTypeService.GetContainers([]));

    public void Handle(ContentTypeCacheRefresherNotification notification) => _cached = null;

    public void Handle(DataTypeCacheRefresherNotification notification) => _cached = null;

    /// <summary>
    /// The whole mapping, with no services in sight, so a test can hand it content types it built
    /// itself.
    /// </summary>
    public static SchemaGraph BuildGraph(IEnumerable<IContentType> contentTypes, IEnumerable<EntityContainer> containerList)
    {
        EntityContainer[] containers = containerList.ToArray();

        // Folders and Document Types share one tree, so a node's ParentId is either the folder
        // holding it, another Document Type it inherits from, or -1 at the root.
        Dictionary<int, Guid> folderKeysById = containers.ToDictionary(c => c.Id, c => c.Key);

        SchemaFolder[] folders = containers
            .Select(c => new SchemaFolder(
                c.Key.ToString(),
                c.Name ?? string.Empty,
                folderKeysById.TryGetValue(c.ParentId, out Guid parentKey) ? parentKey.ToString() : null))
            .OrderBy(f => f.Name, StringComparer.Ordinal)
            .ToArray();

        // Sorted by alias so the same schema always produces the same city.
        SchemaNode[] nodes = contentTypes
            .Select(t => ToNode(t, folderKeysById))
            .OrderBy(n => n.Alias, StringComparer.Ordinal)
            .ToArray();

        return new SchemaGraph(DateTimeOffset.UtcNow, folders, nodes);
    }

    private static SchemaNode ToNode(IContentType type, IReadOnlyDictionary<int, Guid> folderKeysById)
    {
        // Umbraco keeps the icon and its colour in one string, "icon-document color-blue".
        string icon = type.Icon ?? string.Empty;
        int space = icon.IndexOf(' ');

        // PropertyTypes is what this type declares itself; CompositionPropertyTypes adds
        // everything it inherits or composes in.
        int ownPropertyCount = type.PropertyTypes.Count();

        return new SchemaNode(
            Id: type.Key.ToString(),
            Alias: type.Alias ?? string.Empty,
            Name: type.Name ?? string.Empty,
            Icon: space < 0 ? icon : icon[..space],
            IconColor: space < 0 ? null : icon[(space + 1)..],
            FolderId: folderKeysById.TryGetValue(type.ParentId, out Guid folderKey) ? folderKey.ToString() : null,
            IsElement: type.IsElement,
            AllowedAsRoot: type.AllowedAsRoot,
            VariesByCulture: type.Variations.HasFlag(ContentVariation.Culture),
            VariesBySegment: type.Variations.HasFlag(ContentVariation.Segment),
            Description: type.Description,
            OwnPropertyCount: ownPropertyCount,
            ComposedPropertyCount: type.CompositionPropertyTypes.Count() - ownPropertyCount,
            Templates: (type.AllowedTemplates ?? [])
                .Select(t => new SchemaTemplate(
                    t.Key.ToString(),
                    t.Alias ?? string.Empty,
                    t.Name ?? string.Empty,
                    t.Id == type.DefaultTemplateId))
                .ToArray());
    }
}
