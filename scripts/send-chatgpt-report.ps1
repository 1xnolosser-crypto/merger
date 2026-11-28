# Sends a report only to an existing ChatGPT tab in Microsoft Edge.
# It cycles active tabs and identifies ChatGPT by its unique composer AutomationId.
[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [ValidateNotNullOrEmpty()]
    [string]$Report,
    [int]$WaitSeconds = 25,
    [int]$MaxTabsPerWindow = 20
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

        [DllImport("user32.dll")]
        private static extern bool EnumWindows(EnumWindowsProc callback, IntPtr extraData);

        [DllImport("user32.dll")]
        private static extern bool IsWindowVisible(IntPtr hWnd);

        [DllImport("user32.dll", CharSet = CharSet.Unicode)]
        private static extern int GetWindowText(IntPtr hWnd, StringBuilder text, int maxCount);

        [DllImport("user32.dll", CharSet = CharSet.Unicode)]
        private static extern int GetClassName(IntPtr hWnd, StringBuilder text, int maxCount);

        [DllImport("user32.dll")]
        private static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint processId);

        [DllImport("user32.dll")]
        private static extern bool SetForegroundWindow(IntPtr hWnd);

        [DllImport("user32.dll")]
        private static extern bool ShowWindowAsync(IntPtr hWnd, int command);

        public static string GetTitle(IntPtr hWnd) {
            StringBuilder value = new StringBuilder(1024);
            GetWindowText(hWnd, value, value.Capacity);
            return value.ToString();
        }

        public static bool Activate(IntPtr hWnd) {
            ShowWindowAsync(hWnd, 9);
            return SetForegroundWindow(hWnd);
        }

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
                            found.Add(new EdgeWindow {
                                Handle = hWnd,
                                ProcessId = (int)processId,
                                Title = GetTitle(hWnd)
                            });
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
    $condition = New-Object System.Windows.Automation.PropertyCondition(
        [System.Windows.Automation.AutomationElement]::AutomationIdProperty,
        "prompt-textarea"
    )
    return $Root.FindFirst(
        [System.Windows.Automation.TreeScope]::Descendants,
        $condition
    )
}

$windows = @([BridgeNative.WindowApi]::GetEdgeWindows())
if ($windows.Count -eq 0) {
    throw "CHATGPT_SEND_ABORTED: No visible Microsoft Edge browser window was found."
}

$ws = New-Object -ComObject WScript.Shell
$target = $null
$targetWindow = $null
$targetComposer = $null

foreach ($window in $windows) {
    [void][BridgeNative.WindowApi]::Activate($window.Handle)
    Start-Sleep -Milliseconds 350

    $root = [System.Windows.Automation.AutomationElement]::FromHandle($window.Handle)
    if (-not $root) { continue }

    # Inspect the currently active tab, then cycle through tabs using Edge's
    # keyboard navigation. This avoids relying on Chromium's often-hidden
    # UI Automation TabItem tree.
    $composer = Get-ChatGPTComposer -Root $root
    if ($composer) {
        $target = $root
        $targetWindow = $window
        $targetComposer = $composer
        break
    }

    $stepsTaken = 0
    for ($step = 0; $step -lt $MaxTabsPerWindow; $step++) {
        $ws.SendKeys("^{TAB}")
        $stepsTaken++
        Start-Sleep -Milliseconds 250

        $composer = Get-ChatGPTComposer -Root $root
        if ($composer) {
            $target = $root
            $targetWindow = $window
            $targetComposer = $composer
            break
        }
    }

    if ($target) { break }

    # Restore the original tab before inspecting another Edge window.
    for ($restore = 0; $restore -lt $stepsTaken; $restore++) {
        $ws.SendKeys("^+{TAB}")
        Start-Sleep -Milliseconds 35
    }
}

if (-not $target) {
    throw "CHATGPT_SEND_ABORTED: No ChatGPT composer was found after inspecting active tabs in all visible Edge windows. No text was sent."
}

[void][BridgeNative.WindowApi]::Activate($targetWindow.Handle)
Start-Sleep -Milliseconds 500
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
    Start-Sleep -Milliseconds 250
    $ws.SendKeys("^v")
    Start-Sleep -Milliseconds 700

    $pastedValue = $null
    try {
        $valuePattern = $targetComposer.GetCurrentPattern(
            [System.Windows.Automation.ValuePattern]::Pattern
        )
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
        $valuePattern = $targetComposer.GetCurrentPattern(
            [System.Windows.Automation.ValuePattern]::Pattern
        )
        $remainingValue = [string]$valuePattern.Current.Value
    } catch {}

    if ($null -ne $remainingValue -and $remainingValue.Contains($Report.Substring(0, [Math]::Min(40, $Report.Length)))) {
        throw "CHATGPT_SEND_ABORTED: The report remains in the composer; submission was not confirmed."
    }

    "CHATGPT_MESSAGE_SUBMITTED"
    "Destination: existing ChatGPT composer in Microsoft Edge"
    "Window: $($targetWindow.Title)"
    "Characters: $($Report.Length)"
} finally {
    if ($clipboardCaptured) {
        Set-Clipboard -Value $oldClipboard
    }
}
