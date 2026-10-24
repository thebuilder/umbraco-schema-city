using Asp.Versioning;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.Options;
using SchemaCity.Graph;
using SchemaCity.Models;
using Umbraco.Cms.Api.Common.Attributes;
using Umbraco.Cms.Api.Management.Controllers;
using Umbraco.Cms.Api.Management.Routing;
using Umbraco.Cms.Web.Common.Authorization;

namespace SchemaCity.Api;

/// <summary>
/// GET /umbraco/management/api/v1/schema-city/graph, and /settings beside it. Access is whatever
/// the administrator grants a user group for the Settings section.
/// </summary>
[ApiVersion("1.0")]
[ApiExplorerSettings(GroupName = "Schema City")]
[Authorize(Policy = AuthorizationPolicies.SectionAccessSettings)]
[MapToApi(Constants.ApiName)]
[VersionedApiBackOfficeRoute(Constants.RouteName)]
public class GraphController : ManagementApiControllerBase
{
    private readonly SchemaGraphBuilder _builder;
    private readonly IOptions<SchemaCityOptions> _options;

    public GraphController(SchemaGraphBuilder builder, IOptions<SchemaCityOptions> options)
    {
        _builder = builder;
        _options = options;
    }

    [HttpGet("graph")]
    [ProducesResponseType<SchemaGraph>(StatusCodes.Status200OK)]
    public SchemaGraph Graph() => _builder.Build();

    /// <summary>
    /// The appsettings the client reads, which today is only the variant a user without a choice
    /// of their own opens on, as "clean" or "city".
    /// </summary>
    [HttpGet("settings")]
    [ProducesResponseType<ClientSettings>(StatusCodes.Status200OK)]
    public ClientSettings Settings() => new(_options.Value.ClientVariant);
}
