using System.ComponentModel;
using System.Diagnostics;
using System.IO;
using System.Windows;
using Microsoft.Web.WebView2.Core;
using Microsoft.Win32;

namespace UltraHeadcountManager.Desktop;

public partial class MainWindow : Window
{
    private NativeBridge? _bridge;
    private bool _allowClose;

    public MainWindow()
    {
        InitializeComponent();
        Loaded += OnLoaded;
        Closing += OnClosing;
    }

    private async void OnLoaded(object sender, RoutedEventArgs e)
    {
        try
        {
            var webViewData = Path.Combine(
                Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
                "Ultra Headcount Manager",
                "WebView2");
            Directory.CreateDirectory(webViewData);
            var environment = await CoreWebView2Environment.CreateAsync(userDataFolder: webViewData);
            await WebView.EnsureCoreWebView2Async(environment);

            WebView.CoreWebView2.Settings.AreDevToolsEnabled =
#if DEBUG
                true;
#else
                false;
#endif
            WebView.CoreWebView2.Settings.AreDefaultContextMenusEnabled = false;
            WebView.CoreWebView2.Settings.IsStatusBarEnabled = false;
            WebView.AllowExternalDrop = false;

            var webRoot = Path.Combine(AppContext.BaseDirectory, "WebApp");
            var index = Path.Combine(webRoot, "index.html");
            if (!File.Exists(index))
                throw new FileNotFoundException("The application interface is missing.", index);

            WebView.CoreWebView2.SetVirtualHostNameToFolderMapping(
                "app.uhm.local",
                webRoot,
                CoreWebView2HostResourceAccessKind.DenyCors);

            var settings = DesktopSettings.Load();
            _bridge = new NativeBridge(WebView, this, settings);
            WebView.CoreWebView2.WebMessageReceived += _bridge.OnMessageReceived;
            WebView.CoreWebView2.NavigationStarting += (_, args) =>
            {
                if (NativeBridge.IsTrustedOrigin(args.Uri)) return;
                args.Cancel = true;
                if (Uri.TryCreate(args.Uri, UriKind.Absolute, out var uri) &&
                    (uri.Scheme == Uri.UriSchemeHttps || uri.Scheme == Uri.UriSchemeHttp))
                {
                    Process.Start(new ProcessStartInfo(uri.AbsoluteUri) { UseShellExecute = true });
                }
            };
            WebView.CoreWebView2.NewWindowRequested += (_, args) =>
            {
                args.Handled = true;
                if (Uri.TryCreate(args.Uri, UriKind.Absolute, out var uri) &&
                    (uri.Scheme == Uri.UriSchemeHttps || uri.Scheme == Uri.UriSchemeHttp))
                {
                    Process.Start(new ProcessStartInfo(uri.AbsoluteUri) { UseShellExecute = true });
                }
            };
            WebView.CoreWebView2.DownloadStarting += (_, args) =>
            {
                var dialog = new SaveFileDialog
                {
                    FileName = Path.GetFileName(args.ResultFilePath),
                    AddExtension = true,
                    OverwritePrompt = true
                };
                if (dialog.ShowDialog(this) == true)
                {
                    args.ResultFilePath = dialog.FileName;
                }
                else
                {
                    args.Cancel = true;
                }
            };

            WebView.Source = new Uri("https://app.uhm.local/index.html?desktop=1");
        }
        catch (Exception error)
        {
            MessageBox.Show(
                $"Ultra Headcount Manager could not start.\n\n{error.Message}",
                "Startup error",
                MessageBoxButton.OK,
                MessageBoxImage.Error);
            Close();
        }
    }

    private async void OnClosing(object? sender, CancelEventArgs e)
    {
        if (_allowClose || WebView.CoreWebView2 is null) return;
        e.Cancel = true;
        try
        {
            await WebView.ExecuteScriptAsync(
                "window.CUHM && window.CUHM.APP.ready ? window.CUHM.STORE.flush(window.CUHM.APP.state) : Promise.resolve()");
        }
        catch
        {
            // Every mutation is already autosaved; closing must not trap the user.
        }
        _allowClose = true;
        Close();
    }
}
