using System.Text;
using DaxExplorer.Helper.Discovery;

namespace DaxExplorer.Helper.Tests;

public class PortFileTests
{
    [Fact]
    public void Reads_utf16_without_byte_order_mark_as_written_by_desktop() =>
        Assert.Equal(61403, PortFile.Parse(Encoding.Unicode.GetBytes("61403")));

    [Fact]
    public void Reads_utf16_with_byte_order_mark() =>
        Assert.Equal(61403, PortFile.Parse([0xFF, 0xFE, .. Encoding.Unicode.GetBytes("61403")]));

    [Fact]
    public void Reads_utf8_with_byte_order_mark() =>
        Assert.Equal(5000, PortFile.Parse([0xEF, 0xBB, 0xBF, .. Encoding.UTF8.GetBytes("5000")]));

    [Fact]
    public void Reads_plain_ascii() => Assert.Equal(5000, PortFile.Parse(Encoding.ASCII.GetBytes("5000")));

    [Fact]
    public void Ignores_surrounding_whitespace_and_nulls() =>
        Assert.Equal(1234, PortFile.Parse(Encoding.Unicode.GetBytes(" 1234\r\n\0")));

    [Theory]
    [InlineData("")]
    [InlineData("abc")]
    [InlineData("0")]
    [InlineData("70000")]
    [InlineData("-5")]
    [InlineData("12 34")]
    public void Rejects_content_that_is_not_a_valid_port(string content) =>
        Assert.Null(PortFile.Parse(Encoding.Unicode.GetBytes(content)));
}
