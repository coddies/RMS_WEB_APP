using System;
using System.Diagnostics;
using System.IO;
using System.Net;
using System.Reflection;
using System.Threading;
using System.Windows;
using System.Management.Automation;
using System.Management.Automation.Runspaces;

internal static class RMSCounterHost
{
    [STAThread]
    private static int Main()
    {
        try
        {
            string appDirectory = Path.GetDirectoryName(Assembly.GetExecutingAssembly().Location);
            string installRoot = FindInstallRoot(appDirectory);
            if (String.IsNullOrEmpty(installRoot))
                throw new InvalidOperationException("RMS Local Bridge installation was not found. Keep RMSCounter.exe beside the installed bridge or install the bridge first.");

            Environment.SetEnvironmentVariable("RMS_COUNTER_INSTALL_ROOT", installRoot, EnvironmentVariableTarget.Process);
            // Reuse the bridge token already provisioned for this installation.
            // Passing it in-process avoids a second prompt and keeps the token out
            // of command-line arguments and logs.
            string bridgeToken = ReadEnvironmentValue(Path.Combine(installRoot, ".env"), "BRIDGE_TOKEN");
            if (!String.IsNullOrEmpty(bridgeToken))
                Environment.SetEnvironmentVariable("RMS_LOCAL_BRIDGE_TOKEN", bridgeToken, EnvironmentVariableTarget.Process);
            string iconPath = Path.Combine(appDirectory, "RMSCounter.ico");
            if (File.Exists(iconPath)) Environment.SetEnvironmentVariable("RMS_COUNTER_ICON", iconPath, EnvironmentVariableTarget.Process);
            string webAppUrl = ReadEnvironmentValue(Path.Combine(installRoot, ".env"), "RMS_WEB_APP_URL");
            if (String.IsNullOrEmpty(webAppUrl))
                webAppUrl = ReadJsonValue(Path.Combine(installRoot, "counter-config.json"), "web_app_url");
            DirectoryInfo projectRoot = Directory.GetParent(installRoot);
            if (String.IsNullOrEmpty(webAppUrl) && projectRoot != null)
                webAppUrl = ReadEnvironmentValue(Path.Combine(projectRoot.FullName, ".env.local"), "RMS_WEB_APP_URL");
            if (String.IsNullOrEmpty(webAppUrl) && projectRoot != null)
                webAppUrl = ReadEnvironmentValue(Path.Combine(projectRoot.FullName, ".env.local"), "NEXT_PUBLIC_BASE_URL");
            if (!String.IsNullOrEmpty(webAppUrl)) Environment.SetEnvironmentVariable("RMS_WEB_APP_URL", webAppUrl, EnvironmentVariableTarget.Process);
            EnsureBridge(installRoot);

            string script = Path.Combine(installRoot, "counter-app.ps1");
            if (!File.Exists(script))
                script = Path.Combine(appDirectory, "counter-app.ps1");
            if (!File.Exists(script))
                throw new FileNotFoundException("The existing Counter UI script was not found.", script);

            RunCounterUi(script);
            return 0;
        }
        catch (Exception ex)
        {
            MessageBox.Show(ex.Message, "RMS Counter", MessageBoxButton.OK, MessageBoxImage.Error);
            return 1;
        }
    }

    private static string FindInstallRoot(string appDirectory)
    {
        string configured = Environment.GetEnvironmentVariable("RMS_COUNTER_INSTALL_ROOT");
        if (LooksLikeInstall(configured)) return configured;
        if (LooksLikeInstall(appDirectory)) return appDirectory;

        DirectoryInfo current = new DirectoryInfo(appDirectory);
        while (current != null)
        {
            if (LooksLikeInstall(current.FullName)) return current.FullName;
            current = current.Parent;
        }

        string programFiles = Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles);
        string standard = Path.Combine(programFiles, "RMS Local Bridge");
        if (LooksLikeInstall(standard)) return standard;

        return null;
    }

    private static bool LooksLikeInstall(string path)
    {
        return !String.IsNullOrEmpty(path) && File.Exists(Path.Combine(path, "server.mjs"));
    }

    private static void EnsureBridge(string root)
    {
        if (BridgeHealthy()) return;
        string wrapper = Path.Combine(root, "RMSLocalBridge.exe");
        if (!File.Exists(wrapper))
        {
            string node = FindNode(root);
            if (String.IsNullOrEmpty(node))
                throw new FileNotFoundException("The bundled Node runtime was not found, so the hidden bridge cannot start.");
            ProcessStartInfo nodeStart = new ProcessStartInfo();
            nodeStart.FileName = node;
            nodeStart.Arguments = "\"" + Path.Combine(root, "server.mjs") + "\"";
            nodeStart.WorkingDirectory = root;
            nodeStart.UseShellExecute = false;
            nodeStart.CreateNoWindow = true;
            nodeStart.WindowStyle = ProcessWindowStyle.Hidden;
            Process.Start(nodeStart);
            for (int i = 0; i < 20; i++)
            {
                if (BridgeHealthy()) return;
                Thread.Sleep(500);
            }
            throw new InvalidOperationException("The hidden local bridge did not become ready. Check the existing bridge .env configuration and port 8765.");
        }

        ProcessStartInfo start = new ProcessStartInfo();
        start.FileName = wrapper;
        start.Arguments = "start";
        start.WorkingDirectory = root;
        start.UseShellExecute = false;
        start.CreateNoWindow = true;
        start.WindowStyle = ProcessWindowStyle.Hidden;
        bool started = false;
        try
        {
            using (Process process = Process.Start(start))
            {
                if (process != null)
                {
                    process.WaitForExit(5000);
                    started = process.ExitCode == 0;
                }
            }
        }
        catch { }

        if (!started && !BridgeHealthy())
        {
            start.UseShellExecute = true;
            start.Verb = "runas";
            try
            {
                using (Process process = Process.Start(start))
                    if (process != null) process.WaitForExit(10000);
            }
            catch (System.ComponentModel.Win32Exception ex)
            {
                if (ex.NativeErrorCode == 1223) throw new InvalidOperationException("Windows administrator approval was cancelled. The background bridge must be started before RMS Counter can open.");
            }
        }

        for (int i = 0; i < 20; i++)
        {
            if (BridgeHealthy()) return;
            Thread.Sleep(500);
        }
        throw new InvalidOperationException("The local bridge service did not become ready. Try repairing RMS Local Bridge from its installer, then reopen RMS Counter.");
    }

    private static bool BridgeHealthy()
    {
        try
        {
            HttpWebRequest request = (HttpWebRequest)WebRequest.Create("http://127.0.0.1:8765/health");
            request.Method = "GET";
            request.Timeout = 500;
            request.ReadWriteTimeout = 500;
            using (HttpWebResponse response = (HttpWebResponse)request.GetResponse())
            using (StreamReader reader = new StreamReader(response.GetResponseStream()))
                return response.StatusCode == HttpStatusCode.OK && reader.ReadToEnd().Contains("\"ok\":true");
        }
        catch { return false; }
    }

    private static string FindNode(string root)
    {
        string[] candidates = {
            Path.Combine(root, "runtime", "node.exe"),
            Path.Combine(root, "installer", "payload", "runtime", "node.exe")
        };
        foreach (string candidate in candidates) if (File.Exists(candidate)) return candidate;
        return null;
    }

    private static string ReadEnvironmentValue(string path, string name)
    {
        try
        {
            if (!File.Exists(path)) return null;
            string prefix = name + "=";
            foreach (string line in File.ReadAllLines(path))
                if (line.StartsWith(prefix, StringComparison.Ordinal)) return line.Substring(prefix.Length).Trim().Trim('"', '\'');
        }
        catch { }
        return null;
    }

    private static string ReadJsonValue(string path, string key)
    {
        try
        {
            if (!File.Exists(path)) return null;
            string text = File.ReadAllText(path);
            var match = System.Text.RegularExpressions.Regex.Match(text, "\"" + System.Text.RegularExpressions.Regex.Escape(key) + "\"\\s*:\\s*\"([^\"]+)\"");
            if (match.Success) return match.Groups[1].Value.Trim();
        }
        catch { }
        return null;
    }

    private static void RunCounterUi(string scriptPath)
    {
        string script = File.ReadAllText(scriptPath);
        Runspace runspace = RunspaceFactory.CreateRunspace();
        runspace.ApartmentState = ApartmentState.STA;
        runspace.ThreadOptions = PSThreadOptions.UseCurrentThread;
        runspace.Open();
        try
        {
            using (PowerShell shell = PowerShell.Create())
            {
                shell.Runspace = runspace;
                shell.AddScript(script, false);
                shell.Invoke();
                if (shell.HadErrors && shell.Streams.Error.Count > 0)
                    throw new InvalidOperationException(shell.Streams.Error[0].ToString());
            }
        }
        finally { runspace.Dispose(); }
    }
}
