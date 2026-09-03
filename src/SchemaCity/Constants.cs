namespace SchemaCity;

public static class Constants
{
    /// <summary>
    /// Name of the Swagger document and the value <c>[MapToApi]</c> matches on, so the
    /// controllers land in /umbraco/swagger/schema-city/swagger.json and nowhere else.
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
