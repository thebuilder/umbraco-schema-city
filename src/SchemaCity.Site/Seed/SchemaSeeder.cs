using System.Text.Json;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;
using SchemaCity.Graph;
using SchemaCity.Models;
using Umbraco.Cms.Core;
using Umbraco.Cms.Core.Composing;
using Umbraco.Cms.Core.DependencyInjection;
using Umbraco.Cms.Core.Events;
using Umbraco.Cms.Core.Models;
using Umbraco.Cms.Core.Notifications;
using Umbraco.Cms.Core.PropertyEditors;
using Umbraco.Cms.Core.Serialization;
using Umbraco.Cms.Core.Services;
using Umbraco.Cms.Core.Services.OperationStatus;
using Umbraco.Cms.Core.Strings;

// SchemaCity.Site sits inside the SchemaCity namespace, so a bare Constants resolves to ours.
using UmbracoConstants = Umbraco.Cms.Core.Constants;

namespace SchemaCity.Site.Seed;

/// <summary>
/// Registers the seeder. It only does anything in the Development environment on an empty install.
/// </summary>
public sealed class SchemaSeederComposer : IComposer
{
    public void Compose(IUmbracoBuilder builder) =>
        builder.AddNotificationAsyncHandler<UmbracoApplicationStartedNotification, SchemaSeeder>();
}

/// <summary>
/// Fills this throwaway site with a content model big enough to look like a real project, 78
/// Document Types and 193 content items, and plants the findings listed in
/// <see cref="PlantedFindings"/> so the findings drawer has something to report. It runs once, on
/// the first Development boot of an install that has no Document Types yet. Every later boot only
/// re-exports the graph fixture.
/// </summary>
public sealed class SchemaSeeder : INotificationAsyncHandler<UmbracoApplicationStartedNotification>
{
    /// <summary>
    /// The findings the seed data is built to produce, as (kind, Document Type alias). M3's
    /// findings test asserts that its own output contains all of these. It cannot assert equality:
    /// the no-template and dead-end rules also match every composition and every Element Type,
    /// and giving 60 Document Types a template would write 60 .cshtml files into the site.
    /// </summary>
    public static readonly (string Kind, string Alias)[] PlantedFindings =
    [
        ("brokenBlockReference", "brokenBlockHost"),
        ("duplicatePropertyAlias", "dupAliasPage"),
        ("noProperties", "emptyType"),
        ("noTemplate", "noTemplatePage"),
        ("structuralDeadEnd", "deadEndPromo"),
        ("unusedComposition", "unusedSeoComposition"),
        ("unusedElementType", "unusedElementBanner"),
        ("unusedType", "unusedArticleLegacy"),
    ];

    /// <summary>
    /// MultiNodePickerConfiguration.Filter is a comma separated list of Document Type keys, not
    /// aliases. PLAN.md section 4 says aliases; Umbraco 17 throws "Unrecognized Guid format" from
    /// the picker's validator on the first publish if you write aliases there. These two types
    /// therefore get fixed keys, so the Data Type can name them before the types exist.
    /// </summary>
    private static readonly Dictionary<string, Guid> FixedTypeKeys = new(StringComparer.Ordinal)
    {
        ["article"] = Guid.Parse("5c4a1f10-0000-4000-8000-000000000001"),
        ["standardPage"] = Guid.Parse("5c4a1f10-0000-4000-8000-000000000002"),
    };

    /// <summary>The unattended install creates en-US. The seeder adds da-DK next to it.</summary>
    private const string DefaultCulture = "en-US";

    private const string SecondCulture = "da-DK";

    private static readonly JsonSerializerOptions FixtureJson = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
        WriteIndented = true,
    };

    private readonly IContentService _contentService;
    private readonly IContentTypeService _contentTypeService;
    private readonly IDataTypeService _dataTypeService;
    private readonly IHostEnvironment _hostEnvironment;
    private readonly ILanguageService _languageService;
    private readonly ILogger<SchemaSeeder> _logger;
    private readonly PropertyEditorCollection _propertyEditors;
    private readonly IConfigurationEditorJsonSerializer _serializer;
    private readonly IShortStringHelper _shortStringHelper;
    private readonly ITemplateService _templateService;

    /// <summary>Data Types the seeded property types point at, in rotation order.</summary>
    private readonly List<IDataType> _editors = [];

    /// <summary>Every content type the seeder created, by alias.</summary>
    private readonly Dictionary<string, IContentType> _types = new(StringComparer.Ordinal);

    /// <summary>The Block List whose configuration names a deleted Element Type.</summary>
    private IDataType _brokenBlockList = null!;

    private int _published;
    private int _drafts;
    private int _trashed;

    public SchemaSeeder(
        IContentService contentService,
        IContentTypeService contentTypeService,
        IDataTypeService dataTypeService,
        IHostEnvironment hostEnvironment,
        ILanguageService languageService,
        ILogger<SchemaSeeder> logger,
        PropertyEditorCollection propertyEditors,
        IConfigurationEditorJsonSerializer serializer,
        IShortStringHelper shortStringHelper,
        ITemplateService templateService)
    {
        _contentService = contentService;
        _contentTypeService = contentTypeService;
        _dataTypeService = dataTypeService;
        _hostEnvironment = hostEnvironment;
        _languageService = languageService;
        _logger = logger;
        _propertyEditors = propertyEditors;
        _serializer = serializer;
        _shortStringHelper = shortStringHelper;
        _templateService = templateService;
    }

    public async Task HandleAsync(UmbracoApplicationStartedNotification notification, CancellationToken cancellationToken)
    {
        if (_hostEnvironment.IsDevelopment() is false)
        {
            return;
        }

        // One Document Type is enough to call the install seeded. Nothing else creates them here.
        if (_contentTypeService.GetAll().Any())
        {
            _logger.LogInformation("Schema City seeder: already seeded, skipping.");
        }
        else
        {
            await SeedAsync();
        }

        ExportFixture();
    }

    private async Task SeedAsync()
    {
        DateTimeOffset started = DateTimeOffset.UtcNow;

        await AddSecondLanguageAsync();
        Dictionary<string, int> folders = CreateFolders();

        // Element Types have to exist before the block Data Types can name their keys, and those
        // Data Types have to exist before the structure types can use them as property editors.
        await LoadBuiltInDataTypesAsync();
        CreateElementTypes(folders["Elements"]);
        await CreateBlockDataTypesAsync();

        CreateCompositions(folders["Compositions"]);
        CreateStructureTypes(folders["Pages"]);
        LinkAllowedChildren();
        await CreateTemplatesAsync();
        PlantDuplicatePropertyAlias();
        DeleteDoomedElementType();
        CreateContent();

        _logger.LogInformation(
            "Schema City seeder: {Types} Document Types, {Published} published, {Drafts} drafts, "
            + "{Trashed} trashed, in {Seconds}s.",
            _contentTypeService.Count(),
            _published,
            _drafts,
            _trashed,
            (int)(DateTimeOffset.UtcNow - started).TotalSeconds);
    }

    // ---------------------------------------------------------------- languages and folders

    private async Task AddSecondLanguageAsync()
    {
        var danish = new Language(SecondCulture, "Danish (Denmark)");
        await _languageService.CreateAsync(danish, UmbracoConstants.Security.SuperUserKey);
    }

    private Dictionary<string, int> CreateFolders()
    {
        Dictionary<string, int> folders = [];
        foreach (string name in new[] { "Compositions", "Elements", "Pages" })
        {
            Attempt<OperationResult<OperationResultType, EntityContainer>?> attempt =
                _contentTypeService.CreateContainer(UmbracoConstants.System.Root, Guid.NewGuid(), name);
            folders[name] = attempt.Result!.Entity!.Id;
        }

        return folders;
    }

    // ---------------------------------------------------------------- element types

    /// <summary>
    /// 15 Element Types plus <c>elementDoomed</c>, which the broken-block Data Type points at and
    /// <see cref="DeleteDoomedElementType"/> deletes again.
    /// </summary>
    /// <remarks>
    /// ponytail: these get built-in editors only, because the block Data Types do not exist yet
    /// when they are created. The seed therefore has no nested blocks. If the block inspector's
    /// recursion needs a test bed, add a second pass here that gives one Element Type the Block
    /// List property after the Data Types exist.
    /// </remarks>
    private void CreateElementTypes(int folderId)
    {
        string[] aliases =
        [
            "elementAccordionItem", "elementBlockSettings", "elementCallToAction", "elementCard",
            "elementDoomed", "elementForm", "elementGridColumn", "elementGridRow",
            "elementGridSettings", "elementHeading", "elementImage", "elementQuote",
            "elementRichText", "elementRteFigure", "elementVideo", "unusedElementBanner",
        ];

        for (int i = 0; i < aliases.Length; i++)
        {
            IContentType type = NewType(aliases[i], folderId, "icon-brick");
            type.IsElement = true;

            // Mandatory only lives on Element Types. A mandatory property on a Document Type that
            // gets seeded content would fail the publish, and the seeder writes no property values.
            AddProperties(type, aliases[i], 2 + (i % 5), mandatoryFirst: i % 3 == 0);
            Save(type);
        }
    }

    // ---------------------------------------------------------------- data types

    private async Task LoadBuiltInDataTypesAsync()
    {
        Guid[] builtIn =
        [
            UmbracoConstants.DataTypes.Guids.TextstringGuid,
            UmbracoConstants.DataTypes.Guids.TextareaGuid,
            UmbracoConstants.DataTypes.Guids.CheckboxGuid,
            UmbracoConstants.DataTypes.Guids.NumericGuid,
            UmbracoConstants.DataTypes.Guids.DatePickerGuid,
            UmbracoConstants.DataTypes.Guids.ContentPickerGuid,
            UmbracoConstants.DataTypes.Guids.MediaPicker3Guid,
        ];

        foreach (Guid key in builtIn)
        {
            _editors.Add(await _dataTypeService.GetAsync(key)
                ?? throw new InvalidOperationException($"Built-in Data Type {key} is missing."));
        }
    }

    /// <summary>
    /// Five Data Types with real configuration objects, so <c>BlockEditorInspector</c> has
    /// something to decode in M1.
    /// </summary>
    private async Task CreateBlockDataTypesAsync()
    {
        Guid Key(string alias) => _types[alias].Key;

        var bodyBlocks = new BlockListConfiguration
        {
            ValidationLimit = new BlockListConfiguration.NumberRange { Min = 0, Max = 20 },
            Blocks =
            [
                new() { ContentElementTypeKey = Key("elementHeading"), SettingsElementTypeKey = Key("elementBlockSettings") },
                new() { ContentElementTypeKey = Key("elementRichText") },
                new() { ContentElementTypeKey = Key("elementImage"), SettingsElementTypeKey = Key("elementBlockSettings") },
                new() { ContentElementTypeKey = Key("elementQuote") },
                new() { ContentElementTypeKey = Key("elementCallToAction") },
                new() { ContentElementTypeKey = Key("elementAccordionItem") },
            ],
        };

        var pageGrid = new BlockGridConfiguration
        {
            GridColumns = 12,
            Blocks =
            [
                new()
                {
                    ContentElementTypeKey = Key("elementGridRow"),
                    SettingsElementTypeKey = Key("elementGridSettings"),
                    AllowAtRoot = true,
                    AreaGridColumns = 12,
                    Areas =
                    [
                        new() { Key = Guid.Parse("11111111-0000-0000-0000-000000000001"), Alias = "left", ColumnSpan = 6, RowSpan = 1 },
                        new() { Key = Guid.Parse("11111111-0000-0000-0000-000000000002"), Alias = "right", ColumnSpan = 6, RowSpan = 1 },
                    ],
                },
                new() { ContentElementTypeKey = Key("elementGridColumn"), AllowInAreas = true },
                new() { ContentElementTypeKey = Key("elementCard"), AllowInAreas = true },
                new() { ContentElementTypeKey = Key("elementVideo"), AllowInAreas = true },
                new() { ContentElementTypeKey = Key("elementForm"), AllowInAreas = true },
            ],
        };

        var richText = new RichTextConfiguration
        {
            Blocks =
            [
                new() { ContentElementTypeKey = Key("elementRteFigure") },
                new() { ContentElementTypeKey = Key("elementQuote") },
            ],
        };

        // The Filter is the comma separated allow list the reference layer draws edges from.
        var relatedContent = new MultiNodePickerConfiguration
        {
            MaxNumber = 5,
            Filter = string.Join(',', FixedTypeKeys.Values),
        };

        // elementDoomed is deleted later, which leaves this configuration naming a key that
        // resolves to nothing. That is the planted broken block reference.
        var brokenBlocks = new BlockListConfiguration
        {
            Blocks =
            [
                new() { ContentElementTypeKey = Key("elementDoomed") },
                new() { ContentElementTypeKey = Key("elementCard") },
            ],
        };

        _editors.Add(await CreateDataTypeAsync("SC Body Blocks", UmbracoConstants.PropertyEditors.Aliases.BlockList, "Umb.PropertyEditorUi.BlockList", bodyBlocks));
        _editors.Add(await CreateDataTypeAsync("SC Page Grid", UmbracoConstants.PropertyEditors.Aliases.BlockGrid, "Umb.PropertyEditorUi.BlockGrid", pageGrid));
        _editors.Add(await CreateDataTypeAsync("SC Rich Text With Blocks", UmbracoConstants.PropertyEditors.Aliases.RichText, "Umb.PropertyEditorUi.Tiptap", richText));
        _editors.Add(await CreateDataTypeAsync("SC Related Content", UmbracoConstants.PropertyEditors.Aliases.MultiNodeTreePicker, "Umb.PropertyEditorUi.DocumentPicker", relatedContent));

        // Kept out of _editors so exactly one Document Type uses it.
        _brokenBlockList = await CreateDataTypeAsync("SC Broken Blocks", UmbracoConstants.PropertyEditors.Aliases.BlockList, "Umb.PropertyEditorUi.BlockList", brokenBlocks);
    }

    private async Task<IDataType> CreateDataTypeAsync(string name, string editorAlias, string editorUiAlias, object configuration)
    {
        IDataEditor editor = _propertyEditors[editorAlias];
        var dataType = new DataType(editor, _serializer, UmbracoConstants.System.Root)
        {
            Name = name,
            EditorUiAlias = editorUiAlias,
            DatabaseType = ValueStorageType.Ntext,
            ConfigurationData = editor.GetConfigurationEditor().FromConfigurationObject(configuration, _serializer),
        };

        Attempt<IDataType, DataTypeOperationStatus> attempt =
            await _dataTypeService.CreateAsync(dataType, UmbracoConstants.Security.SuperUserKey);
        if (attempt.Success is false)
        {
            throw new InvalidOperationException($"Could not create Data Type {name}: {attempt.Status}.");
        }

        return attempt.Result;
    }

    // ---------------------------------------------------------------- compositions

    /// <summary>
    /// Seven compositions. Five are used by many types, <c>unusedSeoComposition</c> is used by
    /// none, and <c>dupSeoMirror</c> exists to collide with <c>seoComposition</c> on one type.
    /// </summary>
    private void CreateCompositions(int folderId)
    {
        (string Alias, string Group, string[] Properties)[] specs =
        [
            ("seoComposition", "seo", ["seoTitle", "seoDescription", "seoKeywords", "seoCanonical", "seoNoIndex"]),
            ("openGraphComposition", "openGraph", ["ogTitle", "ogDescription", "ogImage"]),
            ("navigationComposition", "navigation", ["navHide", "navTitle", "navIcon"]),
            ("heroComposition", "hero", ["heroTitle", "heroImage", "heroBlocks"]),
            ("settingsComposition", "config", ["settingsGroup", "settingsValue"]),
            ("unusedSeoComposition", "seoLegacy", ["legacySeoTitle", "legacySeoDescription"]),
            ("dupSeoMirror", "seoMirror", ["seoTitle"]),
        ];

        for (int i = 0; i < specs.Length; i++)
        {
            IContentType type = NewType(specs[i].Alias, folderId, "icon-plugin");
            for (int p = 0; p < specs[i].Properties.Length; p++)
            {
                type.AddPropertyType(NewProperty(specs[i].Properties[p], _editors[(i + p) % _editors.Count]), specs[i].Group, Title(specs[i].Group));
            }

            Save(type);
        }
    }

    // ---------------------------------------------------------------- structure types

    /// <summary>One row of the seeded content tree. Children are wired up in a second pass.</summary>
    private sealed record TypeSpec(
        string Alias,
        string[] Children,
        string[] Compositions,
        int Properties,
        bool Root = false,
        bool Varies = false,
        string? Inherits = null);

    private static readonly TypeSpec[] StructureTypes =
    [
        new("site", ["home", "contactPage", "searchPage", "errorPage"], ["seoComposition", "navigationComposition"], 6, Root: true),
        new("microsite", ["micrositeHome"], ["seoComposition"], 4, Root: true),
        new("settings", ["settingsSection"], ["settingsComposition"], 3, Root: true),
        new("home", [
            "standardPage", "newsLanding", "eventLanding", "productLanding", "peopleLanding",
            "campaignHub", "faqPage", "galleryPage", "downloadCenter", "formPage",
            "contentFolder", "careersPage", "pressLanding", "landingPage", "pricingPage",
            "testimonialPage", "redirectPage", "sitemapPage", "emptyType", "noTemplatePage",
            "dupAliasPage", "brokenBlockHost",
        ], ["seoComposition", "openGraphComposition", "navigationComposition", "heroComposition"], 12),
        new("standardPage", ["standardPage", "contentFolder", "faqPage", "formPage"], ["seoComposition", "navigationComposition", "heroComposition"], 14),
        new("newsLanding", ["article", "contentFolder", "unusedArticleLegacy", "pressRelease"], ["seoComposition", "navigationComposition"], 7),
        new("article", [], ["seoComposition", "openGraphComposition"], 11),
        new("contentFolder", ["contentFolder", "article", "standardPage"], [], 2),
        new("eventLanding", ["eventPage", "contentFolder"], ["seoComposition", "navigationComposition"], 5),
        new("eventPage", ["eventSession"], ["seoComposition"], 9),
        new("eventSession", [], [], 4),
        new("productLanding", ["productCategory", "productPage"], ["seoComposition", "navigationComposition"], 5),
        new("productCategory", ["productPage", "productCategory"], ["seoComposition"], 6),
        new("productPage", ["productVariant"], ["seoComposition", "openGraphComposition"], 16),
        new("productVariant", [], [], 8),
        new("peopleLanding", ["personPage", "teamPage"], ["seoComposition"], 4),
        new("personPage", [], ["seoComposition"], 10),
        new("teamPage", ["personPage"], ["seoComposition"], 5),
        new("campaignHub", ["campaignPage"], ["seoComposition", "navigationComposition"], 3),
        new("campaignPage", [], ["seoComposition", "heroComposition"], 20, Varies: true),
        new("faqPage", ["faqCategory"], ["seoComposition"], 3),
        new("faqCategory", [], [], 2),
        new("galleryPage", ["galleryAlbum"], ["seoComposition"], 4),
        new("galleryAlbum", [], [], 3),
        new("downloadCenter", ["downloadPage"], ["seoComposition"], 3),
        new("downloadPage", [], [], 5),
        new("formPage", ["formThankYouPage"], ["seoComposition"], 7),
        new("formThankYouPage", [], [], 2),
        new("contactPage", ["officePage"], ["seoComposition", "openGraphComposition"], 9),
        new("officePage", [], [], 6),
        new("searchPage", [], ["seoComposition"], 2),
        new("errorPage", [], [], 1),
        new("redirectPage", [], [], 1),
        new("sitemapPage", [], ["seoComposition"], 1),
        new("landingPage", ["landingSection"], ["seoComposition", "openGraphComposition", "heroComposition"], 18),
        new("landingSection", [], [], 6),
        new("pricingPage", ["pricingTier"], ["seoComposition"], 5),
        new("pricingTier", [], [], 7),
        new("testimonialPage", ["testimonialEntry"], ["seoComposition"], 4),
        new("testimonialEntry", [], [], 3),
        new("careersPage", ["jobPosting"], ["seoComposition", "navigationComposition"], 4),
        new("jobPosting", [], ["seoComposition"], 13),
        new("pressLanding", ["pressRelease"], ["seoComposition"], 4),
        new("pressRelease", [], [], 3, Inherits: "article"),
        new("micrositeHome", ["standardPage", "blogLanding"], ["seoComposition", "navigationComposition", "heroComposition"], 8),
        new("blogLanding", ["blogPost", "contentFolder"], ["seoComposition"], 5),
        new("blogPost", [], ["seoComposition", "openGraphComposition"], 15, Varies: true),
        new("settingsSection", ["settingsEntry", "dictionaryPage"], ["settingsComposition"], 3),
        new("settingsEntry", [], ["settingsComposition"], 4),
        new("dictionaryPage", [], [], 2),

        // Planted findings. Each one is reachable in the tree except deadEndPromo, so that the
        // dead-end rule matches deadEndPromo and not the other seven.
        new("unusedArticleLegacy", [], ["seoComposition"], 6),
        new("emptyType", [], [], 0),
        new("noTemplatePage", [], ["seoComposition"], 5),
        new("dupAliasPage", [], ["seoComposition"], 4),
        new("brokenBlockHost", [], [], 3),
        new("deadEndPromo", [], ["seoComposition"], 5),
    ];

    private void CreateStructureTypes(int folderId)
    {
        // Every fourth type sits at the tree root instead of in the Pages folder, so the graph has
        // both foldered and unfoldered nodes.
        for (int i = 0; i < StructureTypes.Length; i++)
        {
            TypeSpec spec = StructureTypes[i];
            IContentType type = spec.Inherits is null
                ? NewType(spec.Alias, i % 4 == 3 ? UmbracoConstants.System.Root : folderId, Icons[i % Icons.Length])
                : NewInheritingType(spec.Alias, _types[spec.Inherits]);

            type.AllowedAsRoot = spec.Root;
            type.Variations = spec.Varies ? ContentVariation.Culture : ContentVariation.Nothing;
            type.Description = $"Seeded {Title(spec.Alias)}.";

            foreach (string composition in spec.Compositions)
            {
                type.AddContentType(_types[composition]);
            }

            AddProperties(type, spec.Alias, spec.Properties, mandatoryFirst: false, varies: spec.Varies);

            if (spec.Alias == "brokenBlockHost")
            {
                type.AddPropertyType(NewProperty("brokenBody", _brokenBlockList), "details", "Details");
            }

            Save(type);
        }
    }

    /// <summary>
    /// AllowedContentTypes has to wait until every type exists, because the tree has cycles
    /// (contentFolder allows itself, productCategory allows itself).
    /// </summary>
    private void LinkAllowedChildren()
    {
        foreach (TypeSpec spec in StructureTypes.Where(s => s.Children.Length > 0))
        {
            IContentType type = _types[spec.Alias];
            type.AllowedContentTypes = spec.Children
                .Select((alias, order) => new ContentTypeSort(_types[alias].Key, order, alias))
                .ToArray();
            Save(type);
        }
    }

    // ---------------------------------------------------------------- templates

    private async Task CreateTemplatesAsync()
    {
        (string Alias, string Name, string[] Types)[] specs =
        [
            ("scHome", "SC Home", ["home", "micrositeHome"]),
            ("scStandardPage", "SC Standard Page", ["standardPage", "landingPage"]),
            ("scArticle", "SC Article", ["article"]),
        ];

        foreach ((string alias, string name, string[] typeAliases) in specs)
        {
            Attempt<ITemplate, TemplateOperationStatus> attempt = await _templateService.CreateAsync(
                name, alias, "@inherits Umbraco.Cms.Web.Common.Views.UmbracoViewPage\n<h1>@Model.Name</h1>\n",
                UmbracoConstants.Security.SuperUserKey);

            foreach (string typeAlias in typeAliases)
            {
                IContentType type = _types[typeAlias];
                type.AllowedTemplates = [.. type.AllowedTemplates ?? [], attempt.Result];
                type.SetDefaultTemplate(type.AllowedTemplates!.First());
                Save(type);
            }
        }
    }

    // ---------------------------------------------------------------- planted findings

    /// <summary>
    /// Gives dupAliasPage two compositions that both declare <c>seoTitle</c>. AddContentType
    /// refuses that combination, so this assigns the collection directly. Umbraco's own
    /// validation on save only compares the saved type's own properties against its
    /// compositions, so a collision between two compositions goes through.
    /// </summary>
    private void PlantDuplicatePropertyAlias()
    {
        IContentType type = _types["dupAliasPage"];
        type.ContentTypeComposition = [_types["seoComposition"], _types["dupSeoMirror"]];
        Save(type);
    }

    private void DeleteDoomedElementType() =>
        _contentTypeService.Delete(_types["elementDoomed"], UmbracoConstants.Security.SuperUserId);

    // ---------------------------------------------------------------- content

    /// <summary>
    /// 193 items in a fixed shape: 183 published, 5 drafts, 5 in the recycle bin.
    /// </summary>
    /// <remarks>
    /// ponytail: no property values are written, so every block editor property is empty. The
    /// usage endpoint only counts nodes and versions, so this is enough for M3. Instance-level
    /// block usage, which parses property JSON, would need values here first.
    /// </remarks>
    private void CreateContent()
    {
        IContent site = Publish(Create("Contoso", UmbracoConstants.System.Root, "site"));
        IContent home = Publish(Create("Home", site.Id, "home"));
        Publish(Create("Contact", site.Id, "contactPage"));
        Publish(Create("Search", site.Id, "searchPage"));

        IContent news = Publish(Create("News", home.Id, "newsLanding"));
        for (int i = 1; i <= 150; i++)
        {
            IContent article = Create($"Article {i:D3}", news.Id, "article");
            if (i <= 140)
            {
                Publish(article);
            }
            else if (i <= 145)
            {
                _contentService.Save(article);
                _drafts++;
            }
            else
            {
                _contentService.Save(article);
                _contentService.MoveToRecycleBin(article);
                _trashed++;
            }
        }

        for (int f = 1; f <= 3; f++)
        {
            IContent folder = Publish(Create($"Archive {f}", news.Id, "contentFolder"));
            for (int i = 1; i <= 4; i++)
            {
                Publish(Create($"Archive {f} Item {i}", folder.Id, "article"));
            }
        }

        for (int i = 1; i <= 5; i++)
        {
            Publish(Create($"Page {i}", home.Id, "standardPage"));
        }

        IContent campaigns = Publish(Create("Campaigns", home.Id, "campaignHub"));
        for (int i = 1; i <= 2; i++)
        {
            PublishBothCultures(Create($"Campaign {i}", campaigns.Id, "campaignPage"), $"Campaign {i}", $"Kampagne {i}");
        }

        IContent microsite = Publish(Create("Contoso Labs", UmbracoConstants.System.Root, "microsite"));
        IContent labsHome = Publish(Create("Labs Home", microsite.Id, "micrositeHome"));
        IContent blog = Publish(Create("Blog", labsHome.Id, "blogLanding"));
        for (int i = 1; i <= 10; i++)
        {
            PublishBothCultures(Create($"Post {i}", blog.Id, "blogPost"), $"Post {i}", $"Indlaeg {i}");
        }

        IContent settings = Publish(Create("Settings", UmbracoConstants.System.Root, "settings"));
        Publish(Create("Global", settings.Id, "settingsSection"));
    }

    private IContent Create(string name, int parentId, string typeAlias) =>
        _contentService.Create(name, parentId, _types[typeAlias], UmbracoConstants.Security.SuperUserId);

    private IContent Publish(IContent content)
    {
        _contentService.Save(content);
        _contentService.Publish(content, ["*"], UmbracoConstants.Security.SuperUserId);
        _published++;
        return content;
    }

    private void PublishBothCultures(IContent content, string englishName, string danishName)
    {
        content.SetCultureName(englishName, DefaultCulture);
        content.SetCultureName(danishName, SecondCulture);
        _contentService.Save(content);
        _contentService.Publish(content, [DefaultCulture, SecondCulture], UmbracoConstants.Security.SuperUserId);
        _published++;
    }

    // ---------------------------------------------------------------- fixture export

    /// <summary>
    /// Writes the same graph the endpoint returns to Client/dev/fixtures/medium.json, so the dev
    /// harness renders a real schema. GeneratedAt is pinned, otherwise every boot would rewrite
    /// the file and dirty the working tree.
    /// </summary>
    private void ExportFixture()
    {
        string clientRoot = Path.GetFullPath(Path.Combine(_hostEnvironment.ContentRootPath, "..", "SchemaCity", "Client"));
        if (Directory.Exists(clientRoot) is false)
        {
            return;
        }

        string directory = Path.Combine(clientRoot, "dev", "fixtures");
        Directory.CreateDirectory(directory);

        SchemaGraph graph = SchemaGraphBuilder.BuildGraph(
            _contentTypeService.GetAll(),
            _contentTypeService.GetContainers([]));

        string path = Path.Combine(directory, "medium.json");
        System.IO.File.WriteAllText(path, JsonSerializer.Serialize(graph with { GeneratedAt = DateTimeOffset.UnixEpoch }, FixtureJson));
        _logger.LogInformation("Schema City seeder: wrote {Nodes} nodes to {Path}.", graph.Nodes.Count, path);
    }

    // ---------------------------------------------------------------- small helpers

    private static readonly string[] Icons =
    [
        "icon-document", "icon-newspaper color-blue", "icon-folder", "icon-store color-green",
        "icon-users", "icon-calendar color-red", "icon-globe", "icon-tags color-orange",
    ];

    private IContentType NewType(string alias, int parentId, string icon)
    {
        var type = new ContentType(_shortStringHelper, parentId) { Alias = alias, Name = Title(alias), Icon = icon };
        if (FixedTypeKeys.TryGetValue(alias, out Guid key))
        {
            type.Key = key;
        }

        _types[alias] = type;
        return type;
    }

    private IContentType NewInheritingType(string alias, IContentType parent)
    {
        var type = new ContentType(_shortStringHelper, parent, alias) { Name = Title(alias), Icon = "icon-documents" };
        _types[alias] = type;
        return type;
    }

    private IPropertyType NewProperty(string alias, IDataType dataType) =>
        new PropertyType(_shortStringHelper, dataType, alias) { Name = Title(alias) };

    /// <summary>
    /// Spreads <paramref name="count"/> properties over a tab, a group and a second tab, so group
    /// sizes and both PropertyGroupType values appear in the graph. Editors rotate through
    /// <see cref="_editors"/>, which puts Block List, Block Grid, Rich Text and the Multi Node
    /// Tree Picker on roughly a third of all types.
    /// </summary>
    private void AddProperties(IContentType type, string aliasPrefix, int count, bool mandatoryFirst, bool varies = false)
    {
        for (int i = 0; i < count; i++)
        {
            (string groupAlias, PropertyGroupType groupType) = i switch
            {
                < 8 when count > 4 => ("content", PropertyGroupType.Tab),
                < 14 when count > 10 => ("more", PropertyGroupType.Tab),
                _ => ("details", PropertyGroupType.Group),
            };

            IPropertyType property = NewProperty($"{aliasPrefix}Field{i + 1:D2}", _editors[(aliasPrefix.Length + i) % _editors.Count]);
            property.Mandatory = mandatoryFirst && i == 0;
            property.Variations = varies && i % 2 == 0 ? ContentVariation.Culture : ContentVariation.Nothing;
            type.AddPropertyType(property, groupAlias, Title(groupAlias));
            type.PropertyGroups[groupAlias].Type = groupType;
        }
    }

    private void Save(IContentType type)
    {
        _contentTypeService.Save(type, UmbracoConstants.Security.SuperUserId);
        _types[type.Alias!] = type;
    }

    /// <summary>"newsLanding" becomes "News Landing".</summary>
    private static string Title(string alias)
    {
        string spaced = string.Concat(alias.Select((c, i) => i > 0 && char.IsUpper(c) ? " " + c : $"{c}"));
        return char.ToUpperInvariant(spaced[0]) + spaced[1..];
    }
}
