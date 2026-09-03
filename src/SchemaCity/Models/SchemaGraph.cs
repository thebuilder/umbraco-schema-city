namespace SchemaCity.Models;

/// <summary>
/// The whole content model in one payload. Mirrored by SchemaGraph in Client/src/model/types.ts.
/// Edges arrive in M1.
/// </summary>
public record SchemaGraph(
    DateTimeOffset GeneratedAt,
    IReadOnlyList<SchemaFolder> Folders,
    IReadOnlyList<SchemaNode> Nodes);

/// <summary>A Document Type container. ParentId is null for a folder at the tree root.</summary>
public record SchemaFolder(string Id, string Name, string? ParentId);

/// <summary>One Document Type. Groups and properties arrive in M1.</summary>
public record SchemaNode(
    string Id,
    string Alias,
    string Name,
    string Icon,
    string? IconColor,
    string? FolderId,
    bool IsElement,
    bool AllowedAsRoot,
    bool VariesByCulture,
    bool VariesBySegment,
    string? Description,
    int OwnPropertyCount,
    int ComposedPropertyCount,
    IReadOnlyList<SchemaTemplate> Templates);

public record SchemaTemplate(string Id, string Alias, string Name, bool IsDefault);
