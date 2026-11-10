using System.Security.Cryptography;
using System.Text;

namespace DaxExplorer.Helper.Server;

/// <summary>
/// Protects the data endpoints (/api/...) with a random token created at startup.
///
/// Why: the helper listens on 127.0.0.1, which any website open in your browser could try to
/// reach. Only the page the helper itself opened knows the token (it is passed in the URL
/// fragment, which browsers never send over the network), so other sites cannot read your model.
/// </summary>
public sealed class TokenGuard(string token)
{
    public const string HeaderName = "X-DaxExplorer-Token";

    private readonly byte[] _expected = Encoding.UTF8.GetBytes(token);

    /// <summary>A new unguessable token: 32 random bytes, URL-safe base64.</summary>
    public static string NewToken() =>
        Convert.ToBase64String(RandomNumberGenerator.GetBytes(32)).TrimEnd('=').Replace('+', '-').Replace('/', '_');

    public bool IsValid(string? presented)
    {
        if (string.IsNullOrEmpty(presented)) return false;
        // Constant-time comparison, so timing reveals nothing about the token.
        return CryptographicOperations.FixedTimeEquals(Encoding.UTF8.GetBytes(presented), _expected);
    }

    public async Task InvokeAsync(HttpContext context, RequestDelegate next)
    {
        if (context.Request.Path.StartsWithSegments("/api") && !IsValid(context.Request.Headers[HeaderName]))
        {
            context.Response.StatusCode = StatusCodes.Status401Unauthorized;
            await context.Response.WriteAsJsonAsync(new { error = "Missing or invalid helper token. Open the app using the link the helper printed." });
            return;
        }
        await next(context);
    }
}
