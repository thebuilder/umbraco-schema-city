namespace SchemaCity;

/// <summary>
/// Settings read from the <c>SchemaCity</c> section of appsettings.
/// </summary>
public sealed class SchemaCityOptions
{
    /// <summary>
    /// The appsettings section these settings bind to.
    /// </summary>
    public const string SectionName = "SchemaCity";

    /// <summary>
    /// Whether the Document Type editor gets the Relationships tab. On by default. The city
    /// under Settings, Advanced stays either way.
    /// </summary>
    public bool RelationshipsTab { get; set; } = true;
}
