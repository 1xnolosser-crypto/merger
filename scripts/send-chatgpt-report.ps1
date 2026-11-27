# Sends a report into the currently open ChatGPT tab in Microsoft Edge.
# Fail-closed: it sends only when the active Edge window exposes ChatGPT's message composer.
[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [ValidateNotNullOrEmpty()]
    [string]$Report,
    [int]$WaitSeconds = 25
)

$ErrorActionPreference = "Stop"

function Get-ChatGPTComposer {
    param([IntPtr]$WindowHandle)

    Add-Type -AssemblyName UIAutomationClient
    Add-Type -AssemblyName UIAutomationTypes
    $root = [System.Windows.Automation.AutomationElement]::FromHandle($WindowHandle)
    if (-not $root) { return $null }

    $condition = New-Object System.Windows.Automation.PropertyCondition(
        [System.Windows.Automation.AutomationElement]::AutomationIdProperty,
        "prompt-textarea"
    )
    $found = $root.FindFirst(
        [System.Windows.Automation.TreeScope]::Descendants,
        $condition
    )
    if ($found) { return $found }

    # Fallback for ChatGPT UI variants that expose the composer by accessible name.
    $all = $root.FindAll(
        [System.Windows.Automation.TreeScope]::Descendants,
        [System.Windows.Automation.Condition]::TrueCondition
    )
    foreach ($element in $all) {
        $name = [string]$element.Current.Name
        $type = $element.Current.ControlType
        if (($type -eq [System.Windows.Automation.ControlType]::Edit -or
             $type -eq [System.Windows.Automation.ControlType]::Document) -and
            ($name -match "Message ChatGPT|Send a message|اسأل ChatGPT|إرسال رسالة")) {
            return $element
        }
    }
    return $null
}

# Do not launch a fresh browser or silently switch to a different conversation.
$edge = Get-Process msedge -ErrorAction SilentlyContinue |
    Where-Object { $_.MainWindowHandle -ne 0 -and $_.MainWindowTitle } |
    Sort-Object StartTime -Descending |
    Select-Object -First 1

if (-not $edge) {
    throw "CHATGPT_SEND_ABORTED: Microsoft Edge has no accessible browser window."
}

$ws = New-Object -ComObject WScript.Shell
if (-not $ws.AppActivate([int]$edge.Id)) {
    throw "CHATGPT_SEND_ABORTED: Could not activate the Edge window."
}
Start-Sleep -Milliseconds 700

$composer = Get-ChatGPTComposer -WindowHandle ([IntPtr]$edge.MainWindowHandle)
if (-not $composer) {
    throw "CHATGPT_SEND_ABORTED: The active Edge tab is not exposing a ChatGPT message composer. No text was sent. Open the intended ChatGPT conversation in the active Edge tab and retry."
}

$oldClipboard = $null
try { $oldClipboard = Get-Clipboard -Raw -ErrorAction SilentlyContinue } catch {}
Set-Clipboard -Value $Report
try {
    $composer.SetFocus()
    Start-Sleep -Milliseconds 250
    $ws.SendKeys("^v")
    Start-Sleep -Milliseconds 500

    # Confirm text is present in the composer before pressing Enter.
    $value = $null
    try {
        $pattern = $composer.GetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern)
        $value = [string]$pattern.Current.Value
    } catch {}
    if ($value -and -not $value.Contains($Report.Substring(0, [Math]::Min(40, $Report.Length)))) {
        throw "CHATGPT_SEND_ABORTED: Composer verification failed. Enter was not pressed."
    }

    $ws.SendKeys("{ENTER}")
    Start-Sleep -Seconds 2
    "CHATGPT_MESSAGE_SUBMITTED"
    "Destination: active ChatGPT tab in Microsoft Edge"
    "Characters: $($Report.Length)"
} finally {
    if ($null -ne $oldClipboard) {
        Set-Clipboard -Value $oldClipboard
    }
}
