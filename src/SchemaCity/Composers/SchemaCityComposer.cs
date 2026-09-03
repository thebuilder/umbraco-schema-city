using Asp.Versioning;
using Microsoft.AspNetCore.Mvc.ApiExplorer;
using Microsoft.AspNetCore.Mvc.Controllers;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Options;
using Microsoft.OpenApi;
using SchemaCity.Graph;
using Swashbuckle.AspNetCore.SwaggerGen;
using Umbraco.Cms.Api.Common.OpenApi;
using Umbraco.Cms.Api.Management.OpenApi;
using Umbraco.Cms.Core.Composing;
using Umbraco.Cms.Core.DependencyInjection;
using Umbraco.Cms.Core.Events;
using Umbraco.Cms.Core.Notifications;

namespace SchemaCity.Composers;

public class SchemaCityComposer : IComposer
{
    public void Compose(IUmbracoBuilder builder)
    {
        // The builder caches the last graph in a field, so it has to be a singleton. Umbraco's
        // AddNotificationHandler registers handlers as transient, which would hand the
        // notifications to a second instance whose cache nobody reads.
        builder.Services.AddSingleton<SchemaGraphBuilder>();
        builder.Services.AddSingleton<INotificationHandler<ContentTypeCacheRefresherNotification>>(
            x => x.GetRequiredService<SchemaGraphBuilder>());
        builder.Services.AddSingleton<INotificationHandler<DataTypeCacheRefresherNotification>>(
            x => x.GetRequiredService<SchemaGraphBuilder>());

        builder.Services.AddSingleton<IOperationIdHandler, SchemaCityOperationIdHandler>();

        builder.Services.Configure<SwaggerGenOptions>(opt =>
        {
            // A Swagger document of our own, so @hey-api/openapi-ts can read
            // /umbraco/swagger/schema-city/swagger.json and generate a client for these
            // endpoints alone.
            opt.SwaggerDoc(Constants.ApiName, new OpenApiInfo
            {
                Title = "Schema City Backoffice API",
                Version = "1.0",
            });

            opt.OperationFilter<SchemaCitySecurityFilter>();
        });
    }

    /// <summary>Adds the backoffice bearer token requirement to our Swagger document.</summary>
    public class SchemaCitySecurityFilter : BackOfficeSecurityRequirementsOperationFilterBase
    {
        protected override string ApiName => Constants.ApiName;
    }

    /// <summary>
    /// Names operations after the action, so the generated client has getGraph() rather than
    /// getUmbracoManagementApiV1SchemaCityGraph().
    /// </summary>
    public class SchemaCityOperationIdHandler : OperationIdHandler
    {
        public SchemaCityOperationIdHandler(IOptions<ApiVersioningOptions> apiVersioningOptions)
            : base(apiVersioningOptions)
        {
        }

        protected override bool CanHandle(ApiDescription apiDescription, ControllerActionDescriptor controllerActionDescriptor) =>
            controllerActionDescriptor.ControllerTypeInfo.Namespace?.StartsWith(
                "SchemaCity.Api", StringComparison.InvariantCultureIgnoreCase) is true;

        public override string Handle(ApiDescription apiDescription) =>
            $"{apiDescription.ActionDescriptor.RouteValues["action"]}";
    }
}
