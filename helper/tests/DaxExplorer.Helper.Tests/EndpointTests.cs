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
        /// <summary>Models by port; ports not listed get the default one-table model.</summary>
        public Dictionary<int, ModelMetadata> Models { get; } = [];
        public ModelMetadata ReadDesktopModel(int port)
        {
            PortsRead.Add(port);
            if (Fail) throw new InvalidOperationException("engine busy");
            if (Models.TryGetValue(port, out var model)) return model;
            return new ModelMetadata("db", [new TableInfo("Sales", false, null)], [], [new MeasureInfo("Sales", "Total Sales", "SUM(Sales[Amount])", null, false, null)], []);
        }
    }

    private sealed class FakeSampleLauncher : ISampleLauncher
    {
        public bool IsAvailable { get; set; } = true;
        public int Opened { get; private set; }
        public bool Fail { get; set; }
        public void Open()
        {
            if (Fail) throw new System.ComponentModel.Win32Exception("no program for .pbip");
            Opened++;
        }
    }

    private sealed class FakeClock : TimeProvider
    {
        public DateTimeOffset Now { get; set; } = new(2026, 11, 10, 9, 0, 0, TimeSpan.Zero);
        public override DateTimeOffset GetUtcNow() => Now;
    }

    private readonly FakeInstances _instances = new();
    private readonly FakeSampleLauncher _launcher = new();
    private readonly FakeClock _clock = new();

    private sealed class FakeQueryRunner : IQueryRunner
    {
        public List<(int Port, string Database, string Query, int MaxRows)> Runs { get; } = [];
        public QueryResult Result { get; set; } = new(["[value]"], [[42.5]], false);
        public QueryResult Run(int port, string database, string query, int maxRows, TimeSpan timeout)
        {
            Runs.Add((port, database, query, maxRows));
            return Result;
        }
    }

    private readonly FakeQueryRunner _runner = new();

    private sealed class FakeCaptureSource : ICaptureSource
    {
        public Action<CapturedQueryEvent>? OnQuery { get; private set; }
        public int? Port { get; private set; }
        public int Started { get; private set; }
        public int Stopped { get; private set; }
        public bool Fail { get; set; }
        public IDisposable Start(int port, Action<CapturedQueryEvent> onQuery)
        {
            if (Fail) throw new InvalidOperationException("trace refused");
            Started++;
            Port = port;
            OnQuery = onQuery;
            return new Stopper(this);
        }
        public void Push(string text, string subclass = "DAXQuery", string app = "Power BI Desktop0da6b7a1") =>
            OnQuery?.Invoke(new CapturedQueryEvent(text, subclass, app));
        private sealed class Stopper(FakeCaptureSource owner) : IDisposable
        {
            public void Dispose() => owner.Stopped++;
        }
    }

    private readonly FakeCaptureSource _capture = new();

    private sealed class FakeSessions : ISessionCommands
    {
        public List<SessionCommand> Commands { get; } = [];
        public bool Fail { get; set; }
        public IReadOnlyList<SessionCommand> Read(int port) => Fail ? throw new InvalidOperationException("engine gone") : Commands;
    }

    private readonly FakeSessions _sessions = new();

    /// <summary>Stands in for the Windows administrator prompt: does what the elevated program would, in a temp folder.</summary>
    private sealed class FakeElevation(string folder, string exePath) : IElevation
    {
        public List<string> Calls { get; } = [];
        public string Answer { get; set; } = "ok";
        public string RunElevated(string argument)
        {
            Calls.Add(argument);
            if (Answer != "ok") return Answer;
            if (argument == ExternalTool.InstallArgument) ExternalTool.Install(folder, exePath, "AAAA");
            else ExternalTool.Remove(folder);
            return "ok";
        }
    }

    private readonly string _toolFolder = Path.Combine(Path.GetTempPath(), "DaxExplorerToolTests", Guid.NewGuid().ToString("N"));
    private const string ToolExe = @"C:ToolsDaxExplorerDaxExplorer.exe";
    private FakeElevation _elevation = null!;
    private readonly FakeModelSource _source = new();
    private readonly FakeTimings _timings = new();

    private sealed class FakeTimings : ITimingSource
    {
        public List<(int Port, string Database, string Query, bool ClearCache)> Runs { get; } = [];
        public Exception? Throw { get; set; }
        public TimingResult Measure(int port, string database, string query, bool clearCache, TimeSpan timeout)
        {
            Runs.Add((port, database, query, clearCache));
            if (Throw is not null) throw Throw;
            return new TimingResult(12, 9, [new TimingScan("SELECT SUM(...) FROM Sales", 3, 2, 1.5, 4.5, false), new TimingScan("SELECT ...", null, null, null, null, true)], 1, clearCache);
        }
    }
    private WebApplication _app = null!;
    private HttpClient _client = null!;

    public async Task InitializeAsync()
    {
        _app = HelperServer.Build(new HelperOptions(0, AppPath: null, Token), builder =>
        {
            builder.WebHost.UseTestServer();
            builder.Services.AddSingleton<IDesktopInstances>(_instances);
            builder.Services.AddSingleton<IModelSource>(_source);
            builder.Services.AddSingleton<ISampleLauncher>(_launcher);
            builder.Services.AddSingleton<TimeProvider>(_clock);
            builder.Services.AddSingleton<IQueryRunner>(_runner);
            builder.Services.AddSingleton<ITimingSource>(_timings);
            builder.Services.AddSingleton<ICaptureSource>(_capture);
            builder.Services.AddSingleton<ISessionCommands>(_sessions);
            _elevation = new FakeElevation(_toolFolder, ToolExe);
            builder.Services.AddSingleton<IElevation>(_elevation);
            builder.Services.AddSingleton(new ExternalToolPlace(_toolFolder, ToolExe));
        });
        await _app.StartAsync();
        _client = _app.GetTestClient();
        _client.BaseAddress = new Uri("http://127.0.0.1/");
    }

    public async Task DisposeAsync()
    {
        _client.Dispose();
        await _app.DisposeAsync();
        if (Directory.Exists(_toolFolder)) Directory.Delete(_toolFolder, recursive: true);
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

    // ------------------------------------------------------------------ the sample

    private const int SamplePort = 62000;

    private static ModelMetadata SampleModel(bool withAutoDateTable = false) => new(
        "db",
        [
            new TableInfo("Product", false, null), new TableInfo("Customer", false, null), new TableInfo("Plant", false, null),
            new TableInfo("Date", false, null), new TableInfo("Sales", false, null),
            .. withAutoDateTable ? new[] { new TableInfo("LocalDateTable_1", true, null) } : [],
        ],
        [], [], []);

    private async Task<(HttpStatusCode Status, string? State)> Post(string path)
    {
        var response = await _client.SendAsync(Request(HttpMethod.Post, path));
        var body = await Json(response);
        return (response.StatusCode, body.TryGetProperty("state", out var s) ? s.GetString() : null);
    }

    [Fact]
    public async Task Opening_the_sample_starts_Desktop_once_while_it_loads()
    {
        Assert.Equal((HttpStatusCode.OK, "starting"), await Post("/api/sample/open"));
        Assert.Equal((HttpStatusCode.OK, "starting"), await Post("/api/sample/open")); // pressed again
        Assert.Equal(1, _launcher.Opened);

        _clock.Now += SampleLaunches.StartupAllowance; // Desktop never showed up: allow another try
        await Post("/api/sample/open");
        Assert.Equal(2, _launcher.Opened);
    }

    [Fact]
    public async Task Opening_the_sample_does_nothing_when_it_is_already_open()
    {
        _instances.Instances.Add(new(SamplePort, "C:\\ws2", 4343, "Initech"));
        Assert.Equal((HttpStatusCode.OK, "open"), await Post("/api/sample/open"));
        Assert.Equal(0, _launcher.Opened);
    }

    [Fact]
    public async Task Opening_the_sample_reports_when_it_is_missing_or_Desktop_cannot_start()
    {
        _launcher.Fail = true;
        var failed = await _client.SendAsync(Request(HttpMethod.Post, "/api/sample/open"));
        Assert.Equal(HttpStatusCode.BadGateway, failed.StatusCode);
        Assert.Contains("Power BI Desktop is installed", await failed.Content.ReadAsStringAsync());

        _launcher.Fail = false; // a failed start doesn't block the next try
        Assert.Equal((HttpStatusCode.OK, "starting"), await Post("/api/sample/open"));

        _launcher.IsAvailable = false;
        Assert.Equal(HttpStatusCode.NotFound, (await _client.SendAsync(Request(HttpMethod.Post, "/api/sample/open"))).StatusCode);
    }

    [Fact]
    public async Task Connecting_to_the_sample_waits_until_Desktop_has_loaded_it()
    {
        Assert.Equal((HttpStatusCode.OK, "waiting"), await Post("/api/sample/connect")); // not open yet
        Assert.DoesNotContain(61403, _source.PortsRead); // other reports are never read

        _instances.Instances.Add(new(SamplePort, "C:\\ws2", 4343, "Initech"));
        _source.Models[SamplePort] = new ModelMetadata("db", [], [], [], []);
        Assert.Equal((HttpStatusCode.OK, "waiting"), await Post("/api/sample/connect")); // still loading: no tables yet

        _source.Models[SamplePort] = SampleModel(withAutoDateTable: true);
        Assert.Equal((HttpStatusCode.OK, "connected"), await Post("/api/sample/connect"));

        var status = await Json(await _client.SendAsync(Request(HttpMethod.Get, "/api/status")));
        Assert.True(status.GetProperty("connection").GetProperty("isSample").GetBoolean());
        Assert.Equal(SamplePort, status.GetProperty("connection").GetProperty("port").GetInt32());
    }

    [Fact]
    public async Task Never_connects_to_a_different_report_that_happens_to_be_named_Initech()
    {
        _instances.Instances.Add(new(SamplePort, "C:\\ws2", 4343, "Initech")); // the default model: just "Sales"
        var response = await _client.SendAsync(Request(HttpMethod.Post, "/api/sample/connect"));
        Assert.Equal(HttpStatusCode.Conflict, response.StatusCode);
        Assert.Contains("isn't DAX Explorer's sample", await response.Content.ReadAsStringAsync());

        var status = await Json(await _client.SendAsync(Request(HttpMethod.Get, "/api/status")));
        Assert.Equal(JsonValueKind.Null, status.GetProperty("connection").ValueKind);
    }

    [Fact]
    public async Task A_normal_connection_is_not_marked_as_the_sample()
    {
        await _client.SendAsync(Request(HttpMethod.Post, "/api/connect", body: new { port = 61403 }));
        var status = await Json(await _client.SendAsync(Request(HttpMethod.Get, "/api/status")));
        Assert.False(status.GetProperty("connection").GetProperty("isSample").GetBoolean());
    }

    // ------------------------------------------------------------------ timings

    [Fact]
    public async Task Timings_need_a_connection()
    {
        var response = await _client.SendAsync(Request(HttpMethod.Post, "/api/timings", body: new { kind = "scalar", dax = "1" }));
        Assert.Equal(HttpStatusCode.Conflict, response.StatusCode);
        Assert.Empty(_timings.Runs);
    }

    [Fact]
    public async Task Timings_run_the_same_EVALUATE_statement_and_return_what_the_engine_reported()
    {
        await _client.SendAsync(Request(HttpMethod.Post, "/api/connect", body: new { port = 61403 }));
        var response = await _client.SendAsync(Request(HttpMethod.Post, "/api/timings", body: new { kind = "scalar", dax = "[Total Sales]", clearCache = true }));
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        var body = await Json(response);
        Assert.Equal(12, body.GetProperty("totalMs").GetInt64());
        Assert.Equal(2, body.GetProperty("scans").GetArrayLength());
        Assert.True(body.GetProperty("scans")[1].GetProperty("fromCache").GetBoolean());
        Assert.True(body.GetProperty("clearedCache").GetBoolean());
        Assert.Equal((61403, "db", "EVALUATE ROW(\"value\",\n[Total Sales]\n)", true), Assert.Single(_timings.Runs));
    }

    [Fact]
    public async Task Timings_that_cannot_be_collected_say_so()
    {
        await _client.SendAsync(Request(HttpMethod.Post, "/api/connect", body: new { port = 61403 }));
        _timings.Throw = new TimingUnavailableException("Power BI Desktop did not allow a timing trace.");
        var response = await _client.SendAsync(Request(HttpMethod.Post, "/api/timings", body: new { kind = "table", dax = "VALUES(Product[Category])" }));
        Assert.Equal(HttpStatusCode.BadGateway, response.StatusCode);
        Assert.Contains("did not allow a timing trace", await response.Content.ReadAsStringAsync());
        Assert.False(Assert.Single(_timings.Runs).ClearCache);
    }

    // ------------------------------------------------------------------ evaluate

    [Fact]
    public async Task Evaluate_needs_a_connection()
    {
        var response = await _client.SendAsync(Request(HttpMethod.Post, "/api/evaluate", body: new { kind = "scalar", dax = "1" }));
        Assert.Equal(HttpStatusCode.Conflict, response.StatusCode);
        Assert.Empty(_runner.Runs);
    }

    [Fact]
    public async Task Evaluate_writes_the_EVALUATE_statement_itself_on_the_connected_report()
    {
        await _client.SendAsync(Request(HttpMethod.Post, "/api/connect", body: new { port = 61403 }));

        var scalar = await _client.SendAsync(Request(HttpMethod.Post, "/api/evaluate", body: new { kind = "scalar", dax = "[Total Sales] // note" }));
        Assert.Equal(HttpStatusCode.OK, scalar.StatusCode);
        var body = await Json(scalar);
        Assert.Equal(42.5, body.GetProperty("rows")[0][0].GetDouble());
        Assert.False(body.GetProperty("truncated").GetBoolean());

        await _client.SendAsync(Request(HttpMethod.Post, "/api/evaluate", body: new { kind = "table", dax = "VALUES(Product[Category])", maxRows = 5000 }));

        Assert.Collection(
            _runner.Runs,
            run =>
            {
                Assert.Equal((61403, "db"), (run.Port, run.Database));
                // The comment can't hide the closing parenthesis: the expression is on its own line.
                Assert.Equal("EVALUATE ROW(\"value\",\n[Total Sales] // note\n)", run.Query);
                Assert.Equal(1, run.MaxRows);
            },
            run =>
            {
                Assert.StartsWith("EVALUATE\n", run.Query);
                Assert.Equal(QueryBuilder.MaxRows, run.MaxRows); // capped
            });
    }

    [Theory]
    [InlineData("scalar", "")]
    [InlineData("scalar", "   ")]
    [InlineData("command", "1")]
    [InlineData(null, "1")]
    public async Task Evaluate_rejects_requests_it_cannot_turn_into_a_query(string? kind, string dax)
    {
        await _client.SendAsync(Request(HttpMethod.Post, "/api/connect", body: new { port = 61403 }));
        var response = await _client.SendAsync(Request(HttpMethod.Post, "/api/evaluate", body: new { kind, dax }));
        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        Assert.Empty(_runner.Runs);
    }

    [Fact]
    public void Query_values_become_plain_JSON_values_and_dates_are_marked()
    {
        Assert.Null(QueryBuilder.ToJsonValue(DBNull.Value));
        Assert.Null(QueryBuilder.ToJsonValue(double.NaN));
        Assert.Equal(12.5m, QueryBuilder.ToJsonValue(12.5m));
        Assert.Equal("Widgets", QueryBuilder.ToJsonValue("Widgets"));
        var date = Assert.IsType<Dictionary<string, string>>(QueryBuilder.ToJsonValue(new DateTime(2024, 3, 7, 8, 30, 0)));
        Assert.Equal("2024-03-07T08:30:00", date["date"]);
    }

    [Fact]
    public void Every_statement_starts_with_EVALUATE()
    {
        foreach (var kind in new[] { "scalar", "table" })
        {
            var (query, _, _) = QueryBuilder.Build(new EvaluateRequest(kind, "{\"delete\": {}}", null));
            Assert.StartsWith("EVALUATE", query);
        }
    }

    // ------------------------------------------------------------------ capture from Desktop

    private const string VisualQuery = "DEFINE VAR __DS0Core = SUMMARIZECOLUMNS('Plant'[Plant Name], \"S\", [Total Sales]) EVALUATE __DS0Core";

    private async Task<JsonElement> Captured(int after = 0) =>
        await Json(await _client.SendAsync(Request(HttpMethod.Get, $"/api/capture?after={after}")));

    [Fact]
    public async Task Capture_needs_a_connection()
    {
        var response = await _client.SendAsync(Request(HttpMethod.Post, "/api/capture/start"));
        Assert.Equal(HttpStatusCode.Conflict, response.StatusCode);
        Assert.Equal(0, _capture.Started);
    }

    [Fact]
    public async Task Capture_listens_to_the_connected_report_and_keeps_only_visual_queries()
    {
        await _client.SendAsync(Request(HttpMethod.Post, "/api/connect", body: new { port = 61403 }));
        var start = await Json(await _client.SendAsync(Request(HttpMethod.Post, "/api/capture/start")));
        Assert.True(start.GetProperty("listening").GetBoolean());
        Assert.Equal(61403, _capture.Port);

        _capture.Push(VisualQuery);
        _capture.Push("EVALUATE ROW(\"x\", 1)");                                   // not a visual's table of values
        _capture.Push(VisualQuery, subclass: "MDXQuery");                          // not DAX
        _capture.Push(VisualQuery, app: "DAX Explorer");                           // not Power BI Desktop
        _capture.Push(VisualQuery.Replace("Plant Name", "Plant Code"));

        var body = await Captured();
        Assert.True(body.GetProperty("listening").GetBoolean());
        var queries = body.GetProperty("queries").EnumerateArray().ToList();
        Assert.Equal(2, queries.Count);
        Assert.Equal(VisualQuery, queries[0].GetProperty("text").GetString());

        // Only the new ones after a given id.
        var lastId = queries[1].GetProperty("id").GetInt32();
        _capture.Push(VisualQuery);
        Assert.Single((await Captured(lastId)).GetProperty("queries").EnumerateArray());
    }

    [Fact]
    public async Task Capture_keeps_only_the_latest_queries()
    {
        await _client.SendAsync(Request(HttpMethod.Post, "/api/connect", body: new { port = 61403 }));
        await _client.SendAsync(Request(HttpMethod.Post, "/api/capture/start"));
        for (var i = 0; i < CaptureState.MaxQueries + 5; i++) _capture.Push(VisualQuery);
        var queries = (await Captured()).GetProperty("queries").EnumerateArray().ToList();
        Assert.Equal(CaptureState.MaxQueries, queries.Count);
        Assert.Equal(6, queries[0].GetProperty("id").GetInt32()); // the oldest 5 were dropped
    }

    [Fact]
    public async Task Capture_stops_by_itself_after_five_minutes_and_on_stop_disconnect_or_a_new_connection()
    {
        await _client.SendAsync(Request(HttpMethod.Post, "/api/connect", body: new { port = 61403 }));
        await _client.SendAsync(Request(HttpMethod.Post, "/api/capture/start"));
        _clock.Now += CaptureState.Duration;
        Assert.False((await Captured()).GetProperty("listening").GetBoolean());
        Assert.Equal(1, _capture.Stopped);
        _capture.Push(VisualQuery); // after stopping, nothing more is kept
        Assert.Empty((await Captured()).GetProperty("queries").EnumerateArray());

        await _client.SendAsync(Request(HttpMethod.Post, "/api/capture/start"));
        await _client.SendAsync(Request(HttpMethod.Post, "/api/capture/stop"));
        Assert.Equal(2, _capture.Stopped);

        await _client.SendAsync(Request(HttpMethod.Post, "/api/capture/start"));
        await _client.SendAsync(Request(HttpMethod.Post, "/api/disconnect"));
        Assert.Equal(3, _capture.Stopped);

        await _client.SendAsync(Request(HttpMethod.Post, "/api/connect", body: new { port = 61403 }));
        await _client.SendAsync(Request(HttpMethod.Post, "/api/capture/start"));
        await _client.SendAsync(Request(HttpMethod.Post, "/api/connect", body: new { port = 61403 }));
        Assert.Equal(4, _capture.Stopped);
    }

    [Fact]
    public async Task Capture_reports_a_friendly_error_when_the_trace_cannot_start()
    {
        await _client.SendAsync(Request(HttpMethod.Post, "/api/connect", body: new { port = 61403 }));
        _capture.Fail = true;
        var response = await _client.SendAsync(Request(HttpMethod.Post, "/api/capture/start"));
        Assert.Equal(HttpStatusCode.BadGateway, response.StatusCode);
        var text = await response.Content.ReadAsStringAsync();
        Assert.Contains("Could not listen to Power BI Desktop", text);
        Assert.DoesNotContain("trace refused", text);
        Assert.False((await Captured()).GetProperty("listening").GetBoolean());
    }

    // ------------------------------------------------------------------ recent visuals and listening while connected

    [Fact]
    public void Recent_visuals_are_Desktops_DAX_visual_queries_newest_first()
    {
        var picked = RecentVisuals.Pick(
        [
            new("Power BI Desktop0da6", new DateTime(2026, 11, 11, 2, 29, 21), VisualQuery),
            new("Power BI Desktop0da6", new DateTime(2026, 11, 11, 2, 31, 48), VisualQuery.Replace("Plant Name", "Plant Code")),
            new("Power BI Desktop0da6", new DateTime(2026, 11, 11, 2, 28, 49), "<Batch><Alter>SUMMARIZECOLUMNS</Alter></Batch>"), // an XMLA command
            new("Power BI Desktop0da6", new DateTime(2026, 11, 11, 2, 30, 0), "SELECT * FROM $SYSTEM.DISCOVER_SESSIONS"),
            new("DAX Studio", new DateTime(2026, 11, 11, 2, 32, 0), VisualQuery),                                            // another tool
            new(null, null, null),
        ]);
        Assert.Equal(2, picked.Count);
        Assert.Contains("Plant Code", picked[0].Text);
        Assert.Equal(new DateTimeOffset(2026, 11, 11, 2, 31, 48, TimeSpan.Zero), picked[0].At);
    }

    [Fact]
    public async Task Recent_visuals_need_a_connection_and_report_problems_plainly()
    {
        Assert.Equal(HttpStatusCode.Conflict, (await _client.SendAsync(Request(HttpMethod.Get, "/api/visuals/recent"))).StatusCode);

        await _client.SendAsync(Request(HttpMethod.Post, "/api/connect", body: new { port = 61403 }));
        _sessions.Commands.Add(new("Power BI Desktop0da6", new DateTime(2026, 11, 11, 2, 31, 48), VisualQuery));
        var body = await Json(await _client.SendAsync(Request(HttpMethod.Get, "/api/visuals/recent")));
        Assert.Equal(VisualQuery, body.GetProperty("queries")[0].GetProperty("text").GetString());

        _sessions.Fail = true;
        var failed = await _client.SendAsync(Request(HttpMethod.Get, "/api/visuals/recent"));
        Assert.Equal(HttpStatusCode.BadGateway, failed.StatusCode);
        Assert.DoesNotContain("engine gone", await failed.Content.ReadAsStringAsync());
    }

    [Fact]
    public async Task Listening_while_connected_does_not_stop_after_five_minutes_but_stops_on_disconnect()
    {
        await _client.SendAsync(Request(HttpMethod.Post, "/api/connect", body: new { port = 61403 }));
        var start = await Json(await _client.SendAsync(Request(HttpMethod.Post, "/api/capture/start?untilDisconnect=true")));
        Assert.Equal(JsonValueKind.Null, start.GetProperty("stopsAt").ValueKind);

        _clock.Now += CaptureState.Duration * 10;
        Assert.True((await Captured()).GetProperty("listening").GetBoolean());

        await _client.SendAsync(Request(HttpMethod.Post, "/api/disconnect"));
        Assert.False((await Captured()).GetProperty("listening").GetBoolean());
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

    // ------------------------------------------------------------------ External Tools ribbon

    [Fact]
    public async Task External_tool_can_be_added_and_removed_after_the_Windows_prompt()
    {
        var status = await Json(await _client.SendAsync(Request(HttpMethod.Get, "/api/external-tool")));
        Assert.False(status.GetProperty("installed").GetBoolean());

        var added = await Json(await _client.SendAsync(Request(HttpMethod.Post, "/api/external-tool/install")));
        Assert.Equal("ok", added.GetProperty("result").GetString());
        Assert.True(added.GetProperty("installed").GetBoolean());
        Assert.True(added.GetProperty("startsThisProgram").GetBoolean());
        Assert.Equal([ExternalTool.InstallArgument], _elevation.Calls);

        var removed = await Json(await _client.SendAsync(Request(HttpMethod.Post, "/api/external-tool/remove")));
        Assert.False(removed.GetProperty("installed").GetBoolean());
    }

    [Fact]
    public async Task External_tool_says_so_when_the_Windows_prompt_is_declined()
    {
        _elevation.Answer = "cancelled";
        var result = await Json(await _client.SendAsync(Request(HttpMethod.Post, "/api/external-tool/install")));
        Assert.Equal("cancelled", result.GetProperty("result").GetString());
        Assert.False(result.GetProperty("installed").GetBoolean());
    }

    [Fact]
    public async Task External_tool_endpoints_need_the_token()
    {
        var response = await _client.SendAsync(Request(HttpMethod.Post, "/api/external-tool/install", token: null));
        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
        Assert.Empty(_elevation.Calls);
    }
}
