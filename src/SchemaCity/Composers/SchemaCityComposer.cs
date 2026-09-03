using Microsoft.Extensions.DependencyInjection;
using SchemaCity.Graph;
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
    }
}
