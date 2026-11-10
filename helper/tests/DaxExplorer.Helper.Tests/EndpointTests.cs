using System.Net;
using System.Net.Http.Json;
using System.Text.Json;
using DaxExplorer.Helper.Discovery;
using DaxExplorer.Helper.Model;
using DaxExplorer.Helper.Server;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.TestHost;
using Microsoft.Extensions.DependencyInjection;

namespace DaxExplorer.Helper.Tests;

/// <summary>The helper's HTTP endpoints and security rules, using an in-memory server and fake Power BI.</summary>
public sealed class EndpointTests : IAsyncLifetime
{
    private const string Token = "test-token-0123456789abcdef";

    private sealed class FakeInstances : IDesktopInstances
    {
        public List<DesktopInstance> Instances { get; } = [new(61403, "C:\\ws", 4242, "Synthetic Sales")];
        public IReadOnlyList<DesktopInstance> Find() => Instances;
    }

    private sealed class FakeModelSource : IModelSource
    {
        public bool Fail { get; set; }
        public List<int> PortsRead { get; } = [];
        public ModelMetadata ReadDesktopModel(int port)
        {
            PortsRead.Add(port);
            if (Fail) throw new InvalidOperationException("engine busy");
            return new ModelMetadata("db", [new TableInfo("Sales", false, null)], [], [new MeasureInfo("Sales", "Total Sales", "SUM(Sales[Amount])", null, false, null)], []);
        }
    }

    private readonly FakeInstances _instances = new();
    private readonly FakeModelSource _source = new();
    private WebApplication _app = null!;
    private HttpClient _client = null!;

    public async Task InitializeAsync()
    {
        _app = HelperServer.Build(new HelperOptions(0, AppPath: null, Token), builder =>
        {
            builder.WebHost.UseTestServer();
            builder.Services.AddSingleton<IDesktopInstances>(_instances);
            builder.Services.AddSingleton<IModelSource>(_source);
        });
        await _app.StartAsync();
        _client = _app.GetTestClient();
        _client.BaseAddress = new Uri("http://127.0.0.1/");
    }

    public async Task DisposeAsync()
    {
        _client.Dispose();
        await _app.DisposeAsync();
    }

    private HttpRequestMessage Request(HttpMethod method, string path, string? token = Token, object? body = null)
    {
        var request = new HttpRequestMessage(method, path);
        if (token is not null) request.Headers.Add(TokenGuard.HeaderName, token);
        if (body is not null) request.Content = JsonContent.Create(body);
        return request;
    }

    private async Task<JsonElement> Json(HttpResponseMessage response) =>
        JsonDocument.Parse(await response.Content.ReadAsStringAsync()).RootElement;

    // ------------------------------------------------------------------ security

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("wrong-token")]
    [InlineData("test-token-0123456789abcdeX")]
    public async Task Rejects_api_requests_without_the_right_token(string? token)
    {
        var response = await _client.SendAsync(Request(HttpMethod.Get, "/api/status", token));
        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
    }

    [Fact]
    public async Task Rejects_requests_for_other_host_names_DNS_rebinding()
    {
        var request = Request(HttpMethod.Get, "/api/status");
        request.Headers.Host = "evil.example.com";
        var response = await _client.SendAsync(request);
        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
    }

    [Fact]
    public async Task Sends_protective_headers_and_never_caches_api_responses()
    {
        var response = await _client.SendAsync(Request(HttpMethod.Get, "/api/status"));
        Assert.Equal("nosniff", response.Headers.GetValues("X-Content-Type-Options").Single());
        Assert.Equal("no-referrer", response.Headers.GetValues("Referrer-Policy").Single());
        Assert.Equal("no-store", response.Headers.CacheControl?.ToString());
    }

    [Fact]
    public async Task The_app_page_itself_needs_no_token()
    {
        var response = await _client.GetAsync("/");
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.Contains("has not been built yet", await response.Content.ReadAsStringAsync());
    }

    [Fact]
    public async Task Unknown_api_paths_are_404_not_the_app_page()
    {
        var response = await _client.SendAsync(Request(HttpMethod.Get, "/api/nothing-here"));
        Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
    }

    // ------------------------------------------------------------------ connect flow

    [Fact]
    public async Task Lists_open_desktop_reports()
    {
        var body = await Json(await _client.SendAsync(Request(HttpMethod.Get, "/api/desktop/instances")));
        var item = Assert.Single(body.EnumerateArray());
        Assert.Equal(61403, item.GetProperty("port").GetInt32());
        Assert.Equal("Synthetic Sales", item.GetProperty("reportName").GetString());
    }

    [Fact]
    public async Task Connects_reads_the_model_and_reports_it_in_status()
    {
        var connect = await _client.SendAsync(Request(HttpMethod.Post, "/api/connect", body: new { port = 61403 }));
        Assert.Equal(HttpStatusCode.OK, connect.StatusCode);

        var status = await Json(await _client.SendAsync(Request(HttpMethod.Get, "/api/status")));
        Assert.Equal("Synthetic Sales", status.GetProperty("connection").GetProperty("reportName").GetString());
        Assert.Equal(1, status.GetProperty("modelSummary").GetProperty("measures").GetInt32());

        var model = await Json(await _client.SendAsync(Request(HttpMethod.Get, "/api/model")));
        Assert.Equal("SUM(Sales[Amount])", model.GetProperty("measures")[0].GetProperty("expression").GetString());
    }

    [Fact]
    public async Task Refuses_to_connect_to_a_port_that_is_not_an_open_desktop_report()
    {
        var response = await _client.SendAsync(Request(HttpMethod.Post, "/api/connect", body: new { port = 1433 }));
        Assert.Equal(HttpStatusCode.NotFound, response.StatusCode);
        Assert.Empty(_source.PortsRead); // never even tried to connect
    }

    [Fact]
    public async Task Reports_a_friendly_error_when_the_model_cannot_be_read()
    {
        _source.Fail = true;
        var response = await _client.SendAsync(Request(HttpMethod.Post, "/api/connect", body: new { port = 61403 }));
        Assert.Equal(HttpStatusCode.BadGateway, response.StatusCode);
        var body = await response.Content.ReadAsStringAsync();
        Assert.Contains("Could not read the model", body);
        Assert.DoesNotContain("engine busy", body); // internal details are not exposed
    }

    [Fact]
    public async Task Disconnect_forgets_the_model()
    {
        await _client.SendAsync(Request(HttpMethod.Post, "/api/connect", body: new { port = 61403 }));
        await _client.SendAsync(Request(HttpMethod.Post, "/api/disconnect"));

        var status = await Json(await _client.SendAsync(Request(HttpMethod.Get, "/api/status")));
        Assert.Equal(JsonValueKind.Null, status.GetProperty("connection").ValueKind);
        Assert.Equal(HttpStatusCode.NotFound, (await _client.SendAsync(Request(HttpMethod.Get, "/api/model"))).StatusCode);
    }

    [Fact]
    public void Tokens_are_random_and_long()
    {
        var a = TokenGuard.NewToken();
        var b = TokenGuard.NewToken();
        Assert.NotEqual(a, b);
        Assert.True(a.Length >= 40);
        Assert.DoesNotContain('+', a);
        Assert.DoesNotContain('/', a);
    }
}
