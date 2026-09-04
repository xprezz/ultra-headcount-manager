using System.IO;
using System.Text;
using System.Text.Json;

namespace UltraHeadcountManager.Desktop;

public sealed class StateStore
{
    private const int MaxBackups = 20;
    private static readonly UTF8Encoding Utf8NoBom = new(false);
    private readonly SemaphoreSlim _gate = new(1, 1);
    private readonly string _root;
    private readonly string _dataFile;
    private readonly string _recoveryFile;
    private readonly string _backupDirectory;

    public StateStore()
    {
        _root = Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
            "Ultra Headcount Manager");
        _dataFile = Path.Combine(_root, "headcount-plan.json");
        _recoveryFile = Path.Combine(_root, "headcount-plan.previous.json");
        _backupDirectory = Path.Combine(_root, "Backups");
    }

    public async Task<object> LoadAsync()
    {
        await _gate.WaitAsync();
        try
        {
            Directory.CreateDirectory(_root);
            if (!File.Exists(_dataFile) && !File.Exists(_recoveryFile))
                return new { json = (string?)null, displayName = "Headcount plan", lastSaved = (string?)null };

            if (File.Exists(_dataFile))
            {
                var primary = await TryReadValidJsonAsync(_dataFile);
                if (primary is not null)
                    return new
                    {
                        json = primary,
                        displayName = "Headcount plan",
                        lastSaved = File.GetLastWriteTimeUtc(_dataFile).ToString("O"),
                        recovered = false
                    };
            }

            if (File.Exists(_recoveryFile))
            {
                var recovery = await TryReadValidJsonAsync(_recoveryFile);
                if (recovery is not null)
                    return new
                    {
                        json = recovery,
                        displayName = "Recovered headcount plan",
                        lastSaved = File.GetLastWriteTimeUtc(_recoveryFile).ToString("O"),
                        recovered = true
                    };
            }

            throw new BridgeException(
                "state_corrupt",
                "The saved plan and its recovery copy are damaged. The files were preserved for support.");
        }

        finally
        {
            _gate.Release();
        }
    }

    private static async Task<string?> TryReadValidJsonAsync(string path)
    {
        try
        {
            var json = await File.ReadAllTextAsync(path, Utf8NoBom);
            using var document = JsonDocument.Parse(json);
            var root = document.RootElement;
            if (root.ValueKind != JsonValueKind.Object ||
                !root.TryGetProperty("people", out var people) ||
                people.ValueKind != JsonValueKind.Array ||
                !root.TryGetProperty("blueprint", out var blueprint) ||
                blueprint.ValueKind != JsonValueKind.Array)
            {
                return null;
            }
            return json;
        }
        catch (JsonException)
        {
            return null;
        }
    }

    public async Task<object> SaveAsync(string json, bool backup)
    {
        JsonDocument.Parse(json).Dispose();
        await _gate.WaitAsync();
        try
        {
            Directory.CreateDirectory(_root);
            if (backup && File.Exists(_dataFile))
            {
                Directory.CreateDirectory(_backupDirectory);
                var stamp = DateTime.UtcNow.ToString("yyyy-MM-dd_HH-mm-ss-fff");
                File.Copy(_dataFile, Path.Combine(_backupDirectory, $"UHM_{stamp}.json"), false);
                PruneBackups();
            }

            var temporary = Path.Combine(_root, $"headcount-plan.{Guid.NewGuid():N}.tmp");
            await using (var stream = new FileStream(
                temporary,
                FileMode.CreateNew,
                FileAccess.Write,
                FileShare.None,
                64 * 1024,
                FileOptions.Asynchronous | FileOptions.WriteThrough))
            {
                var bytes = Utf8NoBom.GetBytes(json);
                await stream.WriteAsync(bytes);
                await stream.FlushAsync();
            }

            if (File.Exists(_dataFile))
            {
                File.Replace(temporary, _dataFile, _recoveryFile, true);
            }
            else
            {
                File.Move(temporary, _dataFile);
            }

            var saved = File.GetLastWriteTimeUtc(_dataFile).ToString("O");
            return new { displayName = "Headcount plan", lastSaved = saved };
        }
        finally
        {
            _gate.Release();
        }
    }

    private void PruneBackups()
    {
        var files = new DirectoryInfo(_backupDirectory)
            .GetFiles("UHM_*.json")
            .OrderByDescending(file => file.CreationTimeUtc)
            .Skip(MaxBackups);
        foreach (var file in files) file.Delete();
    }
}
