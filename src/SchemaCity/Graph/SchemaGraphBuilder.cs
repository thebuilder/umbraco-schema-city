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
    private readonly IDataTypeService _dataTypeService;
    private SchemaGraph? _cached;

    public SchemaGraphBuilder(IContentTypeService contentTypeService, IDataTypeService dataTypeService)
    {
        _contentTypeService = contentTypeService;
        _dataTypeService = dataTypeService;
    }

    // ponytail: no lock. Two threads racing here build the graph twice and one result wins,
    // which costs a few milliseconds. Add a Lazy if a profiler ever says it matters.
    public SchemaGraph Build() => _cached ??= BuildGraph(
        _contentTypeService.GetAll(),
        _contentTypeService.GetContainers([]),
        _dataTypeService.GetAllAsync().GetAwaiter().GetResult());

    public void Handle(ContentTypeCacheRefresherNotification notification) => _cached = null;

    public void Handle(DataTypeCacheRefresherNotification notification) => _cached = null;

    /// <summary>
    /// The whole mapping, with no services in sight, so a test can hand it content types and data
    /// types it built itself.
    /// </summary>
    public static SchemaGraph BuildGraph(
        IEnumerable<IContentType> contentTypes,
        IEnumerable<EntityContainer> containerList,
        IEnumerable<IDataType> dataTypes)
    {
        EntityContainer[] containers = containerList.ToArray();
        IContentType[] types = contentTypes.ToArray();
        IDataType[] editors = dataTypes.ToArray();

        // Folders and Document Types share one tree, so a node's ParentId is either the folder
        // holding it, another Document Type it inherits from, or -1 at the root.
        Dictionary<int, Guid> folderKeysById = containers.ToDictionary(c => c.Id, c => c.Key);
        Dictionary<int, IContentType> typesById = types.ToDictionary(t => t.Id);
        Dictionary<Guid, IDataType> dataTypesByKey = editors.ToDictionary(d => d.Key);
        Dictionary<Guid, SchemaTarget[]> targetsByDataTypeKey = BlockEditorInspector.Index(editors);

        SchemaFolder[] folders = containers
            .Select(c => new SchemaFolder(
                c.Key.ToString(),
                c.Name ?? string.Empty,
                folderKeysById.TryGetValue(c.ParentId, out Guid parentKey) ? parentKey.ToString() : null))
            .OrderBy(f => f.Name, StringComparer.Ordinal)
            .ToArray();

        List<SchemaEdge> edges = [];

        // Sorted by alias so the same schema always produces the same city.
        SchemaNode[] nodes = types
            .Select(t => ToNode(t, folderKeysById, typesById, dataTypesByKey, targetsByDataTypeKey, edges))
            .OrderBy(n => n.Alias, StringComparer.Ordinal)
            .ToArray();

        SchemaEdge[] sortedEdges = edges
            .Distinct()
            .OrderBy(e => e.Kind)
            .ThenBy(e => e.From, StringComparer.Ordinal)
            .ThenBy(e => e.To, StringComparer.Ordinal)
            .ThenBy(e => e.PropertyAlias, StringComparer.Ordinal)
            .ToArray();

        return new SchemaGraph(DateTimeOffset.UtcNow, folders, nodes, sortedEdges);
    }

    private static SchemaNode ToNode(
        IContentType type,
        IReadOnlyDictionary<int, Guid> folderKeysById,
        IReadOnlyDictionary<int, IContentType> typesById,
        IReadOnlyDictionary<Guid, IDataType> dataTypesByKey,
        IReadOnlyDictionary<Guid, SchemaTarget[]> targetsByDataTypeKey,
        List<SchemaEdge> edges)
    {
        // Umbraco keeps the icon and its colour in one string, "icon-document color-blue".
        string icon = type.Icon ?? string.Empty;
        int space = icon.IndexOf(' ');
        string hostId = type.Key.ToString();

        HashSet<int> ownIds = type.PropertyTypes.Select(p => p.Id).ToHashSet();
        List<Models.PropertyGroup> groups = [];

        // Own tabs and groups, in editor order.
        foreach (Umbraco.Cms.Core.Models.PropertyGroup group in type.PropertyGroups.OrderBy(g => g.SortOrder))
        {
            groups.Add(ToGroup(group, null, group.PropertyTypes!, dataTypesByKey, targetsByDataTypeKey, hostId, edges));
        }

        IPropertyType[] ownNoGroup = type.NoGroupPropertyTypes.OrderBy(p => p.SortOrder).ToArray();
        if (ownNoGroup.Length > 0)
        {
            groups.Add(NoGroup(null, ownNoGroup, dataTypesByKey, targetsByDataTypeKey, hostId, edges));
        }

        // Composed properties and their origin. PLAN.md section 4 reads as a single, direct-level
        // walk of ContentTypeComposition, but a type that inherits from another type which itself
        // has compositions (pressRelease inherits article, article composes seoComposition) needs
        // those properties to land somewhere too, or ownPropertyCount and composedPropertyCount
        // stop matching what the groups actually contain. This walks the whole composition chain
        // breadth first, direct compositions before the ones they in turn compose, and attributes
        // each property to the nearest composition that actually declares it rather than to the
        // type in between.
        HashSet<int> claimedIds = new(ownIds);
        foreach (IContentTypeComposition composition in CompositionChain(type))
        {
            string compositionId = composition.Key.ToString();

            foreach (Umbraco.Cms.Core.Models.PropertyGroup group in composition.PropertyGroups.OrderBy(g => g.SortOrder))
            {
                IPropertyType[] contributed = group.PropertyTypes!
                    .OrderBy(p => p.SortOrder)
                    .Where(p => claimedIds.Add(p.Id))
                    .ToArray();
                if (contributed.Length > 0)
                {
                    groups.Add(ToGroup(group, compositionId, contributed, dataTypesByKey, targetsByDataTypeKey, hostId, edges));
                }
            }

            IPropertyType[] contributedNoGroup = composition.NoGroupPropertyTypes
                .OrderBy(p => p.SortOrder)
                .Where(p => claimedIds.Add(p.Id))
                .ToArray();
            if (contributedNoGroup.Length > 0)
            {
                groups.Add(NoGroup(compositionId, contributedNoGroup, dataTypesByKey, targetsByDataTypeKey, hostId, edges));
            }
        }

        foreach (ContentTypeSort child in type.AllowedContentTypes ?? [])
        {
            edges.Add(new SchemaEdge(EdgeKind.AllowedChild, hostId, child.Key.ToString()));
        }

        // Every direct composition, inheritance included: Umbraco models a Document Type's parent
        // as a composition too, so the inheriting type's ContentTypeComposition already contains
        // it and this loop emits that composition edge for free.
        foreach (IContentTypeComposition composition in type.ContentTypeComposition)
        {
            edges.Add(new SchemaEdge(EdgeKind.Composition, hostId, composition.Key.ToString()));
        }

        if (folderKeysById.ContainsKey(type.ParentId) is false
            && typesById.TryGetValue(type.ParentId, out IContentType? parent))
        {
            edges.Add(new SchemaEdge(EdgeKind.Inherits, hostId, parent.Key.ToString()));
        }

        return new SchemaNode(
            Id: hostId,
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
            Groups: groups,
            OwnPropertyCount: ownIds.Count,
            ComposedPropertyCount: claimedIds.Count - ownIds.Count,
            Templates: (type.AllowedTemplates ?? [])
                .Select(t => new SchemaTemplate(
                    t.Key.ToString(),
                    t.Alias ?? string.Empty,
                    t.Name ?? string.Empty,
                    t.Id == type.DefaultTemplateId))
                .ToArray());
    }

    /// <summary>
    /// Every composition reachable from <paramref name="type"/>, direct ones first, each visited
    /// once even if two branches compose the same type.
    /// </summary>
    private static List<IContentTypeComposition> CompositionChain(IContentTypeComposition type)
    {
        List<IContentTypeComposition> ordered = [];
        HashSet<Guid> visited = [];
        Queue<IContentTypeComposition> queue = new(type.ContentTypeComposition);

        while (queue.Count > 0)
        {
            IContentTypeComposition next = queue.Dequeue();
            if (visited.Add(next.Key) is false)
            {
                continue;
            }

            ordered.Add(next);
            foreach (IContentTypeComposition nested in next.ContentTypeComposition)
            {
                queue.Enqueue(nested);
            }
        }

        return ordered;
    }

    private static Models.PropertyGroup ToGroup(
        Umbraco.Cms.Core.Models.PropertyGroup group,
        string? fromCompositionId,
        IEnumerable<IPropertyType> properties,
        IReadOnlyDictionary<Guid, IDataType> dataTypesByKey,
        IReadOnlyDictionary<Guid, SchemaTarget[]> targetsByDataTypeKey,
        string hostId,
        List<SchemaEdge> edges)
    {
        // A group nested in a tab has an Umbraco alias of "tabAlias/groupAlias"; GetParentAlias
        // and GetLocalAlias split that back apart. GetParentAlias returns "" for a loose group or
        // a tab, which the contract wants as null.
        string parentAlias = group.GetParentAlias() ?? string.Empty;

        return new Models.PropertyGroup(
            Id: group.Key.ToString(),
            Alias: group.GetLocalAlias() ?? group.Alias ?? string.Empty,
            Name: group.Name ?? string.Empty,
            Type: group.Type.ToString(),
            ParentAlias: string.IsNullOrEmpty(parentAlias) ? null : parentAlias,
            FromCompositionId: fromCompositionId,
            Properties: properties
                .OrderBy(p => p.SortOrder)
                .Select(p => ToProperty(p, fromCompositionId, dataTypesByKey, targetsByDataTypeKey, hostId, edges))
                .ToArray());
    }

    /// <summary>A synthetic group for properties Umbraco never put in a tab or a group.</summary>
    private static Models.PropertyGroup NoGroup(
        string? fromCompositionId,
        IEnumerable<IPropertyType> properties,
        IReadOnlyDictionary<Guid, IDataType> dataTypesByKey,
        IReadOnlyDictionary<Guid, SchemaTarget[]> targetsByDataTypeKey,
        string hostId,
        List<SchemaEdge> edges) =>
        new(
            Id: fromCompositionId is null ? "no-group" : $"no-group:{fromCompositionId}",
            Alias: "no-group",
            Name: "No group",
            Type: "Group",
            ParentAlias: null,
            FromCompositionId: fromCompositionId,
            Properties: properties
                .Select(p => ToProperty(p, fromCompositionId, dataTypesByKey, targetsByDataTypeKey, hostId, edges))
                .ToArray());

    private static SchemaProperty ToProperty(
        IPropertyType property,
        string? fromCompositionId,
        IReadOnlyDictionary<Guid, IDataType> dataTypesByKey,
        IReadOnlyDictionary<Guid, SchemaTarget[]> targetsByDataTypeKey,
        string hostId,
        List<SchemaEdge> edges)
    {
        SchemaTarget[] targets = targetsByDataTypeKey.TryGetValue(property.DataTypeKey, out SchemaTarget[]? found)
            ? found
            : [];

        foreach (SchemaTarget target in targets)
        {
            edges.Add(target.Role == BlockEditorInspector.PickerRole
                ? new SchemaEdge(EdgeKind.Reference, hostId, target.NodeId, property.Alias)
                : new SchemaEdge(EdgeKind.Block, hostId, target.NodeId, property.Alias, target.Role));
        }

        return new SchemaProperty(
            Alias: property.Alias ?? string.Empty,
            Name: property.Name ?? string.Empty,
            DataTypeId: property.DataTypeKey.ToString(),
            EditorAlias: property.PropertyEditorAlias ?? string.Empty,
            EditorUiAlias: dataTypesByKey.TryGetValue(property.DataTypeKey, out IDataType? dataType) ? dataType.EditorUiAlias : null,
            Mandatory: property.Mandatory,
            VariesByCulture: property.Variations.HasFlag(ContentVariation.Culture),
            FromCompositionId: fromCompositionId,
            Targets: targets);
    }
}
