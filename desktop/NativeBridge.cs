using System.IO;
using System.Text.Json;
using System.Text.Json.Nodes;
using System.Windows;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.Wpf;

namespace UltraHeadcountManager.Desktop;

public sealed class NativeBridge
{
    private const string TrustedOrigin = "https://app.uhm.local";
    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web);
    private readonly WebView2 _webView;
    private readonly MainWindow _window;
    private readonly DesktopSettings _settings;
    private readonly StateStore _state = new();

    public NativeBridge(WebView2 webView, MainWindow window, DesktopSettings settings)
    {
        _webView = webView;
        _window = window;
        _settings = settings;
    }

    public async void OnMessageReceived(object? sender, CoreWebView2WebMessageReceivedEventArgs args)
    {
        int? id = null;
        try
        {
            if (!IsTrustedOrigin(args.Source))
                throw new BridgeException("untrusted_origin", "The desktop request did not come from the application.");
            var request = JsonNode.Parse(args.WebMessageAsJson)?.AsObject()
                ?? throw new BridgeException("invalid_request", "The desktop request was empty.");
            id = request["id"]?.GetValue<int>()
                ?? throw new BridgeException("invalid_request", "The desktop request had no ID.");
            var method = request["method"]?.GetValue<string>() ?? "";
            var payload = request["payload"]?.AsObject() ?? new JsonObject();
            var result = await DispatchAsync(method, payload);
            Reply(new { id, ok = true, result });
        }

        catch (BridgeException error)
        {
            Reply(new
            {
                id,
                ok = false,
                error = new { code = error.Code, message = error.Message, status = error.Status }
            });
        }
        catch (Exception error)
        {
            Reply(new
            {
                id,
                ok = false,
                error = new { code = "desktop_error", message = error.Message }
            });
        }
    }

    public static bool IsTrustedOrigin(string? value) =>
        Uri.TryCreate(value, UriKind.Absolute, out var uri) &&
        uri.Scheme == Uri.UriSchemeHttps &&
        uri.Host.Equals("app.uhm.local", StringComparison.OrdinalIgnoreCase) &&
        uri.IsDefaultPort;

    private async Task<object> DispatchAsync(string method, JsonObject payload)
    {
        return method switch
        {
            "state.load" => (object)await _state.LoadAsync(),
            "state.save" => (object)await _state.SaveAsync(
                payload["json"]?.GetValue<string>()
                    ?? throw new BridgeException("invalid_state", "No plan data was supplied."),
                payload["backup"]?.GetValue<bool>() ?? false),
            "directory.status" => (object)new
            {
                configured = !string.IsNullOrWhiteSpace(_settings.Entra.ClientId)
            },
            "directory.sync" => (object)await SyncDirectoryAsync(payload),
            "app.info" => (object)new
            {
                platform = "windows",
                version = typeof(NativeBridge).Assembly.GetName().Version?.ToString() ?? "1.0.0",
                dataLocation = Path.Combine(
                    Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
                    "Ultra Headcount Manager")
            },
            _ => throw new BridgeException("unknown_method", $"Unknown desktop method: {method}")
        };
    }

    private async Task<object> SyncDirectoryAsync(JsonObject payload)
    {
        if (string.IsNullOrWhiteSpace(_settings.Entra.ClientId))
            throw new BridgeException(
                "directory_not_configured",
                "Microsoft 365 import has not been enabled by the app publisher.");

        try
        {
            var auth = new MicrosoftAuthService(_settings.Entra, _window);
            var directory = new DirectoryService(auth);
            return await directory.SyncAsync(
                payload["leader"]?.GetValue<string>() ?? "Me",
                Math.Clamp(payload["maxDepth"]?.GetValue<int>() ?? 99, 1, 99),
                payload["includeInactive"]?.GetValue<bool>() ?? false,
                progress => Event("directory.progress", progress));
        }
        catch (Microsoft.Identity.Client.MsalException error)
        {
            throw new BridgeException("microsoft_signin", error.Message, null, error);
        }
    }

    private void Event(string name, object payload) =>
        Reply(new { @event = name, payload });

    private void Reply(object value)
    {
        if (_webView.CoreWebView2 is null) return;
        _webView.CoreWebView2.PostWebMessageAsJson(JsonSerializer.Serialize(value, JsonOptions));
    }
}
