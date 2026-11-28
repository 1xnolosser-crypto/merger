# ChatGPT Accessibility Agent for Windows PowerShell 5.1
# Reads Edge's UI Automation tree (no screenshots, video, OCR, or browser extensions).
# Reuses an existing ChatGPT tab by its real address-bar URL. Never opens a new page.
[CmdletBinding()]
param(
    [Parameter(Mandatory=$true)][ValidateNotNullOrEmpty()][string]$Report,
    [int]$WaitSeconds = 60,
    [string]$LogPath = "$env:LOCALAPPDATA\MergerRemote\chatgpt-accessibility.json"
)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
if (-not ('ChatGPTAgent.Native' -as [type])) {
    Add-Type -TypeDefinition @"
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Text;
namespace ChatGPTAgent {
 public sealed class Win { public IntPtr Handle {get;set;} public int Pid {get;set;} public string Title {get;set;} }
 public static class Native {
  private delegate bool EnumProc(IntPtr h, IntPtr l);
  [DllImport("user32.dll")] static extern bool EnumWindows(EnumProc cb, IntPtr lp);
  [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr h);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] static extern int GetWindowText(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] static extern int GetClassName(IntPtr h, StringBuilder s, int n);
  [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr h, out uint p);
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] static extern bool SetForegroundWindow(IntPtr h);
  [DllImport("user32.dll")] static extern bool ShowWindowAsync(IntPtr h, int c);
  public static string Title(IntPtr h) { var b=new StringBuilder(1024); GetWindowText(h,b,b.Capacity); return b.ToString(); }
  public static bool Activate(IntPtr h) { ShowWindowAsync(h,9); return SetForegroundWindow(h); }
  public static Win[] EdgeWindows() {
   var a=new List<Win>();
   EnumWindows((h,l)=>{ if(!IsWindowVisible(h)) return true; var c=new StringBuilder(256); GetClassName(h,c,c.Capacity); if(c.ToString()!="Chrome_WidgetWin_1") return true; uint p; GetWindowThreadProcessId(h,out p); try { using(var pr=Process.GetProcessById((int)p)) { if(pr.ProcessName.Equals("msedge",StringComparison.OrdinalIgnoreCase)) a.Add(new Win{Handle=h,Pid=(int)p,Title=Title(h)}); } } catch {} return true; },IntPtr.Zero);
   return a.ToArray();
  }
 }
}
"@
}
function Find-Composer($root) {
    $all = $root.FindAll([System.Windows.Automation.TreeScope]::Descendants,[System.Windows.Automation.Condition]::TrueCondition)
    $items = @()
    foreach($e in $all) {
        try {
            $c=$e.Current
            if($c.IsOffscreen) { continue }
            $items += [pscustomobject]@{
                Name=[string]$c.Name; AutomationId=[string]$c.AutomationId
                Type=[string]$c.ControlType.ProgrammaticName
                Focusable=[bool]$c.IsKeyboardFocusable
            }
            if($c.AutomationId -eq 'prompt-textarea' -and $c.IsKeyboardFocusable) { return $e }
        } catch {}
    }
    $candidates=@($all | Where-Object {
        try {
            $c=$_.Current
            -not $c.IsOffscreen -and $c.IsKeyboardFocusable -and
            ($c.ControlType -eq [System.Windows.Automation.ControlType]::Edit -or
             $c.ControlType -eq [System.Windows.Automation.ControlType]::Document)
        } catch { $false }
    })
    if($candidates.Count -gt 0) { return $candidates[$candidates.Count-1] }
    return $null
}


function Get-ComposerText {
    param([System.Windows.Automation.AutomationElement]$Composer)
    if (-not $Composer) { return $null }
    try {
        $pattern = $Composer.GetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern)
        return [string]$pattern.Current.Value
    } catch {}
    try {
        $pattern = $Composer.GetCurrentPattern([System.Windows.Automation.TextPattern]::Pattern)
        return [string]$pattern.DocumentRange.GetText(2000000)
    } catch {}
    return $null
}
function Get-ChatGPTSendButton {
    param([System.Windows.Automation.AutomationElement]$Root)
    if (-not $Root) { return $null }
    try {
        $condition = New-Object System.Windows.Automation.PropertyCondition(
            [System.Windows.Automation.AutomationElement]::AutomationIdProperty, "send-button"
        )
        $button = $Root.FindFirst([System.Windows.Automation.TreeScope]::Descendants, $condition)
        if ($button) { return $button }
    } catch {}
    try {
        $condition = New-Object System.Windows.Automation.PropertyCondition(
            [System.Windows.Automation.AutomationElement]::ControlTypeProperty,
            [System.Windows.Automation.ControlType]::Button
        )
        $buttons = @($Root.FindAll([System.Windows.Automation.TreeScope]::Descendants, $condition))
        $matches = @($buttons | Where-Object {
            try { -not $_.Current.IsOffscreen -and ([string]$_.Current.Name -match '(?i)send prompt|send message|^send$|إرسال') }
            catch { $false }
        })
        if ($matches.Count -gt 0) { return $matches[$matches.Count - 1] }
    } catch {}
    return $null
}
function Get-ChatGPTPageText {
    param([System.Windows.Automation.AutomationElement]$Root)
    $parts = New-Object System.Collections.Generic.List[string]
    try {
        $condition = New-Object System.Windows.Automation.PropertyCondition(
            [System.Windows.Automation.AutomationElement]::ControlTypeProperty,
            [System.Windows.Automation.ControlType]::Text
        )
        $elements = $Root.FindAll([System.Windows.Automation.TreeScope]::Descendants, $condition)
        foreach ($element in $elements) {
            try { $name = [string]$element.Current.Name; if ($name) { $parts.Add($name) } } catch {}
        }
    } catch {}
    return ($parts -join [Environment]::NewLine)
}
function Wait-ForChatGPTComposerReady {
    param(
        [System.Windows.Automation.AutomationElement]$Root,
        [string]$ExpectedText,
        [int]$TimeoutSeconds
    )
    $expectedNormalized = [regex]::Replace($ExpectedText, '\s+', ' ').Trim()
    $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
    $lastText = $null
    $stableSince = $null
    while ((Get-Date) -lt $deadline) {
        $composer = Find-Composer $Root
        $current = Get-ComposerText $composer
        $button = Get-ChatGPTSendButton $Root
        $enabled = $false
        if ($button) { try { $enabled = [bool]$button.Current.IsEnabled } catch {} }
        $currentNormalized = if ($null -ne $current) { [regex]::Replace([string]$current, '\s+', ' ').Trim() } else { '' }
        if (($currentNormalized -ceq $expectedNormalized) -and $enabled) {
            if ($current -ceq $lastText) {
                if (-not $stableSince) { $stableSince = Get-Date }
                if (((Get-Date) - $stableSince).TotalMilliseconds -ge 1000) {
                    return [pscustomobject]@{ Composer=$composer; Button=$button; Text=$current }
                }
            } else {
                $lastText = $current
                $stableSince = Get-Date
            }
        } else {
            $lastText = $current
            $stableSince = $null
        }
        Start-Sleep -Milliseconds 300
    }
    throw "CHATGPT_SEND_ABORTED: The full report did not stabilize in the composer with an enabled Send button within $TimeoutSeconds seconds. Nothing was submitted."
}
function Submit-ChatGPTMessage {
    param(
        [System.Windows.Automation.AutomationElement]$Root,
        [string]$ExpectedText,
        [string]$VerifyText,
        [System.Object]$WScriptShell,
        [int]$TimeoutSeconds
    )
    [void](Wait-ForChatGPTComposerReady -Root $Root -ExpectedText $ExpectedText -TimeoutSeconds $TimeoutSeconds)
    $button = Get-ChatGPTSendButton $Root
    if (-not $button -or -not $button.Current.IsEnabled) {
        throw "CHATGPT_SEND_ABORTED: Send became disabled before submission. The report remains in the composer."
    }
    $invoked = $false
    try {
        $invokePattern = $button.GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern)
        $invokePattern.Invoke()
        $invoked = $true
    } catch {}
    if (-not $invoked) {
        if (-not $button.Current.IsEnabled) { throw "CHATGPT_SEND_ABORTED: Send button is disabled and cannot be invoked." }
        $WScriptShell.SendKeys("{ENTER}")
    }
    $verification = $VerifyText
    if ([string]::IsNullOrWhiteSpace($verification)) { $verification = $ExpectedText }
    $head = [regex]::Replace($verification.Substring(0, [Math]::Min(80, $verification.Length)), '\s+', ' ').Trim()
    $tail = [regex]::Replace($verification.Substring([Math]::Max(0, $verification.Length - 80)), '\s+', ' ').Trim()
    $deadline = (Get-Date).AddSeconds([Math]::Max(10, $TimeoutSeconds))
    $composerCleared = $false
    $messageVisible = $false
    while ((Get-Date) -lt $deadline) {
        Start-Sleep -Milliseconds 500
        $remaining = Get-ComposerText (Find-Composer $Root)
        if ($null -ne $remaining -and [string]::IsNullOrWhiteSpace($remaining)) { $composerCleared = $true }
        $pageNormalized = [regex]::Replace([string](Get-ChatGPTPageText $Root), '\s+', ' ').Trim()
        if ($pageNormalized.Contains($head) -and $pageNormalized.Contains($tail)) { $messageVisible = $true }
        if ($composerCleared -and $messageVisible) { return $true }
    }
    if ($composerCleared) {
        throw "CHATGPT_SEND_UNCONFIRMED: The composer cleared after Send, but UI Automation could not verify the report in the conversation. Do not retry automatically; this avoids duplicate messages."
    }
    throw "CHATGPT_SEND_ABORTED: The report remains in the composer after the Send attempt. Submission was not confirmed."
}

function Get-EdgeAddressBarUrl($root) {
    if (-not $root) { return "" }
    $element = $null
    try {
        $condition = New-Object System.Windows.Automation.PropertyCondition(
            [System.Windows.Automation.AutomationElement]::AutomationIdProperty, "view_1017"
        )
        $element = $root.FindFirst([System.Windows.Automation.TreeScope]::Descendants, $condition)
    } catch {}
    if (-not $element) {
        try {
            $condition = New-Object System.Windows.Automation.PropertyCondition(
                [System.Windows.Automation.AutomationElement]::NameProperty, "Address and search bar"
            )
            $element = $root.FindFirst([System.Windows.Automation.TreeScope]::Descendants, $condition)
        } catch {}
    }
    if ($element) {
        try {
            $pattern = $element.GetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern)
            return ([string]$pattern.Current.Value).Trim()
        } catch {}
    }
    return ""
}
function Test-ChatGPTPage($root, [string]$windowTitle) {
    $address = Get-EdgeAddressBarUrl $root
    if ($address) {
        $uri = $null
        if ([Uri]::TryCreate($address, [UriKind]::Absolute, [ref]$uri)) {
            return ($uri.Host -eq "chatgpt.com" -or $uri.Host.EndsWith(".chatgpt.com"))
        }
    }
    return ($windowTitle -match '(?i)chatgpt')
}
function Get-EdgeTabItems($root) {
    try {
        $condition = New-Object System.Windows.Automation.PropertyCondition(
            [System.Windows.Automation.AutomationElement]::ControlTypeProperty,
            [System.Windows.Automation.ControlType]::TabItem
        )
        return @($root.FindAll([System.Windows.Automation.TreeScope]::Descendants, $condition))
    } catch { return @() }
}
function Get-SelectedEdgeTab($tabs) {
    foreach ($tab in $tabs) {
        try {
            $pattern = $tab.GetCurrentPattern([System.Windows.Automation.SelectionItemPattern]::Pattern)
            if ($pattern.Current.IsSelected) { return $tab }
        } catch {}
    }
    return $null
}
function Select-EdgeTab($tab) {
    try {
        $pattern = $tab.GetCurrentPattern([System.Windows.Automation.SelectionItemPattern]::Pattern)
        if (-not $pattern.Current.IsSelected) { $pattern.Select() }
        Start-Sleep -Milliseconds 500
        return $true
    } catch {
        try {
            $invoke = $tab.GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern)
            $invoke.Invoke()
            Start-Sleep -Milliseconds 500
            return $true
        } catch { return $false }
    }
}

$logDir=Split-Path -Parent $LogPath
New-Item -ItemType Directory -Force -Path $logDir | Out-Null
$deadline=(Get-Date).AddSeconds($WaitSeconds)
$window=$null; $root=$null; $composer=$null; $snapshot=@()
$edgeWindows=@([ChatGPTAgent.Native]::EdgeWindows())
$originalForeground = [ChatGPTAgent.Native]::GetForegroundWindow()
$matchedTabTitles=@()
$selectedTabTitle=""

foreach($w in $edgeWindows) {
    [void][ChatGPTAgent.Native]::Activate($w.Handle)
    Start-Sleep -Milliseconds 250
    if([ChatGPTAgent.Native]::GetForegroundWindow() -ne $w.Handle) { continue }
    try {
        $r=[System.Windows.Automation.AutomationElement]::FromHandle($w.Handle)
        if(-not $r) { continue }

        # Fast path: recognize the already-active ChatGPT page by its actual URL.
        $activeTitle = [ChatGPTAgent.Native]::Title($w.Handle)
        if(Test-ChatGPTPage $r $activeTitle) {
            $c=Find-Composer $r
            $snapshot += [pscustomobject]@{
                WindowTitle=$activeTitle; ProcessId=$w.Pid
                ComposerFound=[bool]$c; Detection='active-page-url'
                AddressBarUrl=(Get-EdgeAddressBarUrl $r)
            }
            if($c) {
                $window=$w; $root=$r; $composer=$c; $selectedTabTitle=$activeTitle
                break
            }
        }

        # Custom conversation titles do not contain "ChatGPT". Inspect existing
        # Edge tabs by the actual URL in the address bar; never open a new tab/window.
        $tabs = @(Get-EdgeTabItems $r)
        $originalTab = Get-SelectedEdgeTab $tabs
        foreach($tab in $tabs) {
            $tabName = ""
            try { $tabName = [string]$tab.Current.Name } catch {}
            if($tabName) { $matchedTabTitles += $tabName }
            if(-not (Select-EdgeTab $tab)) { continue }

            $activeTitle = [ChatGPTAgent.Native]::Title($w.Handle)
            $r=[System.Windows.Automation.AutomationElement]::FromHandle($w.Handle)
            if(-not $r) { continue }
            $address = Get-EdgeAddressBarUrl $r
            $snapshot += [pscustomobject]@{
                WindowTitle=$activeTitle; ProcessId=$w.Pid
                ComposerFound=$false; Detection='existing-tab-url'
                TabName=$tabName; AddressBarUrl=$address
            }
            if(-not (Test-ChatGPTPage $r $activeTitle)) { continue }
            $c=Find-Composer $r
            if($c) {
                $window=$w; $root=$r; $composer=$c; $selectedTabTitle=$tabName
                break
            }
        }
        if($composer) { break }

        # Restore the user's original selected tab if this window had no ChatGPT page.
        if($originalTab) { [void](Select-EdgeTab $originalTab) }
    } catch {}
}

if(-not $composer) {
    if($originalForeground -ne [IntPtr]::Zero) {
        [void][ChatGPTAgent.Native]::Activate($originalForeground)
    }
    $state=[ordered]@{
        status='composer_not_found'; checkedAt=(Get-Date).ToString('o')
        edgeWindowCount=$edgeWindows.Count; windows=$snapshot
        matchingTabCaptions=$matchedTabTitles; openedNewTab=$false
        note='Searched existing Edge tabs by address-bar URL. No new ChatGPT page or window was opened. No text was sent.'
    }
    $state | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath $LogPath -Encoding UTF8
    throw 'CHATGPT_AGENT_ABORTED: No existing ChatGPT tab with an accessible composer was found. No new page or window was opened; no text sent.'
}

# Revalidate the active destination immediately before typing.
$activeTitle = [ChatGPTAgent.Native]::Title($window.Handle)
$activeRoot = [System.Windows.Automation.AutomationElement]::FromHandle($window.Handle)
if([ChatGPTAgent.Native]::GetForegroundWindow() -ne $window.Handle -or
   -not (Test-ChatGPTPage $activeRoot $activeTitle)) {
    throw 'CHATGPT_AGENT_ABORTED: Selected page is not the existing ChatGPT site. No text sent.'
}
$root = $activeRoot
$composer = Find-Composer $root
if(-not $composer) {
    throw 'CHATGPT_AGENT_ABORTED: Existing ChatGPT page found but its composer is inaccessible. No text sent.'
}
$pageElements=@()
try {
    $uia=$root.FindAll([System.Windows.Automation.TreeScope]::Descendants,[System.Windows.Automation.Condition]::TrueCondition)
    $limit=[Math]::Min(120,$uia.Count)
    for($i=0;$i -lt $limit;$i++) {
        try {
            $v=$uia.Item($i).Current
            if(-not $v.IsOffscreen -and ($v.Name -or $v.AutomationId)) {
                $pageElements += [pscustomobject]@{type=$v.ControlType.ProgrammaticName; name=[string]$v.Name; automationId=[string]$v.AutomationId; helpText=[string]$v.HelpText; focusable=[bool]$v.IsKeyboardFocusable}
            }
        } catch {}
    }
} catch {}
$pageContext = "BROWSER ACCESSIBILITY SNAPSHOT (UI Automation; no screenshot/video):`n" + (($pageElements | ConvertTo-Json -Depth 5) -join "`n")
$messageToSend = $Report + "`n`n" + $pageContext
$old=$null; $haveOld=$false
try { $old=Get-Clipboard -Raw; $haveOld=$true } catch {}
try {
    $composer.SetFocus()
    Start-Sleep -Milliseconds 250
    $ws=New-Object -ComObject WScript.Shell
    Set-Clipboard -Value $messageToSend
    $ws.SendKeys('^v')
    Start-Sleep -Milliseconds 250

    $activeTitleNow = [ChatGPTAgent.Native]::Title($window.Handle)
    $activeRootNow = [System.Windows.Automation.AutomationElement]::FromHandle($window.Handle)
    if([ChatGPTAgent.Native]::GetForegroundWindow() -ne $window.Handle -or
       -not (Test-ChatGPTPage $activeRootNow $activeTitleNow)) {
        throw 'CHATGPT_AGENT_ABORTED: Focus changed after paste; Send was not invoked.'
    }

    [void](Submit-ChatGPTMessage -Root $root -ExpectedText $messageToSend -VerifyText $Report -WScriptShell $ws -TimeoutSeconds $WaitSeconds)
    $state=[ordered]@{
        status='submitted_and_verified_in_conversation'; checkedAt=(Get-Date).ToString('o')
        windowTitle=[ChatGPTAgent.Native]::Title($window.Handle)
        composerAutomationId=[string]$composer.Current.AutomationId
        reportCharacters=$Report.Length; submittedCharacters=$messageToSend.Length
        accessibleElements=$pageElements.Count
        method='UI Automation: complete composer stable, Send enabled, and report head/tail verified in conversation'
        pageElements=$pageElements
    }
    $state | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath $LogPath -Encoding UTF8
    'CHATGPT_ACCESSIBILITY_AGENT_SUBMITTED'
    "Window: $($state.windowTitle)"
    "Log: $LogPath"
} finally {
    if($haveOld) { Set-Clipboard -Value $old }
}
