using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Options;
using SchemaCity.Api;
using SchemaCity.Models;

namespace SchemaCity.Tests;

public class ClientSettingsTests
{
    // The settings endpoint reads options alone, so the graph builder it never touches stays null.
    private static ClientSettings SettingsFor(Dictionary<string, string?> appsettings)
    {
        SchemaCityOptions options = new();
        new ConfigurationBuilder()
            .AddInMemoryCollection(appsettings)
            .Build()
            .GetSection(SchemaCityOptions.SectionName)
            .Bind(options);
        return new GraphController(null!, Options.Create(options)).Settings();
    }

    [Fact]
    public void Opens_on_the_flat_map_when_appsettings_says_nothing()
    {
        Assert.Equal("clean", SettingsFor([]).Variant);
    }

    [Theory]
    [InlineData("City", "city")]
    [InlineData("city", "city")]
    [InlineData(" CITY ", "city")]
    [InlineData("Clean", "clean")]
    // The words the UI uses for the looks are not values, and open the flat map rather than
    // failing the options binding for every reader of them.
    [InlineData("Map", "clean")]
    [InlineData("3D", "clean")]
    [InlineData("", "clean")]
    public void Sends_the_variant_appsettings_names_in_lower_case(string configured, string sent)
    {
        Assert.Equal(sent, SettingsFor(new() { ["SchemaCity:Variant"] = configured }).Variant);
    }
}
