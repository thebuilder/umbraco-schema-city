namespace SchemaCity;

public static class Constants
{
    /// <summary>
    /// The value <c>[MapToApi]</c> matches on, which keeps these controllers out of Umbraco's
    /// own Management API OpenAPI document. Schema City registers no document of its own.
    /// </summary>
    public const string ApiName = "schema-city";

    /// <summary>
    /// Route segment under /umbraco/management/api/v1/.
    /// </summary>
    public const string RouteName = "schema-city";

    /// <summary>
    /// Prefix every extension alias in umbraco-package.json starts with.
    /// </summary>
    public const string ExtensionAliasPrefix = "SchemaCity.";
}
