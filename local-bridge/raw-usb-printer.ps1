$ErrorActionPreference = "Stop"

Add-Type -TypeDefinition @"
using System;
using System.ComponentModel;
using System.Runtime.InteropServices;

public static class RmsRawPrinter {
    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    public class DOC_INFO_1 {
        [MarshalAs(UnmanagedType.LPWStr)] public string pDocName;
        [MarshalAs(UnmanagedType.LPWStr)] public string pOutputFile;
        [MarshalAs(UnmanagedType.LPWStr)] public string pDatatype;
    }

    [DllImport("winspool.drv", EntryPoint = "OpenPrinterW", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern bool OpenPrinter(string name, out IntPtr handle, IntPtr defaults);
    [DllImport("winspool.drv", EntryPoint = "ClosePrinter", SetLastError = true)]
    private static extern bool ClosePrinter(IntPtr handle);
    [DllImport("winspool.drv", EntryPoint = "StartDocPrinterW", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern int StartDocPrinter(IntPtr handle, int level, [In] DOC_INFO_1 info);
    [DllImport("winspool.drv", EntryPoint = "EndDocPrinter", SetLastError = true)]
    private static extern bool EndDocPrinter(IntPtr handle);
    [DllImport("winspool.drv", EntryPoint = "StartPagePrinter", SetLastError = true)]
    private static extern bool StartPagePrinter(IntPtr handle);
    [DllImport("winspool.drv", EntryPoint = "EndPagePrinter", SetLastError = true)]
    private static extern bool EndPagePrinter(IntPtr handle);
    [DllImport("winspool.drv", EntryPoint = "WritePrinter", SetLastError = true)]
    private static extern bool WritePrinter(IntPtr handle, byte[] bytes, int count, out int written);

    public static void Send(string printerName, byte[] bytes) {
        IntPtr handle;
        if (!OpenPrinter(printerName, out handle, IntPtr.Zero)) throw new Win32Exception(Marshal.GetLastWin32Error());
        bool documentStarted = false;
        bool pageStarted = false;
        try {
            DOC_INFO_1 info = new DOC_INFO_1();
            info.pDocName = "RMS Receipt";
            info.pOutputFile = null;
            info.pDatatype = "RAW";
            if (StartDocPrinter(handle, 1, info) == 0) throw new Win32Exception(Marshal.GetLastWin32Error());
            documentStarted = true;
            if (!StartPagePrinter(handle)) throw new Win32Exception(Marshal.GetLastWin32Error());
            pageStarted = true;
            int written;
            if (!WritePrinter(handle, bytes, bytes.Length, out written) || written != bytes.Length) throw new Win32Exception(Marshal.GetLastWin32Error());
            if (!EndPagePrinter(handle)) throw new Win32Exception(Marshal.GetLastWin32Error());
            pageStarted = false;
            if (!EndDocPrinter(handle)) throw new Win32Exception(Marshal.GetLastWin32Error());
            documentStarted = false;
        } finally {
            if (pageStarted) EndPagePrinter(handle);
            if (documentStarted) EndDocPrinter(handle);
            ClosePrinter(handle);
        }
    }
}
"@

[Console]::Out.WriteLine("READY")
[Console]::Out.Flush()

while ($line = [Console]::In.ReadLine()) {
  try {
    $job = $line | ConvertFrom-Json
    $payload = [Convert]::FromBase64String($job.payload)
    [RmsRawPrinter]::Send($job.printer_name, $payload)
    [Console]::Out.WriteLine("OK")
    [Console]::Out.Flush()
  } catch {
    [Console]::Out.WriteLine("ERR:" + $_.Exception.Message)
    [Console]::Out.Flush()
  }
}
