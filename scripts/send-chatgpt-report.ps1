# Sends a report only to an existing ChatGPT tab in Microsoft Edge.
# It searches every Edge window and its accessible tab items before sending.
[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [ValidateNotNullOrEmpty()]
    [string]$Report,
    [int]$WaitSeconds = 25
)

$ErrorActionPreference = "Stop"
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes

function Get-ChatGPTTarget {
    param([IntPtr]$WindowHandle)

    $root = [System.Windows.Automation.AutomationElement]::FromHandle($WindowHandle)
    if (-not $root) { return $null }

    $title = [string]$root.Current.Name
    if ($title -match "(?i)ChatGPT|chat\.openai\.com") {
        return [pscustomobject]@{ Root = $root; TabName = $title }
    }

    # The active tab title may not be ChatGPT. Search the browser's accessible tab strip.
    $all = $root.FindAll(
        [System.Windows.Automation.TreeScope]::Descendants,
        [System.Windows.Automation.Condition]::TrueCondition
    )
    foreach ($element in $all) {
        if ($element.Current.ControlType -ne [System.Windows.Automation.ControlType]::TabItem) {
            continue
        }
        $tabName = [string]$element.Current.Name
        if ($tabName -match "(?i)ChatGPT|chat\.openai\.com") {
            try {
                $selection = $element.GetCurrentPattern([System.Windows.Automation.SelectionItemPattern]::Pattern)
                $selection.Select()
            } catch {
                try {
                    $invoke = $element.GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern)
                    $invoke.Invoke()
                } catch {}
            }
            Start-Sleep -Milliseconds 700
            return [pscustomobject]@{ Root = $root; TabName = $tabName }
        }
    }
    return $null
}

function Get-ChatGPTComposer {
    param($Root)

    $condition = New-Object System.Windows.Automation.PropertyCondition(
        [System.Windows.Automation.AutomationElement]::AutomationIdProperty,
        "prompt-textarea"
    )
    $found = $Root.FindFirst(
        [System.Windows.Automation.TreeScope]::Descendants,
        $condition
    )
    if ($found) { return $found }

    $all = $Root.FindAll(
        [System.Windows.Automation.TreeScope]::Descendants,
        [System.Windows.Automation.Condition]::TrueCondition
    )
    foreach ($element in $all) {
        $name = [string]$element.Current.Name
        $type = $element.Current.ControlType
        if (($type -eq [System.Windows.Automation.ControlType]::Edit -or
             $type -eq [System.Windows.Automation.ControlType]::Document) -and
            ($name -match "(?i)Message ChatGPT|Send a message")) {
            return $element
        }
    }
    return $null
}

$windows = @(Get-Process msedge -ErrorAction SilentlyContinue |
    Where-Object { $_.MainWindowHandle -ne 0 } |
    Sort-Object StartTime -Descending)

if ($windows.Count -eq 0) {
    throw "CHATGPT_SEND_ABORTED: Microsoft Edge has no accessible browser window."
}

$target = $null
$targetProcess = $null
foreach ($edge in $windows) {
    $candidate = Get-ChatGPTTarget -WindowHandle ([IntPtr]$edge.MainWindowHandle)
    if ($candidate) {
        $target = $candidate
        $targetProcess = $edge
        break
    }
}
if (-not $target) {
    throw "CHATGPT_SEND_ABORTED: No existing ChatGPT tab was found in any accessible Edge window. No text was sent."
}

$ws = New-Object -ComObject WScript.Shell
if (-not $ws.AppActivate([int]$targetProcess.Id)) {
    throw "CHATGPT_SEND_ABORTED: Could not activate the Edge window containing ChatGPT."
}
Start-Sleep -Milliseconds 700

$composer = $null
$deadline = (Get-Date).AddSeconds([Math]::Max(1, $WaitSeconds))
do {
    $composer = Get-ChatGPTComposer -Root $target.Root
    if ($composer) { break }
    Start-Sleep -Milliseconds 500
} while ((Get-Date) -lt $deadline)

if (-not $composer) {
    throw "CHATGPT_SEND_ABORTED: ChatGPT tab was identified, but its message composer was not accessible. No text was sent."
}

$oldClipboard = $null
try { $oldClipboard = Get-Clipboard -Raw -ErrorAction SilentlyContinue } catch {}
Set-Clipboard -Value $Report
try {
    $composer.SetFocus()
    Start-Sleep -Milliseconds 250
    $ws.SendKeys("^v")
    Start-Sleep -Milliseconds 600

    # If ValuePattern is available, verify the pasted report before submitting.
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
    "Destination: ChatGPT tab '$($target.TabName)' in Microsoft Edge"
    "Characters: $($Report.Length)"
} finally {
    if ($null -ne $oldClipboard) {
        Set-Clipboard -Value $oldClipboard
    }
}
