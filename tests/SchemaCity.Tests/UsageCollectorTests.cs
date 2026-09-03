using System.Text.Json;
using SchemaCity.Models;
using SchemaCity.Usage;

namespace SchemaCity.Tests;

/// <summary>
/// The four queries need a database, so the boot check covers them. What is testable here is the
/// step after them, plus the fixture the seeded site exports, which is the queries' real output
/// frozen into the repository.
/// </summary>
public class UsageCollectorTests
{
    private static readonly Guid ArticleKey = Guid.Parse("11111111-1111-1111-1111-111111111111");
    private static readonly Guid CampaignKey = Guid.Parse("22222222-2222-2222-2222-222222222222");
    private static readonly Guid UnusedKey = Guid.Parse("33333333-3333-3333-3333-333333333333");

    private static readonly DateTime Edited = new(2026, 9, 3, 10, 30, 0, DateTimeKind.Unspecified);

    [Fact]
    public void Aggregate_keeps_a_row_of_zeros_for_a_type_with_no_content()
    {
        UsageReport report = UsageCollector.Aggregate(
            DateTimeOffset.UnixEpoch,
            [Counts(UnusedKey, total: 0, published: 0, drafts: 0, trashed: 0, roots: 0)],
            [],
            [],
            []);

        TypeUsage usage = report.ByType[UnusedKey.ToString()];
        Assert.Equal(0, usage.Total);
        Assert.Empty(usage.Cultures);
        Assert.Null(usage.LastEdited);
    }

    [Fact]
    public void Aggregate_joins_cultures_and_last_edited_onto_the_counts()
    {
        UsageReport report = UsageCollector.Aggregate(
            DateTimeOffset.UnixEpoch,
            [
                Counts(ArticleKey, total: 162, published: 152, drafts: 5, trashed: 5, roots: 0),
                Counts(CampaignKey, total: 2, published: 2, drafts: 0, trashed: 0, roots: 1),
            ],
            [new UsageCollector.LastEditedRow { TypeKey = ArticleKey, LastEdited = Edited }],
            [
                // Out of order on purpose. The report sorts them.
                new UsageCollector.CultureRow { TypeKey = CampaignKey, Culture = "en-US" },
                new UsageCollector.CultureRow { TypeKey = CampaignKey, Culture = "da-DK" },
            ],
            []);

        TypeUsage article = report.ByType[ArticleKey.ToString()];
        Assert.Equal(162, article.Total);
        Assert.Equal(152, article.Published);
        Assert.Equal(Edited, article.LastEdited);
        Assert.Empty(article.Cultures);

        TypeUsage campaign = report.ByType[CampaignKey.ToString()];
        Assert.Equal(["da-DK", "en-US"], campaign.Cultures);
        Assert.Equal(1, campaign.RootInstances);
        Assert.Null(campaign.LastEdited);
    }

    [Fact]
    public void Aggregate_maps_and_sorts_the_instance_references()
    {
        UsageReport report = UsageCollector.Aggregate(
            DateTimeOffset.UnixEpoch,
            [],
            [],
            [],
            [
                new UsageCollector.ReferenceRow { FromType = CampaignKey, ToType = ArticleKey, ReferenceCount = 4 },
                new UsageCollector.ReferenceRow { FromType = ArticleKey, ToType = CampaignKey, ReferenceCount = 7 },
            ]);

        Assert.Equal(
            [
                new TypeReference(ArticleKey.ToString(), CampaignKey.ToString(), 7),
                new TypeReference(CampaignKey.ToString(), ArticleKey.ToString(), 4),
            ],
            report.References);
    }

    /// <summary>
    /// The numbers the seeder logs, read back out of the fixture the seeded site exports. This is
    /// the only check that the SQL itself counts the right things.
    /// </summary>
    [Fact]
    public void The_exported_fixture_matches_what_the_seeder_planted()
    {
        (UsageReport usage, Dictionary<string, string> keysByAlias) = ReadFixtures();

        Assert.Equal(193, usage.ByType.Values.Sum(u => u.Total));
        Assert.Equal(183, usage.ByType.Values.Sum(u => u.Published));
        Assert.Equal(5, usage.ByType.Values.Sum(u => u.Drafts));
        Assert.Equal(5, usage.ByType.Values.Sum(u => u.Trashed));

        // Every Document Type gets a row, including the Element Types that never hold content.
        Assert.Equal(keysByAlias.Count, usage.ByType.Count);

        TypeUsage article = usage.ByType[keysByAlias["article"]];
        Assert.Equal(162, article.Total);
        Assert.Equal(152, article.Published);
        Assert.Equal(5, article.Drafts);
        Assert.Equal(5, article.Trashed);
        Assert.Equal(0, article.RootInstances);
        Assert.Empty(article.Cultures);

        // The type nothing uses still gets a row, and every number in it is zero.
        TypeUsage unused = usage.ByType[keysByAlias["unusedArticleLegacy"]];
        Assert.Equal([0, 0, 0, 0, 0], new[] { unused.Total, unused.Published, unused.Drafts, unused.Trashed, unused.RootInstances });
        Assert.Empty(unused.Cultures);
        Assert.Null(unused.LastEdited);

        Assert.Equal(["da-DK", "en-US"], usage.ByType[keysByAlias["campaignPage"]].Cultures);
        Assert.Equal(["da-DK", "en-US"], usage.ByType[keysByAlias["blogPost"]].Cultures);
    }

    private static UsageCollector.CountRow Counts(Guid key, int total, int published, int drafts, int trashed, int roots) =>
        new()
        {
            TypeKey = key,
            Total = total,
            Published = published,
            Drafts = drafts,
            Trashed = trashed,
            RootInstances = roots,
        };

    /// <summary>Reads the usage fixture plus the alias-to-key map out of the graph fixture.</summary>
    private static (UsageReport Usage, Dictionary<string, string> KeysByAlias) ReadFixtures()
    {
        DirectoryInfo? directory = new(AppContext.BaseDirectory);
        while (directory is not null && Directory.Exists(Path.Combine(directory.FullName, "src", "SchemaCity", "Client")) is false)
        {
            directory = directory.Parent;
        }

        Assert.NotNull(directory);
        string fixtures = Path.Combine(directory.FullName, "src", "SchemaCity", "Client", "dev", "fixtures");

        JsonSerializerOptions options = new(JsonSerializerDefaults.Web);
        UsageReport usage = JsonSerializer.Deserialize<UsageReport>(
            File.ReadAllText(Path.Combine(fixtures, "medium-usage.json")), options)!;

        using JsonDocument graph = JsonDocument.Parse(File.ReadAllText(Path.Combine(fixtures, "medium.json")));
        Dictionary<string, string> keysByAlias = graph.RootElement
            .GetProperty("nodes")
            .EnumerateArray()
            .ToDictionary(n => n.GetProperty("alias").GetString()!, n => n.GetProperty("id").GetString()!);

        return (usage, keysByAlias);
    }
}
