using System.IO.Pipes;
using DaxExplorer.Helper.Server;
using Xunit;

namespace DaxExplorer.Helper.Tests;

public sealed class SingleInstanceTests
{
    private static string UniqueName() => $"DaxExplorerTest-{Guid.NewGuid():N}";

    [Fact]
    public async Task Only_the_first_start_claims_the_running_DAX_Explorer()
    {
        var name = UniqueName();
        using var first = SingleInstance.TryClaim(name);
        Assert.NotNull(first);
        // Mutexes are owned per thread; a later start runs on another thread (in fact another process).
        var second = await Task.Run(() => SingleInstance.TryClaim(name));
        Assert.Null(second);
    }

    [Fact]
    public async Task A_later_start_hands_its_request_to_the_running_one()
    {
        var name = UniqueName();
        using var stop = new CancellationTokenSource();
        var received = new List<InstanceRequest>();
        var listening = SingleInstance.ListenAsync(name, request =>
        {
            received.Add(request);
            return new InstanceReply(true, request.ConnectPort is null ? null : "connected");
        }, stop.Token);

        var fromRibbon = await SingleInstance.SendAsync(name, new InstanceRequest(51234, "db"), TimeSpan.FromSeconds(10));
        var doubleClick = await SingleInstance.SendAsync(name, new InstanceRequest(), TimeSpan.FromSeconds(10));

        Assert.Equal(new InstanceReply(true, "connected"), fromRibbon);
        Assert.Equal(new InstanceReply(true), doubleClick);
        Assert.Equal([new InstanceRequest(51234, "db"), new InstanceRequest()], received);

        stop.Cancel();
        await listening;
    }

    [Fact]
    public async Task Nobody_listening_means_no_answer()
    {
        Assert.Null(await SingleInstance.SendAsync(UniqueName(), new InstanceRequest(), TimeSpan.FromMilliseconds(300)));
    }

    [Fact]
    public async Task A_message_that_is_not_a_request_is_refused_and_the_listener_keeps_going()
    {
        var name = UniqueName();
        using var stop = new CancellationTokenSource();
        var listening = SingleInstance.ListenAsync(name, _ => new InstanceReply(true), stop.Token);

        await using (var pipe = new NamedPipeClientStream(".", name, PipeDirection.InOut, PipeOptions.CurrentUserOnly))
        {
            await pipe.ConnectAsync(5000);
            pipe.ReadMode = PipeTransmissionMode.Message;
            await pipe.WriteAsync("not json"u8.ToArray());
            var buffer = new byte[1024];
            var read = await pipe.ReadAsync(buffer);
            Assert.Equal(new InstanceReply(false, "Request not understood."), SingleInstance.Decode<InstanceReply>(buffer.AsSpan(0, read)));
        }

        Assert.Equal(new InstanceReply(true), await SingleInstance.SendAsync(name, new InstanceRequest(), TimeSpan.FromSeconds(10)));
        stop.Cancel();
        await listening;
    }
}

public sealed class AutoQuitTests
{
    private sealed class FakeClock : TimeProvider
    {
        public DateTimeOffset Now { get; set; } = new(2026, 11, 11, 9, 0, 0, TimeSpan.Zero);
        public override DateTimeOffset GetUtcNow() => Now;
    }

    private readonly FakeClock _clock = new();

    [Fact]
    public void Started_on_its_own_it_never_quits_by_itself()
    {
        var quit = new AutoQuit(_clock, TimeSpan.FromMinutes(1));
        Assert.Equal(AutoQuit.Step.Nothing, quit.Check(0));
        _clock.Now += TimeSpan.FromHours(1);
        Assert.Equal(AutoQuit.Step.Nothing, quit.Check(0));
    }

    [Fact]
    public void From_the_ribbon_it_warns_when_Power_BI_closes_and_quits_a_minute_later()
    {
        var quit = new AutoQuit(_clock, TimeSpan.FromMinutes(1));
        quit.Arm();
        Assert.Equal(AutoQuit.Step.Nothing, quit.Check(1));
        Assert.Equal(AutoQuit.Step.Warn, quit.Check(0));
        _clock.Now += TimeSpan.FromSeconds(30);
        Assert.Equal(AutoQuit.Step.Nothing, quit.Check(0));
        _clock.Now += TimeSpan.FromSeconds(30);
        Assert.Equal(AutoQuit.Step.Quit, quit.Check(0));
    }

    [Fact]
    public void A_report_opened_again_in_time_cancels_the_quit()
    {
        var quit = new AutoQuit(_clock, TimeSpan.FromMinutes(1));
        quit.Arm();
        Assert.Equal(AutoQuit.Step.Warn, quit.Check(0));
        _clock.Now += TimeSpan.FromSeconds(40);
        Assert.Equal(AutoQuit.Step.Nothing, quit.Check(1));
        _clock.Now += TimeSpan.FromSeconds(40);
        Assert.Equal(AutoQuit.Step.Warn, quit.Check(0)); // a fresh minute, with a fresh notice
    }

    [Fact]
    public void A_later_double_click_keeps_it_running()
    {
        var quit = new AutoQuit(_clock, TimeSpan.FromMinutes(1));
        quit.Arm();
        Assert.Equal(AutoQuit.Step.Warn, quit.Check(0));
        quit.Disarm();
        _clock.Now += TimeSpan.FromMinutes(5);
        Assert.Equal(AutoQuit.Step.Nothing, quit.Check(0));
    }
}
