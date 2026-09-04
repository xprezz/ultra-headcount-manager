using System.IO;
using System.Text.Json;

namespace UltraHeadcountManager.Desktop;

public sealed class DesktopSettings
{
    public EntraSettings Entra { get; init; } = new();

    public static DesktopSettings Load()
    {
        var path = Path.Combine(AppContext.BaseDirectory, "desktopsettings.json");
        if (!File.Exists(path)) return new DesktopSettings();
        return JsonSerializer.Deserialize<DesktopSettings>(
            File.ReadAllText(path),
            new JsonSerializerOptions { PropertyNameCaseInsensitive = true }) ?? new DesktopSettings();
    }
}

public sealed class EntraSettings
{
    public string ClientId { get; init; } = "";
    public string TenantId { get; init; } = "organizations";
}
