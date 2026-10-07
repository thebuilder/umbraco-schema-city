using Asp.Versioning;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using SchemaCity.Graph;
using SchemaCity.Models;
using SchemaCity.Review;
using Umbraco.Cms.Api.Common.Attributes;
using Umbraco.Cms.Api.Management.Controllers;
using Umbraco.Cms.Api.Management.Routing;
using Umbraco.Cms.Core.Models.Membership;
using Umbraco.Cms.Core.Security;
using Umbraco.Cms.Web.Common.Authorization;

namespace SchemaCity.Api;

/// <summary>
/// Review decisions under /umbraco/management/api/v1/schema-city/decisions: GET lists them, PUT
/// decisions/{findingId} records one for the current user and DELETE decisions/{findingId} undoes
/// it. Same Settings section access as the graph. A decision is app data in the key-value table,
/// so none of these touch the schema or content.
/// </summary>
[ApiVersion("1.0")]
[ApiExplorerSettings(GroupName = "Schema City")]
[Authorize(Policy = AuthorizationPolicies.SectionAccessSettings)]
[MapToApi(Constants.ApiName)]
[VersionedApiBackOfficeRoute(Constants.RouteName)]
public class DecisionsController : ManagementApiControllerBase
{
    private readonly DecisionStore _store;
    private readonly SchemaGraphBuilder _builder;
    private readonly IBackOfficeSecurityAccessor _security;

    public DecisionsController(DecisionStore store, SchemaGraphBuilder builder, IBackOfficeSecurityAccessor security)
    {
        _store = store;
        _builder = builder;
        _security = security;
    }

    [HttpGet("decisions")]
    [ProducesResponseType<IReadOnlyList<ReviewDecision>>(StatusCodes.Status200OK)]
    public IReadOnlyList<ReviewDecision> List() => _store.All();

    /// <summary>
    /// Records the finding as intentional. The fingerprint the client sends has to match the
    /// subject's current one, so nobody signs off on a type that changed after their page loaded.
    /// </summary>
    [HttpPut("decisions/{findingId}")]
    [ProducesResponseType<ReviewDecision>(StatusCodes.Status200OK)]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status400BadRequest)]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status404NotFound)]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status409Conflict)]
    public IActionResult Put(string findingId, [FromBody] DecisionRequest request)
    {
        if (DecisionStore.IsFindingId(findingId) is false)
        {
            return Problem(title: "That is not a Schema City finding id.", statusCode: StatusCodes.Status400BadRequest);
        }

        string? reason = DecisionStore.CleanReason(request.Reason);
        if (reason is null)
        {
            return Problem(
                title: $"Give a reason of 1 to {DecisionStore.MaxReasonLength} characters.",
                statusCode: StatusCodes.Status400BadRequest);
        }

        string? current = _builder.FingerprintOf(DecisionStore.SubjectOf(findingId));
        if (current is null)
        {
            return Problem(title: "The type or Data Type this finding is about no longer exists.", statusCode: StatusCodes.Status404NotFound);
        }

        if (request.Fingerprint != current)
        {
            return Problem(
                title: "The type changed since this page loaded. Reload Schema City and check the finding again.",
                statusCode: StatusCodes.Status409Conflict);
        }

        if (_security.BackOfficeSecurity?.CurrentUser is not IUser user)
        {
            return Unauthorized();
        }

        ReviewDecision decision = new(
            findingId,
            "intentional",
            reason,
            string.IsNullOrWhiteSpace(user.Name) ? user.Username : user.Name,
            user.Key,
            DateTimeOffset.UtcNow,
            current);
        _store.Save(decision);
        return Ok(decision);
    }

    [HttpDelete("decisions/{findingId}")]
    [ProducesResponseType(StatusCodes.Status204NoContent)]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status400BadRequest)]
    public IActionResult Delete(string findingId)
    {
        if (DecisionStore.IsFindingId(findingId) is false)
        {
            return Problem(title: "That is not a Schema City finding id.", statusCode: StatusCodes.Status400BadRequest);
        }

        _store.Remove(findingId);
        return NoContent();
    }
}
