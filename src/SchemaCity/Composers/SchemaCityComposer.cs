using Microsoft.Extensions.DependencyInjection;
using SchemaCity.Graph;
using SchemaCity.Manifest;
using SchemaCity.Review;
using SchemaCity.Usage;
using Umbraco.Cms.Core.Composing;
using Umbraco.Cms.Core.DependencyInjection;
using Umbraco.Cms.Core.Events;
using Umbraco.Cms.Core.Notifications;
using Umbraco.Cms.Infrastructure.Manifest;

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

        // Also a singleton for its cache, but it expires on a timer rather than on a notification,
        // because content changes far more often than the content model does.
        builder.Services.AddSingleton<UsageCollector>();

        // Holds nothing but the key-value service, so one instance serves every request.
        builder.Services.AddSingleton<DecisionStore>();

        builder.Services.Configure<SchemaCityOptions>(
            builder.Config.GetSection(SchemaCityOptions.SectionName));
        // Umbraco reads every registered reader, so this adds to the package's static
        // manifest rather than replacing it.
        builder.Services.AddSingleton<IPackageManifestReader, RelationshipsTabManifestReader>();
    }
}
