namespace UltraHeadcountManager.Desktop;

public sealed class BridgeException : Exception
{
    public string Code { get; }
    public int? Status { get; }

    public BridgeException(string code, string message, int? status = null, Exception? inner = null)
        : base(message, inner)
    {
        Code = code;
        Status = status;
    }
}
