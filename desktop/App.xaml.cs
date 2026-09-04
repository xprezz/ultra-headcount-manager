using System.Threading;
using System.Windows;

namespace UltraHeadcountManager.Desktop;

public partial class App : Application
{
    private Mutex? _singleInstance;

    protected override void OnStartup(StartupEventArgs e)
    {
        _singleInstance = new Mutex(true, "UltraHeadcountManager.Desktop.SingleInstance", out var created);
        if (!created)
        {
            MessageBox.Show(
                "Ultra Headcount Manager is already open.",
                "Ultra Headcount Manager",
                MessageBoxButton.OK,
                MessageBoxImage.Information);
            Shutdown();
            return;
        }

        base.OnStartup(e);
        var window = new MainWindow();
        MainWindow = window;
        window.Show();
    }

    protected override void OnExit(ExitEventArgs e)
    {
        _singleInstance?.ReleaseMutex();
        _singleInstance?.Dispose();
        base.OnExit(e);
    }
}
