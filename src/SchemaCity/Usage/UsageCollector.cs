using SchemaCity.Models;
using Umbraco.Cms.Infrastructure.Scoping;

// A bare Constants resolves to SchemaCity's own.
using UmbracoConstants = Umbraco.Cms.Core.Constants;

namespace SchemaCity.Usage;

/// <summary>
/// Counts the content behind every Document Type in four grouped queries and holds the result for
/// a minute. Everything is aggregated in SQL; nothing loads a content item.
/// </summary>
/// <remarks>
/// The queries join through umbracoNode rather than cmsContentType, because a Document Type's key
/// lives on its node row and umbracoContent.contentTypeId is that node's id, so cmsContentType adds
/// a join and no columns.
/// </remarks>
public sealed class UsageCollector
{
    private static readonly TimeSpan Ttl = TimeSpan.FromSeconds(60);

    /// <summary>
    /// Every Document Type, its content counts and its root instances. The left joins are what make
    /// a type with no content come back as a row of zeros instead of not coming back.
    /// </summary>
    private const string CountsSql = """
        SELECT ctn.uniqueId AS TypeKey,
               COUNT(c.nodeId) AS Total,
               SUM(CASE WHEN d.published = 1 THEN 1 ELSE 0 END) AS Published,
               SUM(CASE WHEN d.published = 0 AND n.trashed = 0 THEN 1 ELSE 0 END) AS Drafts,
               SUM(CASE WHEN n.trashed = 1 THEN 1 ELSE 0 END) AS Trashed,
               SUM(CASE WHEN n.level = 1 AND n.trashed = 0 THEN 1 ELSE 0 END) AS RootInstances
        FROM umbracoNode ctn
        LEFT JOIN umbracoContent c ON c.contentTypeId = ctn.id
        LEFT JOIN umbracoNode n ON n.id = c.nodeId
        LEFT JOIN umbracoDocument d ON d.nodeId = c.nodeId
        WHERE ctn.nodeObjectType = @0
        GROUP BY ctn.uniqueId
        """;

    /// <summary>Newest version date per Document Type. Types with no content do not come back.</summary>
    private const string LastEditedSql = """
        SELECT ctn.uniqueId AS TypeKey, MAX(cv.versionDate) AS LastEdited
        FROM umbracoContentVersion cv
        INNER JOIN umbracoContent c ON c.nodeId = cv.nodeId
        INNER JOIN umbracoNode ctn ON ctn.id = c.contentTypeId
        WHERE ctn.nodeObjectType = @0
        GROUP BY ctn.uniqueId
        """;

    /// <summary>One row per Document Type and culture that has at least one available variant.</summary>
    private const string CulturesSql = """
        SELECT ctn.uniqueId AS TypeKey, l.languageISOCode AS Culture
        FROM umbracoDocumentCultureVariation v
        INNER JOIN umbracoContent c ON c.nodeId = v.nodeId
        INNER JOIN umbracoNode ctn ON ctn.id = c.contentTypeId
        INNER JOIN umbracoLanguage l ON l.id = v.languageId
        WHERE v.available = 1 AND ctn.nodeObjectType = @0
        GROUP BY ctn.uniqueId, l.languageISOCode
        """;

    /// <summary>
    /// Tracked document references, rolled up from instances to types. Umbraco saves the relation
    /// with the referencing document as the parent, so parent is the picker host and child is the
    /// target.
    /// </summary>
    private const string ReferencesSql = """
        SELECT fromCt.uniqueId AS FromType, toCt.uniqueId AS ToType, COUNT(*) AS ReferenceCount
        FROM umbracoRelation r
        INNER JOIN umbracoRelationType rt ON rt.id = r.relType AND rt.alias = @0
        INNER JOIN umbracoContent pc ON pc.nodeId = r.parentId
        INNER JOIN umbracoContent cc ON cc.nodeId = r.childId
        INNER JOIN umbracoNode fromCt ON fromCt.id = pc.contentTypeId
        INNER JOIN umbracoNode toCt ON toCt.id = cc.contentTypeId
        GROUP BY fromCt.uniqueId, toCt.uniqueId
        """;

    private readonly IScopeProvider _scopeProvider;
    private UsageReport? _cached;
    private DateTimeOffset _cachedAt;

    public UsageCollector(IScopeProvider scopeProvider) => _scopeProvider = scopeProvider;

    // ponytail: no lock. Two requests arriving inside the same cold second run the four queries
    // twice and one result wins. Add a Lazy if that ever shows up in a trace.
    public UsageReport Collect(bool refresh = false)
    {
        if (refresh is false && _cached is not null && DateTimeOffset.UtcNow - _cachedAt < Ttl)
        {
            return _cached;
        }

        _cached = Query();
        _cachedAt = DateTimeOffset.UtcNow;
        return _cached;
    }

    /// <summary>Runs the four queries in one read scope and aggregates them.</summary>
    public UsageReport Query()
    {
        using IScope scope = _scopeProvider.CreateScope(autoComplete: true);
        // The Guid, not the string constant: nodeObjectType is a uniqueidentifier column, and
        // SQLite and SQL Server disagree about how a Guid reads back as text.
        Guid documentType = UmbracoConstants.ObjectTypes.DocumentType;

        // ponytail: the plan runs the culture query only when some type varies by culture. Knowing
        // that costs a query or a dependency on the graph builder, and on a site where nothing
        // varies umbracoDocumentCultureVariation is empty, so the guard would buy a scan of nothing.
        return Aggregate(
            DateTimeOffset.UtcNow,
            scope.Database.Fetch<CountRow>(CountsSql, documentType),
            scope.Database.Fetch<LastEditedRow>(LastEditedSql, documentType),
            scope.Database.Fetch<CultureRow>(CulturesSql, documentType),
            scope.Database.Fetch<ReferenceRow>(ReferencesSql, UmbracoConstants.Conventions.RelationTypes.RelatedDocumentAlias));
    }

    /// <summary>
    /// The shape of the report, with no database in sight, so a test can hand it rows it built
    /// itself. Sorted throughout, because the seeded site exports this to a fixture and a fixture
    /// that reorders itself between boots is a diff nobody asked for.
    /// </summary>
    public static UsageReport Aggregate(
        DateTimeOffset generatedAt,
        IEnumerable<CountRow> counts,
        IEnumerable<LastEditedRow> lastEdited,
        IEnumerable<CultureRow> cultures,
        IEnumerable<ReferenceRow> references)
    {
        Dictionary<Guid, DateTime> edited = lastEdited.ToDictionary(r => r.TypeKey, r => r.LastEdited);

        Dictionary<Guid, string[]> culturesByType = cultures
            .GroupBy(r => r.TypeKey)
            .ToDictionary(g => g.Key, g => g.Select(r => r.Culture).Order(StringComparer.Ordinal).ToArray());

        Dictionary<string, TypeUsage> byType = counts
            .OrderBy(r => r.TypeKey.ToString(), StringComparer.Ordinal)
            .ToDictionary(
                r => r.TypeKey.ToString(),
                r => new TypeUsage(
                    r.Total,
                    r.Published,
                    r.Drafts,
                    r.Trashed,
                    r.RootInstances,
                    culturesByType.TryGetValue(r.TypeKey, out string[]? c) ? c : [],
                    edited.TryGetValue(r.TypeKey, out DateTime last) ? last : null),
                StringComparer.Ordinal);

        TypeReference[] referenceRows = references
            .Select(r => new TypeReference(r.FromType.ToString(), r.ToType.ToString(), r.ReferenceCount))
            .OrderBy(r => r.FromType, StringComparer.Ordinal)
            .ThenBy(r => r.ToType, StringComparer.Ordinal)
            .ToArray();

        return new UsageReport(generatedAt, byType, referenceRows);
    }

    public sealed class CountRow
    {
        public Guid TypeKey { get; set; }

        public int Total { get; set; }

        public int Published { get; set; }

        public int Drafts { get; set; }

        public int Trashed { get; set; }

        public int RootInstances { get; set; }
    }

    public sealed class LastEditedRow
    {
        public Guid TypeKey { get; set; }

        public DateTime LastEdited { get; set; }
    }

    public sealed class CultureRow
    {
        public Guid TypeKey { get; set; }

        public string Culture { get; set; } = string.Empty;
    }

    public sealed class ReferenceRow
    {
        public Guid FromType { get; set; }

        public Guid ToType { get; set; }

        public int ReferenceCount { get; set; }
    }
}
