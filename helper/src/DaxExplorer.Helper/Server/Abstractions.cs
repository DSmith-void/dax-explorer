using DaxExplorer.Helper.Discovery;
using DaxExplorer.Helper.Model;
using Microsoft.AnalysisServices.AdomdClient;

namespace DaxExplorer.Helper.Server;

/// <summary>Finds running Power BI Desktop instances. Abstracted so endpoints can be tested without Power BI.</summary>
public interface IDesktopInstances
{
    IReadOnlyList<DesktopInstance> Find();
}

/// <summary>Reads a model's metadata from a Power BI Desktop engine.</summary>
public interface IModelSource
{
    ModelMetadata ReadDesktopModel(int port);
}

internal sealed class DesktopInstances : IDesktopInstances
{
    private readonly DesktopDiscovery _discovery = DesktopDiscovery.CreateDefault();

    public IReadOnlyList<DesktopInstance> Find() => _discovery.Find();
}

internal sealed class AdomdModelSource : IModelSource
{
    public ModelMetadata ReadDesktopModel(int port)
    {
        using var connection = new AdomdConnection(ModelReader.DesktopConnectionString(port));
        connection.Open();
        return ModelReader.Read(connection);
    }
}
