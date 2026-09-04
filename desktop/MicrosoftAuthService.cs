using System.Windows.Interop;
using Microsoft.Identity.Client;
using Microsoft.Identity.Client.Broker;

namespace UltraHeadcountManager.Desktop;

public sealed class MicrosoftAuthService
{
    private static readonly string[] Scopes = ["User.Read.All"];
    private readonly IPublicClientApplication _client;
    private readonly MainWindow _window;

    public MicrosoftAuthService(EntraSettings settings, MainWindow window)
    {
        if (string.IsNullOrWhiteSpace(settings.ClientId))
            throw new BridgeException(
                "directory_not_configured",
                "Microsoft 365 import has not been enabled by the app publisher.");

        _window = window;
        _client = PublicClientApplicationBuilder
            .Create(settings.ClientId)
            .WithAuthority(AzureCloudInstance.AzurePublic, settings.TenantId)
            .WithDefaultRedirectUri()
            .WithBroker(new BrokerOptions(BrokerOptions.OperatingSystems.Windows)
            {
                Title = "Ultra Headcount Manager"
            })
            .Build();
    }

    public async Task<string> GetGraphTokenAsync()
    {
        var accounts = await _client.GetAccountsAsync();
        var account = accounts.FirstOrDefault() ?? PublicClientApplication.OperatingSystemAccount;
        try
        {
            var silent = await _client.AcquireTokenSilent(Scopes, account).ExecuteAsync();
            return silent.AccessToken;
        }
        catch (MsalUiRequiredException)
        {
        }

        var handle = new WindowInteropHelper(_window).Handle;
        var interactive = await _client
            .AcquireTokenInteractive(Scopes)
            .WithAccount(account)
            .WithParentActivityOrWindow(handle)
            .WithPrompt(Prompt.SelectAccount)
            .ExecuteAsync();
        return interactive.AccessToken;
    }
}
