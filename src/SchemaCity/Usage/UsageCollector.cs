using Microsoft.Extensions.Logging;
using SchemaCity.Models;
using Umbraco.Cms.Infrastructure.Scoping;

// A bare Constants resolves to SchemaCity's own.
using UmbracoConstants = Umbraco.Cms.Core.Constants;

namespace SchemaCity.Usage;

/// <summary>
/// Counts the content behind every Document Type in four grouped queries, then the blocks stored in
/// block editor values, and holds the result for a minute. The counts are aggregated in SQL; the
/// block values are read as raw JSON and never load a content item.
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

    /// <summary>
    /// Every stored value of a block editor property on the latest version of a document that is
    /// not in the recycle bin. The latest version is the draft when there is one and the published
    /// version otherwise, so each item's blocks are read once. Media and members are left out,
    /// because the graph only has Document Types to show them on.
    /// </summary>
    private const string BlockValuesSql = """
        SELECT cv.nodeId AS NodeId, dtn.uniqueId AS DataTypeKey, pd.textValue AS Value
        FROM umbracoPropertyData pd
        INNER JOIN umbracoContentVersion cv ON cv.id = pd.versionId AND cv.[current] = 1
        INNER JOIN umbracoNode n ON n.id = cv.nodeId AND n.trashed = 0
        INNER JOIN umbracoDocument d ON d.nodeId = cv.nodeId
        INNER JOIN cmsPropertyType pt ON pt.id = pd.propertyTypeId
        INNER JOIN umbracoDataType dt ON dt.nodeId = pt.dataTypeId
        INNER JOIN umbracoNode dtn ON dtn.id = dt.nodeId
        WHERE dt.propertyEditorAlias IN (@0) AND pd.textValue IS NOT NULL
        """;

    /// <summary>Which Data Type each property of each content type uses, for nested block values.</summary>
    private const string PropertyDataTypesSql = """
        SELECT ct.uniqueId AS ContentTypeKey, pt.Alias AS Alias, dtn.uniqueId AS DataTypeKey
        FROM cmsPropertyType pt
        INNER JOIN umbracoNode ct ON ct.id = pt.contentTypeId
        INNER JOIN umbracoNode dtn ON dtn.id = pt.dataTypeId
        """;

    /// <summary>The editors whose values hold blocks. TinyMCE is the rich text alias before 14.</summary>
    private static readonly string[] BlockEditors =
        ["Umbraco.BlockList", "Umbraco.BlockGrid", "Umbraco.RichText", "Umbraco.TinyMCE", "Umbraco.SingleBlock"];

    /// <summary>
    /// ponytail: a fixed cap and budget for reading block values, sized so the usage endpoint stays
    /// quick on a large install. Past either the report says partial and the UI says the numbers are
    /// a lower bound. Make them settings if a site needs the full count, or move the count to a
    /// background job with its own cache.
    /// </summary>
    private const int MaxBlockValues = 50_000;

    private static readonly TimeSpan BlockBudget = TimeSpan.FromSeconds(5);

    private readonly IScopeProvider _scopeProvider;
    private readonly ILogger<UsageCollector> _logger;
    private UsageReport? _cached;
    private DateTimeOffset _cachedAt;

    public UsageCollector(IScopeProvider scopeProvider, ILogger<UsageCollector> logger)
    {
        _scopeProvider = scopeProvider;
        _logger = logger;
    }

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
        UsageReport report = Aggregate(
            DateTimeOffset.UtcNow,
            scope.Database.Fetch<CountRow>(CountsSql, documentType),
            scope.Database.Fetch<LastEditedRow>(LastEditedSql, documentType),
            scope.Database.Fetch<CultureRow>(CulturesSql, documentType),
            scope.Database.Fetch<ReferenceRow>(ReferencesSql, UmbracoConstants.Conventions.RelationTypes.RelatedDocumentAlias));

        return report with { Blocks = CountBlocks(scope) };
    }

    /// <summary>
    /// The stored block counts, streamed so the cap can stop the read part way. A failure here
    /// leaves the rest of the report standing and says the block counts are partial.
    /// </summary>
    private BlockUsage CountBlocks(IScope scope)
    {
        try
        {
            Dictionary<(Guid, string), Guid> dataTypeOf = scope.Database
                .Fetch<PropertyDataTypeRow>(PropertyDataTypesSql)
                .GroupBy(r => (r.ContentTypeKey, r.Alias))
                .ToDictionary(g => g.Key, g => g.First().DataTypeKey);

            // Wrapped, or C# hands the array over as the params array itself and @0 binds only
            // its first alias. As one argument NPoco expands it into the IN list.
            var clock = System.Diagnostics.Stopwatch.StartNew();
            BlockUsage blocks = BlockCounter.Count(
                scope.Database.Query<BlockCounter.ValueRow>(BlockValuesSql, new object[] { BlockEditors }),
                dataTypeOf,
                MaxBlockValues,
                BlockBudget);
            _logger.LogDebug(
                "Schema City: read {Values} block values in {Milliseconds} ms, partial {Partial}.",
                blocks.ValuesRead,
                clock.ElapsedMilliseconds,
                blocks.Partial);
            return blocks;
        }
        catch (Exception exception)
        {
            _logger.LogWarning(exception, "Schema City: counting stored blocks failed, so the usage report has none.");
            return new BlockUsage(Partial: true, ValuesRead: 0, Unreadable: 0, ByDataType: []);
        }
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

    public sealed class PropertyDataTypeRow
    {
        public Guid ContentTypeKey { get; set; }

        public string Alias { get; set; } = string.Empty;

        public Guid DataTypeKey { get; set; }
    }

    public sealed class ReferenceRow
    {
        public Guid FromType { get; set; }

        public Guid ToType { get; set; }

        public int ReferenceCount { get; set; }
    }
}
