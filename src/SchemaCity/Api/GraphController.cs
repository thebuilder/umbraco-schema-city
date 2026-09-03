using Asp.Versioning;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using SchemaCity.Graph;
using SchemaCity.Models;
using Umbraco.Cms.Api.Common.Attributes;
using Umbraco.Cms.Api.Management.Controllers;
using Umbraco.Cms.Api.Management.Routing;
using Umbraco.Cms.Web.Common.Authorization;

namespace SchemaCity.Api;

/// <summary>
/// GET /umbraco/management/api/v1/schema-city/graph. Access is whatever the administrator
/// grants a user group for the Settings section.
/// </summary>
[ApiVersion("1.0")]
[ApiExplorerSettings(GroupName = "Schema City")]
[Authorize(Policy = AuthorizationPolicies.SectionAccessSettings)]
[MapToApi(Constants.ApiName)]
[VersionedApiBackOfficeRoute(Constants.RouteName)]
public class GraphController : ManagementApiControllerBase
{
    private readonly SchemaGraphBuilder _builder;

    public GraphController(SchemaGraphBuilder builder) => _builder = builder;

    [HttpGet("graph")]
    [ProducesResponseType<SchemaGraph>(StatusCodes.Status200OK)]
    public SchemaGraph Graph() => _builder.Build();
}
