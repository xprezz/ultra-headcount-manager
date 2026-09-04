using System.Net;
using System.Net.Http;
using System.Net.Http.Headers;
using System.Text.Json.Nodes;

namespace UltraHeadcountManager.Desktop;

public sealed class DirectoryService
{
    private const string SelectFields =
        "id,displayName,mail,userPrincipalName,jobTitle,department,officeLocation,employeeType,accountEnabled";
    private readonly HttpClient _http = new();
    private readonly MicrosoftAuthService _auth;

    public DirectoryService(MicrosoftAuthService auth)
    {
        _auth = auth;
    }

    public async Task<object> SyncAsync(
        string leaderValue,
        int maxDepth,
        bool includeInactive,
        Action<object> progress)
    {
        var token = await _auth.GetGraphTokenAsync();
        var leader = await ResolveLeaderAsync(leaderValue, token);
        var output = new List<object>();
        var visited = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        var queue = new Queue<(JsonObject User, JsonObject? Manager, int Depth)>();
        queue.Enqueue((leader, null, 0));

        while (queue.Count > 0)
        {
            var item = queue.Dequeue();
            var id = Text(item.User, "id");
            if (string.IsNullOrWhiteSpace(id) || !visited.Add(id)) continue;

            if (includeInactive || Bool(item.User, "accountEnabled") is not false)
                output.Add(ToPerson(item.User, item.Manager));

            progress(new
            {
                people = output.Count,
                queued = queue.Count,
                current = Text(item.User, "displayName"),
                depth = item.Depth
            });

            if (item.Depth >= maxDepth) continue;
            var reports = await GetPagedAsync(
                $"/users/{Uri.EscapeDataString(id)}/directReports?$select={SelectFields}",
                token);
            foreach (var report in reports)
            {
                var type = Text(report, "@odata.type");
                if (string.IsNullOrWhiteSpace(type) || type == "#microsoft.graph.user")
                    queue.Enqueue((report, item.User, item.Depth + 1));
            }

            if (visited.Count > 5000)
                throw new BridgeException("directory_limit", "The organization exceeded the 5,000-person safety limit.");
        }

        return new
        {
            people = output,
            leader = new { id = Text(leader, "id"), displayName = Text(leader, "displayName") },
            visited = visited.Count
        };
    }

    private async Task<JsonObject> ResolveLeaderAsync(string value, string token)
    {
        var input = (value ?? "").Trim();
        if (string.IsNullOrWhiteSpace(input) || input.Equals("me", StringComparison.OrdinalIgnoreCase))
            return await GetObjectAsync($"/me?$select={SelectFields}", token);

        try
        {
            return await GetObjectAsync(
                $"/users/{Uri.EscapeDataString(input)}?$select={SelectFields}",
                token);
        }
        catch (BridgeException error) when (error.Status == (int)HttpStatusCode.NotFound)
        {
            var escaped = input.Replace("'", "''", StringComparison.Ordinal);
            var filter = Uri.EscapeDataString($"mail eq '{escaped}'");
            var matches = await GetPagedAsync($"/users?$filter={filter}&$select={SelectFields}", token);
            return matches.Count switch
            {
                1 => matches[0],
                0 => throw new BridgeException("leader_not_found", $"No user was found for {input}.", 404),
                _ => throw new BridgeException("leader_ambiguous", $"More than one user has mail {input}. Use their UPN instead.")
            };
        }
    }

    private async Task<List<JsonObject>> GetPagedAsync(string path, string token)
    {
        var output = new List<JsonObject>();
        string? next = path;
        while (!string.IsNullOrWhiteSpace(next))
        {
            var page = await GetObjectAsync(next, token);
            if (page["value"] is JsonArray values)
            {
                output.AddRange(values.OfType<JsonObject>());
            }
            next = Text(page, "@odata.nextLink");
        }
        return output;
    }

    private async Task<JsonObject> GetObjectAsync(string pathOrUrl, string token)
    {
        var url = pathOrUrl.StartsWith("https://", StringComparison.OrdinalIgnoreCase)
            ? pathOrUrl
            : $"https://graph.microsoft.com/v1.0{pathOrUrl}";
        using var request = new HttpRequestMessage(HttpMethod.Get, url);
        request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", token);
        using var response = await _http.SendAsync(request);
        var body = await response.Content.ReadAsStringAsync();
        if (!response.IsSuccessStatusCode)
        {
            var detail = "";
            try
            {
                detail = JsonNode.Parse(body)?["error"]?["message"]?.GetValue<string>() ?? "";
            }
            catch
            {
            }
            throw new BridgeException(
                "graph_error",
                string.IsNullOrWhiteSpace(detail) ? $"Microsoft Graph returned {(int)response.StatusCode}." : detail,
                (int)response.StatusCode);
        }
        return JsonNode.Parse(body)?.AsObject()
            ?? throw new BridgeException("graph_invalid", "Microsoft Graph returned an invalid response.");
    }

    private static object ToPerson(JsonObject user, JsonObject? manager)
    {
        var employmentType = MapEmploymentType(Text(user, "employeeType"));
        return new
        {
            directoryId = Text(user, "id"),
            name = First(Text(user, "displayName"), Text(user, "mail"), Text(user, "userPrincipalName"), "Unnamed user"),
            email = First(Text(user, "mail"), Text(user, "userPrincipalName")),
            manager = manager is null ? "" : Text(manager, "displayName"),
            managerDirectoryId = manager is null ? "" : Text(manager, "id"),
            jobTitle = Text(user, "jobTitle"),
            family = Text(user, "department"),
            blueprintRole = First(Text(user, "jobTitle"), "Unassigned role"),
            location = Text(user, "officeLocation"),
            employmentType,
            directoryAccountEnabled = Bool(user, "accountEnabled") is not false,
            events = Array.Empty<object>()
        };
    }

    private static string MapEmploymentType(string value)
    {
        if (value.Contains("student", StringComparison.OrdinalIgnoreCase)) return "Student worker";
        if (value.Contains("intern", StringComparison.OrdinalIgnoreCase)) return "Intern";
        if (value.Contains("apprentice", StringComparison.OrdinalIgnoreCase) ||
            value.Contains("trainee", StringComparison.OrdinalIgnoreCase)) return "Apprentice";
        if (value.Contains("vendor", StringComparison.OrdinalIgnoreCase)) return "Vendor";
        if (value.Contains("contract", StringComparison.OrdinalIgnoreCase) ||
            value.Contains("external", StringComparison.OrdinalIgnoreCase) ||
            value.Contains("consultant", StringComparison.OrdinalIgnoreCase)) return "Contractor";
        return "Employee";
    }

    private static string Text(JsonObject value, string key) =>
        value[key]?.GetValue<string>() ?? "";

    private static bool? Bool(JsonObject value, string key) =>
        value[key]?.GetValue<bool?>();

    private static string First(params string[] values) =>
        values.FirstOrDefault(value => !string.IsNullOrWhiteSpace(value)) ?? "";
}
