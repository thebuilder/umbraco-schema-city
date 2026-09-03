using Asp.Versioning;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using SchemaCity.Models;
using SchemaCity.Usage;
using Umbraco.Cms.Api.Common.Attributes;
using Umbraco.Cms.Api.Management.Controllers;
using Umbraco.Cms.Api.Management.Routing;
using Umbraco.Cms.Web.Common.Authorization;

namespace SchemaCity.Api;

/// <summary>
/// GET /umbraco/management/api/v1/schema-city/usage. The report is cached for a minute;
/// refresh=true skips the cache. Access is whatever the administrator grants a user group for the
/// Settings section.
/// </summary>
/// <remarks>
/// The five attributes are repeated from GraphController on purpose. A shared base class holding
/// them would be a new file of about fifteen lines to delete six, so it adds more than it removes.
/// </remarks>
[ApiVersion("1.0")]
[ApiExplorerSettings(GroupName = "Schema City")]
[Authorize(Policy = AuthorizationPolicies.SectionAccessSettings)]
[MapToApi(Constants.ApiName)]
[VersionedApiBackOfficeRoute(Constants.RouteName)]
public class UsageController : ManagementApiControllerBase
{
    private readonly UsageCollector _collector;

    public UsageController(UsageCollector collector) => _collector = collector;

    [HttpGet("usage")]
    [ProducesResponseType<UsageReport>(StatusCodes.Status200OK)]
    public UsageReport Usage(bool refresh = false) => _collector.Collect(refresh);
}
