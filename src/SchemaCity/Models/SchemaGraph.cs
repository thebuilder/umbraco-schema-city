using System.Text.Json.Serialization;

namespace SchemaCity.Models;

/// <summary>
/// The whole content model in one payload. Mirrored by SchemaGraph in Client/src/model/types.ts,
/// which is the contract. Property names here have to keep matching it.
/// </summary>
public record SchemaGraph(
    DateTimeOffset GeneratedAt,
    IReadOnlyList<SchemaFolder> Folders,
    IReadOnlyList<SchemaNode> Nodes,
    IReadOnlyList<SchemaEdge> Edges);

/// <summary>A Document Type container. ParentId is null for a folder at the tree root.</summary>
public record SchemaFolder(string Id, string Name, string? ParentId);

/// <summary>One Document Type.</summary>
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
    IReadOnlyList<PropertyGroup> Groups,
    int OwnPropertyCount,
    int ComposedPropertyCount,
    IReadOnlyList<SchemaTemplate> Templates);

public record SchemaTemplate(string Id, string Alias, string Name, bool IsDefault);

/// <summary>
/// A tab or a group, in editor order. Type is "Tab" or "Group", straight from Umbraco's
/// PropertyGroupType. ParentAlias is the tab a group sits in, null for a tab or a loose group.
/// FromCompositionId is null when the type declares the group itself.
/// </summary>
public record PropertyGroup(
    string Id,
    string Alias,
    string Name,
    string Type,
    string? ParentAlias,
    string? FromCompositionId,
    IReadOnlyList<SchemaProperty> Properties);

public record SchemaProperty(
    string Alias,
    string Name,
    string DataTypeId,
    string EditorAlias,
    string? EditorUiAlias,
    bool Mandatory,
    bool VariesByCulture,
    string? FromCompositionId,
    IReadOnlyList<SchemaTarget> Targets);

/// <summary>
/// A content type a property can hold or point at. Role is "content" or "settings" for a block
/// editor and "picker" for a Multi Node Tree Picker filter. NodeId can name a content type that
/// no longer exists, which is how the client finds broken block references.
/// </summary>
public record SchemaTarget(string NodeId, string Role);

/// <summary>Serialised in camelCase, exactly the EdgeKind union in types.ts.</summary>
[JsonConverter(typeof(JsonStringEnumConverter<EdgeKind>))]
public enum EdgeKind
{
    [JsonStringEnumMemberName("allowedChild")]
    AllowedChild,

    [JsonStringEnumMemberName("composition")]
    Composition,

    [JsonStringEnumMemberName("inherits")]
    Inherits,

    [JsonStringEnumMemberName("block")]
    Block,

    [JsonStringEnumMemberName("reference")]
    Reference,
}

/// <summary>
/// One relationship. PropertyAlias and Role are omitted when they are null, because types.ts
/// declares them optional and TypeScript reads a written null as a type error.
/// </summary>
public record SchemaEdge(
    EdgeKind Kind,
    string From,
    string To,
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] string? PropertyAlias = null,
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] string? Role = null);
