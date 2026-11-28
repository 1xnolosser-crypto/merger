# Sends a report only to a positively identified ChatGPT tab in Microsoft Edge.
[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [ValidateNotNullOrEmpty()]
    [string]$Report,
    [int]$WaitSeconds = 25,
    [int]$MaxTabsPerWindow = 30
)

$ErrorActionPreference = "Stop"
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes

if (-not ("BridgeNative.WindowApi" -as [type])) {
    Add-Type -TypeDefinition @"
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Text;

namespace BridgeNative {
    public sealed class EdgeWindow {
        public IntPtr Handle { get; set; }
        public int ProcessId { get; set; }
        public string Title { get; set; }
    }

    public static class WindowApi {
        private delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);
        [DllImport("user32.dll")] private static extern bool EnumWindows(EnumWindowsProc callback, IntPtr extraData);
        [DllImport("user32.dll")] private static extern bool IsWindowVisible(IntPtr hWnd);
        [DllImport("user32.dll", CharSet = CharSet.Unicode)] private static extern int GetWindowText(IntPtr hWnd, StringBuilder text, int maxCount);
        [DllImport("user32.dll", CharSet = CharSet.Unicode)] private static extern int GetClassName(IntPtr hWnd, StringBuilder text, int maxCount);
        [DllImport("user32.dll")] private static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint processId);
        [DllImport("user32.dll")] private static extern bool SetForegroundWindow(IntPtr hWnd);
        [DllImport("user32.dll")] private static extern IntPtr GetForegroundWindow();
        [DllImport("user32.dll")] private static extern bool ShowWindowAsync(IntPtr hWnd, int command);

        public static string GetTitle(IntPtr hWnd) {
            StringBuilder value = new StringBuilder(1024);
            GetWindowText(hWnd, value, value.Capacity);
            return value.ToString();
        }
        public static bool Activate(IntPtr hWnd) {
            ShowWindowAsync(hWnd, 9);
            return SetForegroundWindow(hWnd);
        }
        public static IntPtr GetForegroundWindowHandle() { return GetForegroundWindow(); }
        public static EdgeWindow[] GetEdgeWindows() {
            List<EdgeWindow> found = new List<EdgeWindow>();
            EnumWindowsProc callback = delegate(IntPtr hWnd, IntPtr extra) {
                if (!IsWindowVisible(hWnd)) return true;
                StringBuilder className = new StringBuilder(256);
                GetClassName(hWnd, className, className.Capacity);
                if (className.ToString() != "Chrome_WidgetWin_1") return true;
                uint processId;
                GetWindowThreadProcessId(hWnd, out processId);
                try {
                    using (Process process = Process.GetProcessById((int)processId)) {
                        if (process.ProcessName.Equals("msedge", StringComparison.OrdinalIgnoreCase)) {
                            found.Add(new EdgeWindow { Handle = hWnd, ProcessId = (int)processId, Title = GetTitle(hWnd) });
                        }
                    }
                } catch {}
                return true;
            };
            EnumWindows(callback, IntPtr.Zero);
            return found.ToArray();
        }
    }
}
"@
}

function Get-ChatGPTComposer {
    param([System.Windows.Automation.AutomationElement]$Root)
    if (-not $Root) { return $null }

    # Preferred: the known ChatGPT composer AutomationId.
    try {
        $idCondition = New-Object System.Windows.Automation.PropertyCondition(
            [System.Windows.Automation.AutomationElement]::AutomationIdProperty, "prompt-textarea"
        )
        $found = $Root.FindFirst([System.Windows.Automation.TreeScope]::Descendants, $idCondition)
        if ($found -and -not $found.Current.IsOffscreen) { return $found }
    } catch {}

    # Fallback: accessible editable controls exposed by Chromium/UI Automation.
    # Prefer a control whose accessible name identifies ChatGPT's message field.
    try {
        $editCondition = New-Object System.Windows.Automation.PropertyCondition(
            [System.Windows.Automation.AutomationElement]::ControlTypeProperty,
            [System.Windows.Automation.ControlType]::Edit
        )
        $edits = @($Root.FindAll([System.Windows.Automation.TreeScope]::Descendants, $editCondition))
        $visible = @($edits | Where-Object {
            try { -not $_.Current.IsOffscreen -and $_.Current.IsKeyboardFocusable } catch { $false }
        })
        if ($visible.Count -eq 0) { return $null }

        $named = @($visible | Where-Object {
            $n = ""
            try { $n = [string]$_.Current.Name } catch {}
            $n -match "(?i)message\s*chatgpt|send\s*a\s*message|chatgpt"
        })
        if ($named.Count -gt 0) { return $named[$named.Count - 1] }

        # ChatGPT's composer is commonly the last visible editable control on the page.
        return $visible[$visible.Count - 1]
    } catch {
        return $null
    }
}

$windows = @([BridgeNative.WindowApi]::GetEdgeWindows())
if ($windows.Count -eq 0) {
    throw "CHATGPT_SEND_ABORTED: No visible Microsoft Edge browser window was found."
}

$ws = New-Object -ComObject WScript.Shell
$target = $null
$targetWindow = $null
$targetComposer = $null
$targetTitle = $null

foreach ($window in $windows) {
    [void][BridgeNative.WindowApi]::Activate($window.Handle)
    Start-Sleep -Milliseconds 450
    if ([BridgeNative.WindowApi]::GetForegroundWindowHandle() -ne $window.Handle) { continue }

    $root = [System.Windows.Automation.AutomationElement]::FromHandle($window.Handle)
    if (-not $root) { continue }

    for ($tab = 0; $tab -lt $MaxTabsPerWindow; $tab++) {
        Start-Sleep -Milliseconds 180
        $activeTitle = [BridgeNative.WindowApi]::GetTitle($window.Handle)

        # Never inspect/send into a tab unless its own active-tab title identifies ChatGPT.
        if ($activeTitle -match "(?i)chatgpt") {
            $composer = Get-ChatGPTComposer -Root $root
            if ($composer) {
                $target = $root
                $targetWindow = $window
                $targetComposer = $composer
                $targetTitle = $activeTitle
                break
            }
        }

        $ws.SendKeys("^{TAB}")
        Start-Sleep -Milliseconds 350
    }

    if ($target) { break }
    # Return to the original tab before moving to another Edge window.
    for ($restore = 0; $restore -lt $MaxTabsPerWindow; $restore++) {
        $ws.SendKeys("^+{TAB}")
        Start-Sleep -Milliseconds 25
    }
}

if (-not $target) {
    throw "CHATGPT_SEND_ABORTED: No active Edge tab with a ChatGPT title and accessible message composer was found. No text was sent."
}

[void][BridgeNative.WindowApi]::Activate($targetWindow.Handle)
Start-Sleep -Milliseconds 500
if ([BridgeNative.WindowApi]::GetForegroundWindowHandle() -ne $targetWindow.Handle) {
    throw "CHATGPT_SEND_ABORTED: Could not safely activate the selected ChatGPT window. No text was sent."
}
$currentTitle = [BridgeNative.WindowApi]::GetTitle($targetWindow.Handle)
if ($currentTitle -notmatch "(?i)chatgpt") {
    throw "CHATGPT_SEND_ABORTED: Active tab title changed and no longer identifies ChatGPT. No text was sent."
}
$targetComposer = Get-ChatGPTComposer -Root $target
if (-not $targetComposer) {
    throw "CHATGPT_SEND_ABORTED: ChatGPT tab was selected, but its composer is no longer accessible. No text was sent."
}

$oldClipboard = $null
$clipboardCaptured = $false
try {
    $oldClipboard = Get-Clipboard -Raw -ErrorAction Stop
    $clipboardCaptured = $true
} catch {}

try {
    Set-Clipboard -Value $Report
    $targetComposer.SetFocus()
    Start-Sleep -Milliseconds 350
    $ws.SendKeys("^v")
    Start-Sleep -Milliseconds 900

    $pastedValue = $null
    try {
        $valuePattern = $targetComposer.GetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern)
        $pastedValue = [string]$valuePattern.Current.Value
    } catch {}

    if ($null -ne $pastedValue -and
        -not $pastedValue.Contains($Report.Substring(0, [Math]::Min(40, $Report.Length)))) {
        throw "CHATGPT_SEND_ABORTED: Composer verification failed. Enter was not pressed."
    }

    $ws.SendKeys("{ENTER}")
    Start-Sleep -Seconds 3

    $remainingValue = $null
    try {
        $valuePattern = $targetComposer.GetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern)
        $remainingValue = [string]$valuePattern.Current.Value
    } catch {}

    if ($null -ne $remainingValue -and $remainingValue.Contains($Report.Substring(0, [Math]::Min(40, $Report.Length)))) {
        throw "CHATGPT_SEND_ABORTED: The report remains in the composer; submission was not confirmed."
    }

    "CHATGPT_MESSAGE_SUBMITTED"
    "Destination: verified ChatGPT tab in Microsoft Edge"
    "Window: $currentTitle"
    "Characters: $($Report.Length)"
} finally {
    if ($clipboardCaptured) { Set-Clipboard -Value $oldClipboard }
}
