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
    /// Whether the Document Type editor gets the Relationships tab. On by default. Schema City
    /// under Settings, Advanced stays either way.
    /// </summary>
    public bool RelationshipsTab { get; set; } = true;

    /// <summary>
    /// Which look every user opens on, the Relationships tab included: <c>Clean</c>, the city
    /// plan in the backoffice's own style, or <c>City</c>, the 3D city. Case does not matter, and
    /// any other value opens on the city plan. There is no per-user switch.
    /// </summary>
    /// <remarks>
    /// A string rather than an enum: the binder throws on a value an enum does not name, and
    /// every reader of these options, the Relationships tab's manifest reader among them,
    /// would throw with it, which takes the backoffice's manifests down over a typo.
    /// </remarks>
    public string Variant { get; set; } = "Clean";

    /// <summary>The variant as the client names it: "city" for <c>City</c>, else "clean".</summary>
    public string ClientVariant =>
        string.Equals(Variant?.Trim(), "City", StringComparison.OrdinalIgnoreCase) ? "city" : "clean";
}
